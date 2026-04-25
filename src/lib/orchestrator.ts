// Statewide orchestrator — replaces the old Miami-Dade-only runDiagnostic.
//
// Pipeline:
//   1. Geocode the address → lat/lng + county key.
//   2. Dispatch to the right county adapter (Tier A scraping or Tier B links-only).
//   3. Fetch parcel polygon (county-specific → statewide → synthetic fallback).
//   4. Build Google Static Maps satellite URLs with the parcel drawn in red.
//   5. Build Google Street View static URLs at multiple headings.
//   6. Run vision comparison (polygon-aware prompt).
//   7. Assemble the DiagnosticReport the UI expects.

import type {
  DiagnosticReport,
  Flag,
  ExtraFeature,
  Permit,
  CodeCase,
  ThenVsNow,
  ChecklistItem,
  UserUploadedThen,
} from './types';
import { geocode, reverseCounty } from './geocode';
import { getCountyAdapter, toCountyInfo } from './counties';
import { FL_COUNTY_DIRECTORY } from './counties/portals';
import { fetchParcelPolygon } from './parcel';
import {
  buildSubjectSatelliteUrl,
  buildContextSatelliteUrl,
} from './images/google-satellite';
import { buildStreetViewUrlsTowardParcel } from './images/streetview';
import { fetchHistoricalAerials } from './images/historical-aerial';
import { fetchHistoricalStreetView } from './images/streetview-historical';
import { compareImagery } from './vision-compare';
import { recordToLedger } from './ledger';

// ---------------------------------------------------------------------------
// Flag / confidence / next-steps / checklist builders — shared across
// counties (the logic doesn't depend on which county the data came from).
// ---------------------------------------------------------------------------

function yearBuckets(features: ExtraFeature[]): Record<number, ExtraFeature[]> {
  const map: Record<number, ExtraFeature[]> = {};
  for (const f of features) {
    const y = f.actualYearBuilt ?? 0;
    if (!map[y]) map[y] = [];
    map[y].push(f);
  }
  return map;
}

function buildFlags(
  permits: Permit[],
  neighborTotal: number,
  buckets: Record<number, ExtraFeature[]>,
  codeEnf: { open: CodeCase[]; closedPast5: CodeCase[] },
  homesteadStatusText: string,
  yearBuilt: number | null,
  countyName: string,
): { strong: Flag[]; medium: Flag[]; weak: Flag[] } {
  const strong: Flag[] = [];
  const medium: Flag[] = [];
  const weak: Flag[] = [];

  if (yearBuilt) {
    const postBuildYears = Object.keys(buckets)
      .map(Number)
      .filter((y) => y > (yearBuilt as number))
      .sort((a, b) => a - b);
    for (const y of postBuildYears) {
      const items = buckets[y];
      const itemList = items
        .map((f) => `${f.description}${f.units ? ` (${f.units} units)` : ''}`)
        .join('; ');
      const matching = permits.filter((p) => {
        if (!p.issueDate) return false;
        const py = Number(p.issueDate.slice(0, 4));
        return Math.abs(py - y) <= 2;
      });
      if (matching.length === 0) {
        strong.push({
          severity: 'strong',
          title: `${y} additions with no matching permit on file`,
          detail: `The Property Appraiser's extra-features record dates the following to ${y}, ${y - yearBuilt} year(s) after the original ${yearBuilt} construction: ${itemList}. No permits issued in ${y - 2}–${y + 2} appear in the ${countyName} public permit database for this parcel.`,
        });
      }
    }
  }

  if (permits.length === 0 && neighborTotal >= 5) {
    strong.push({
      severity: 'strong',
      title: 'Zero permits on file — neighbors have many',
      detail: `This parcel has no records in the county's digital permit archive. Adjacent parcels on the same block show ${neighborTotal} permits combined. Most likely explanations: work was unpermitted, records never migrated from paper/microfilm into the current portal, or records filed under a different folio. Certified records pull required.`,
    });
  }

  if (permits.length === 0 && yearBuilt && new Date().getFullYear() - yearBuilt >= 15) {
    medium.push({
      severity: 'medium',
      title: 'Long-cycle systems never permitted despite age',
      detail: `House is ${new Date().getFullYear() - yearBuilt} years old with no re-roof, A/C swap, water-heater swap, or window-replacement permit on file. A/C and water heaters typically reach end-of-life well before this; if they were replaced, they were replaced without permits.`,
    });
  }

  if (/\$0 for:/.test(homesteadStatusText)) {
    medium.push({
      severity: 'medium',
      title: 'Non-homestead profile correlates with unpermitted repairs',
      detail: `${homesteadStatusText} Absentee-owner properties tend to show a higher rate of unpermitted repairs in county code-enforcement statistics. This increases the prior probability that the flags above reflect real gaps.`,
    });
  }

  for (const c of codeEnf.closedPast5) {
    weak.push({
      severity: 'weak',
      title: `Closed code case ${c.caseNumber} — ${c.problemDescription || 'detail unspecified'}`,
      detail: `Opened ${c.caseDate ?? 'unknown date'}; status ${c.status || 'Closed'}; last action ${c.lastAction || 'not noted'}; lien ${c.lien || 'none'}. Not a construction case if the problem description is cosmetic; useful as evidence that an inspector has been to the address without writing up anything else.`,
    });
  }
  for (const c of codeEnf.open) {
    medium.push({
      severity: 'medium',
      title: `OPEN code case ${c.caseNumber}`,
      detail: `Opened ${c.caseDate ?? 'unknown'}. Problem: ${c.problemDescription || 'not specified'}. Status: ${c.status || 'open'}. Last action: ${c.lastAction || 'none'}. This is an active county case — resolve before closing.`,
    });
  }

  return { strong, medium, weak };
}

function buildConfidence(
  permitCount: number,
  codeEnfCount: number,
  adapterFound: boolean,
  neighborCount: number,
  countyTier: 'A' | 'B',
  countyName: string,
): DiagnosticReport['confidenceAssessment'] {
  const dataGrade = countyTier === 'A' && adapterFound ? 'high' : 'low';
  const tierBNote = countyTier === 'B';
  return [
    {
      topic: 'Property basics (owner, address, year built, size)',
      grade: dataGrade,
      note: tierBNote
        ? `${countyName} is on the links-only tier — we did not retrieve property appraiser data directly. Use the portal link to verify.`
        : adapterFound
          ? 'Pulled live from the county Property Appraiser endpoint.'
          : 'Property Appraiser endpoint did not resolve this address. Results limited.',
    },
    {
      topic: 'Permit record',
      grade: dataGrade,
      note: tierBNote
        ? `No automated permit lookup for ${countyName} yet. Use the Building Dept portal link to verify permit history manually.`
        : permitCount === 0
          ? 'Zero permits retrieved from the county permit dataset. High confidence that nothing is in the digital system; does NOT rule out paper archives.'
          : `${permitCount} permits retrieved from the live county endpoint.`,
    },
    {
      topic: 'Code enforcement',
      grade: tierBNote ? 'low' : 'high',
      note: tierBNote
        ? `No automated code-enforcement lookup for ${countyName} yet.`
        : codeEnfCount === 0
          ? 'No cases found in the available code-compliance endpoints.'
          : `${codeEnfCount} case(s) retrieved across code-compliance endpoints.`,
    },
    {
      topic: 'Unpermitted-work inference',
      grade: 'medium',
      note:
        'Inference compares extra-features actual-year-built to permit issue-date, plus AI visual comparison of satellite + Street View against the permit log. Certified records pull by address will upgrade to high or rule out entirely.',
    },
    {
      topic: 'Neighbor comparison',
      grade: neighborCount > 0 ? 'high' : tierBNote ? 'low' : 'low',
      note:
        neighborCount > 0
          ? `${neighborCount} permits found on parcels in the same block.`
          : tierBNote
            ? 'Not retrieved for this county tier.'
            : 'No neighbor permits found — unusual for a populated block. May indicate a rural or platted-but-undeveloped area.',
    },
    {
      topic: 'Site walk / visual verification',
      grade: 'not_observed',
      note: 'This report is records-level only. Walking the property will upgrade or downgrade the flags above.',
    },
  ];
}

function buildNextSteps(
  permits: Permit[],
  flags: { strong: Flag[]; medium: Flag[]; weak: Flag[] },
  countyName: string,
  tier: 'A' | 'B',
  portalLinks: { propertyAppraiser: string | null; buildingDept: string | null },
): string[] {
  const s: string[] = [];
  if (tier === 'B') {
    s.push(
      `Confirm the property directly on the ${countyName} Property Appraiser portal${portalLinks.propertyAppraiser ? ` (${portalLinks.propertyAppraiser})` : ''}. That will give you owner, year built, extra features, and the full permit history as that county records it.`,
    );
    s.push(
      'If the AI visual comparison above surfaced any flags, take screenshots and cross-reference against what the Property Appraiser and Building Dept portals show for this address.',
    );
  } else if (permits.length === 0) {
    s.push(
      `Pull a certified records package from the ${countyName} Building Department by ADDRESS (not just folio). This is the single most important step — paper archives sometimes hide permits the online portal missed.`,
    );
  } else if (flags.strong.length > 0) {
    s.push(
      'Ask the listing agent for permit paperwork (original construction permit, invoices, inspection approvals). A single document can close the biggest flag fast.',
    );
  }
  if (flags.strong.length > 0) {
    s.push(
      'If work is confirmed unpermitted, have the seller run after-the-fact permits (permit rescue) before closing. Budget roughly 3x the original scope cost to legalize.',
    );
  } else if (s.length < 2) {
    s.push(
      'Walk the property — look at the roof, the rear yard, the windows, and any fence. Anything visibly newer than the house is worth a question.',
    );
  }
  s.push(
    "Price anything you can't close into your offer, and get a written disclosure naming each specific item.",
  );
  return s.slice(0, 3);
}

function buildVisualChecklist(
  yearBuilt: number | null,
  permits: Permit[],
  features: ExtraFeature[],
): ChecklistItem[] {
  const list: ChecklistItem[] = [];
  const currentYear = new Date().getFullYear();

  const scopeText = (p: Permit) => [p.appType ?? '', p.scope ?? ''].join(' ').toUpperCase();
  const anyPermitMatches = (re: RegExp) => permits.some((p) => re.test(scopeText(p)));

  const hasReroof = anyPermitMatches(/\bREROOF|ROOF\b/);
  const hasFence = anyPermitMatches(/FENCE/);
  const hasPatio = anyPermitMatches(/PATIO|SLAB/);
  const hasShed = anyPermitMatches(/SHED|DETACH|ACCESSOR/);
  const hasWindows = anyPermitMatches(/WINDOW|DOOR|IMPACT/);
  const hasAC = anyPermitMatches(/MECHANICAL|A\/?C|HVAC|CONDENS/);
  const hasPool = anyPermitMatches(/POOL/);
  const hasAddition = anyPermitMatches(/ADDITION|ENCLOSE|ENCLOSURE|CONVERSION/);

  const roofAge = yearBuilt ? currentYear - yearBuilt : null;
  list.push({
    item: 'Roof',
    whatPermitRecordSays: hasReroof
      ? 'A re-roof permit is on file. Note the issue year and compare.'
      : yearBuilt
        ? `No re-roof permit on file. House is ${roofAge} years old, so if the roof dates to ${yearBuilt} it is well past the 15–25 year shingle / 25–40 year tile service life typical in Florida.`
        : 'No re-roof permit on file and year-built is unknown.',
    whatToLookFor:
      'On the satellite image (inside the red outline), compare the roof tone and pattern to the neighbors. Bright, uniform, clean lines = newer; streaky, algae-stained, patched = original. On Street View, scrub the timeline — a sudden roof-color change between two years is a dated reroof.',
    ifMismatchMeans:
      'A visibly newer roof with no re-roof permit on file is a likely unpermitted re-roof. Florida counties require a permit for anything beyond spot repair; no permit means no wind-mitigation certificate and potential insurance issues for the buyer.',
  });

  const fenceFeature = features.find((f) => /FENCE/i.test(f.description));
  if (fenceFeature && !hasFence) {
    list.push({
      item: 'Fence',
      whatPermitRecordSays: `Property Appraiser records a ${fenceFeature.description}${fenceFeature.actualYearBuilt ? ` dated to ${fenceFeature.actualYearBuilt}` : ''}. No fence permit on file.`,
      whatToLookFor:
        'On Street View and in the satellite view, confirm the fence exists along the property line. Note height and material (wood, chain-link, PVC, CBS wall).',
      ifMismatchMeans:
        'A 6ft+ fence in most Florida jurisdictions requires a permit. If visible, this is a likely unpermitted fence — typically minor to resolve after-the-fact.',
    });
  }

  const patioFeature = features.find((f) => /PATIO|SLAB|PORCH/i.test(f.description));
  if (patioFeature && !hasPatio) {
    list.push({
      item: 'Patio / concrete slab',
      whatPermitRecordSays: `Property Appraiser records a ${patioFeature.description} (${patioFeature.units ?? '?'} sq ft)${patioFeature.actualYearBuilt ? ` dated to ${patioFeature.actualYearBuilt}` : ''}. No patio / slab permit on file.`,
      whatToLookFor:
        'Inside the red polygon on the satellite image, look at the rear yard — concrete slabs show as bright rectangles against grass. Note size and whether a roof cover sits on top (screen enclosure, tile cover, flat roof).',
      ifMismatchMeans:
        'An unpermitted slab is usually fine structurally; an unpermitted COVERED patio (roof over slab) is a real flag because it needs wind-load engineering in HVHZ.',
    });
  }

  const shedFeature = features.find((f) => /SHED|UTILITY BLDG|DETACH|GAZEBO|CABANA/i.test(f.description));
  if (shedFeature && !hasShed) {
    list.push({
      item: 'Shed / detached structure',
      whatPermitRecordSays: `Property Appraiser records a ${shedFeature.description}${shedFeature.actualYearBuilt ? ` dated to ${shedFeature.actualYearBuilt}` : ''}. No shed / detached-structure permit on file.`,
      whatToLookFor:
        'Inside the red polygon, look for freestanding structures in the side or rear yard. Anything over ~100 sq ft in most Florida jurisdictions needs a permit.',
      ifMismatchMeans:
        'Unpermitted sheds over 100 sq ft are a common permit-rescue item; straightforward but costs money.',
    });
  }

  const poolFeature = features.find((f) => /POOL|SPA/i.test(f.description));
  if (poolFeature && !hasPool) {
    list.push({
      item: 'Pool / spa',
      whatPermitRecordSays: `Property Appraiser records a ${poolFeature.description}${poolFeature.actualYearBuilt ? ` dated to ${poolFeature.actualYearBuilt}` : ''}. No pool permit on file.`,
      whatToLookFor:
        'Inside the red polygon, the pool should be visible as a bright blue rectangle / kidney shape. Note whether it has a screen enclosure (visible as a gray mesh overlay). Pools OUTSIDE the polygon are neighbors\' and are not your concern.',
      ifMismatchMeans:
        'An unpermitted pool added after the house was built is a serious flag — pools require structural, electrical, and barrier permits. Legalizing after-the-fact is expensive.',
    });
  }

  if (roofAge && roofAge >= 20 && !hasWindows) {
    list.push({
      item: 'Windows / doors',
      whatPermitRecordSays:
        'No window or door replacement permit on file. Impact windows have been the Florida standard since post-Andrew; absence of any permit on a 20+ year old house suggests either originals or unpermitted replacement.',
      whatToLookFor:
        'On Street View, compare window frames to the vintage of the house — new impact windows have thicker aluminum or vinyl frames and often a visible NOA sticker. Compare door hardware and door color across timeline.',
      ifMismatchMeans:
        'Unpermitted window replacement is extremely common in Florida and a real flag for buyer insurance. No NOA approval paperwork means no wind-mitigation credit.',
    });
  }

  if (roofAge && roofAge >= 15 && !hasAC) {
    list.push({
      item: 'HVAC (A/C condenser + air handler)',
      whatPermitRecordSays:
        'No mechanical / A/C permit on file. Average condenser lifespan in Florida is 10–15 years.',
      whatToLookFor:
        'On Street View, look at the side of the house for the outdoor condenser unit. Shiny coil fins and visible model-year sticker = newer; rusted, weathered = original.',
      ifMismatchMeans:
        'A/C swaps without permits are widespread. Minor to fix after-the-fact but must be disclosed to the buyer and insurer.',
    });
  }

  if (!hasAddition) {
    list.push({
      item: 'Additions / enclosures',
      whatPermitRecordSays: 'No addition, enclosure, or conversion permit on file.',
      whatToLookFor:
        'On the satellite image (inside the red polygon only), trace the house footprint and compare to neighbors. Look for: a visible joint where old roof meets new roof; a rectangular extension off the original footprint; a garage door that has been infilled.',
      ifMismatchMeans:
        'A visible addition / enclosed garage / rear extension with no permit is the most expensive unpermitted work to resolve — often requires full engineering and 3x original cost to legalize.',
    });
  }

  return list;
}

function sentenceize(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];
}

function summarizeBuckets(buckets: Record<number, ExtraFeature[]>, yearBuilt: number | null): string[] {
  const out: string[] = [];
  if (!yearBuilt) return out;
  const postBuildYears = Object.keys(buckets)
    .map(Number)
    .filter((y) => y > yearBuilt)
    .sort();
  for (const y of postBuildYears) {
    const items = buckets[y].map((f) => f.description.toLowerCase());
    out.push(`${y} additions on file (${sentenceize(items)})`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function runDiagnostic(input: {
  address?: string;
  folio?: string;
  userThenPhoto?: UserUploadedThen | null;
}): Promise<DiagnosticReport> {
  const rawAddress = (input.address ?? '').trim();
  if (!rawAddress && !input.folio) {
    throw new Error('Provide an address.');
  }

  // 1. Geocode. If no county comes back (Census fallback), reverse-lookup via FCC.
  const geoInput = rawAddress || `Florida folio ${input.folio}`;
  let geo = await geocode(geoInput);
  if (!geo) {
    throw new Error(
      `Could not geocode "${rawAddress}". Confirm the address spelling and that it is in Florida.`,
    );
  }
  let countyKey = geo.county;
  if (!countyKey) {
    countyKey = await reverseCounty(geo.lat, geo.lng);
  }
  const countyInfo = toCountyInfo(countyKey);

  // 2. County adapter.
  const adapter = getCountyAdapter(countyKey);
  const adapterResult = adapter
    ? await adapter.run({
        address: geo.formattedAddress || rawAddress,
        zip: null,
        lat: geo.lat,
        lng: geo.lng,
      })
    : (await import('./counties/types')).emptyResult(
        [],
        [
          `No county adapter available for "${countyInfo.name}". Imagery-only diagnostic.`,
        ],
      );

  // 3. Parcel polygon.
  const polygon = await fetchParcelPolygon(geo.lat, geo.lng, countyKey);

  // 4. Google Static Maps URLs with polygon overlay.
  const closeSatUrl = buildSubjectSatelliteUrl(geo.lat, geo.lng, polygon.polygon);
  const contextSatUrl = buildContextSatelliteUrl(geo.lat, geo.lng, polygon.polygon);

  // 5. Street View + historical NAIP (in parallel). Street View is now
  //    heading-aware: we look up the pano location and aim back at the
  //    parcel, so the AI gets the actual front of the subject instead of
  //    4 cardinal-direction frames where 2-3 face nothing useful.
  //    Historical NAIP comes from Planetary Computer; it's fine if it
  //    returns nothing outside the continental US or where coverage is
  //    sparse.
  const [streetViewImages, historicalAerials] = await Promise.all([
    buildStreetViewUrlsTowardParcel(geo.lat, geo.lng, { fov: 90 }),
    fetchHistoricalAerials(geo.lat, geo.lng, polygon.polygon),
  ]);

  // 5b. Historical Street View (Mapillary). Runs after the current Street
  //     View call because we want to know whether to even bother — if there
  //     are no current panos at all, the subject is in a gated/private area
  //     where Mapillary almost certainly has nothing either.
  const historicalStreetView = await fetchHistoricalStreetView(
    geo.lat,
    geo.lng,
    streetViewImages,
  );

  // 6. Vision comparison — THEN (historical NAIP + historical Street View)
  //    vs NOW (current Google sat + current Street View).
  const features = adapterResult.extraFeatures;
  const permits = adapterResult.permits;
  const yearBuilt = adapterResult.propertyBasics.yearBuilt;

  const visualComparison = await compareImagery({
    closeSatelliteUrl: closeSatUrl,
    contextSatelliteUrl: contextSatUrl,
    streetViewImages,
    thenAerial: historicalAerials.then,
    nowAerial: historicalAerials.now,
    // Pass every Mapillary side pair so corner properties get full coverage.
    streetViewSides: historicalStreetView.sides,
    // Realtor-supplied historical photo (optional). When provided, the AI
    // uses it as the canonical THEN frame for facade-level comparison even
    // if Google/Mapillary failed to find a usable front-facing capture.
    userUploadedThen: input.userThenPhoto ?? null,
    permits,
    features,
    yearBuilt,
    polygonIsFallback: polygon.isFallback,
  });

  // 7. Assemble the final DiagnosticReport.
  const buckets = yearBuckets(features);
  const codeEnf = { open: adapterResult.codeCasesOpen, closedPast5: adapterResult.codeCasesClosedPast5 };

  const flags = buildFlags(
    permits,
    adapterResult.neighborPermitTotal,
    buckets,
    codeEnf,
    adapterResult.propertyBasics.homesteadStatusText,
    yearBuilt,
    countyInfo.name,
  );

  const confidence = buildConfidence(
    permits.length,
    codeEnf.open.length + codeEnf.closedPast5.length,
    adapterResult.found,
    adapterResult.neighborPermitTotal,
    countyInfo.tier,
    countyInfo.name,
  );

  const nextSteps = buildNextSteps(
    permits,
    flags,
    countyInfo.name,
    countyInfo.tier,
    {
      propertyAppraiser: countyInfo.portals.propertyAppraiser,
      buildingDept: countyInfo.portals.buildingDept,
    },
  );

  const postBuildSummary = summarizeBuckets(buckets, yearBuilt);

  const heated = adapterResult.propertyBasics.heatedArea;
  const lot = adapterResult.propertyBasics.lotSize;

  const bottomLine: string[] = [];
  bottomLine.push(
    `${yearBuilt ?? '?'}-built ${adapterResult.propertyBasics.dorDescription ?? 'property'}, ` +
      `${heated ?? '?'} heated sq ft on a ${lot ?? '?'} sq ft lot.`,
  );
  if (countyInfo.tier === 'B') {
    bottomLine.push(
      `${countyInfo.name} is on the links-only tier — diagnostic leans on the AI visual comparison (satellite + Street View, parcel-bounded) plus the portal links. Use them to verify.`,
    );
  } else {
    bottomLine.push(
      permits.length === 0
        ? `Zero building permits on file in the ${countyInfo.name} public archive. Neighbors on the same block show ${adapterResult.neighborPermitTotal} combined permits.`
        : `${permits.length} building permit(s) on file for this parcel.`,
    );
  }
  if (postBuildSummary.length > 0) {
    bottomLine.push(
      `The Property Appraiser's own extra-features record lists ${sentenceize(postBuildSummary)} — none of which are matched by a permit on file.`,
    );
  }
  if (codeEnf.open.length > 0) {
    bottomLine.push(`${codeEnf.open.length} OPEN code enforcement case(s) against this parcel. Resolve before closing.`);
  } else if (codeEnf.closedPast5.length > 0) {
    bottomLine.push(
      `${codeEnf.closedPast5.length} closed code case(s) in the past 5 years. Read the detail to see whether any were construction-related.`,
    );
  }
  bottomLine.push('This is a records + imagery triage, not a confirmed violation. Verify with the AHJ before acting.');

  const thenVsNow: ThenVsNow = {
    coordinates: { lat: geo.lat, lng: geo.lng },
    satelliteImageUrl: closeSatUrl,
    contextSatelliteImageUrl: contextSatUrl,
    streetViewImages,
    streetViewUrl: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${geo.lat},${geo.lng}`,
    streetViewTimelineUrl: `https://www.google.com/maps?q=&layer=c&cbll=${geo.lat},${geo.lng}&cbp=11,0,0,0,0`,
    historicalAerialUrl: countyInfo.portals.historicalAerial,
    satelliteUrl: `https://www.google.com/maps/@${geo.lat},${geo.lng},20z/data=!3m1!1e3`,
    parcelPolygon: polygon.polygon,
    parcelPolygonSource: polygon.source,
    visualChecklist: buildVisualChecklist(yearBuilt, permits, features),
    visualComparison,
    historicalAerials,
    historicalStreetView,
    userUploadedThen: input.userThenPhoto ?? null,
  };

  const dataSources: string[] = [
    `Geocoding: ${geo.source === 'google' ? 'Google Geocoding API' : 'US Census Bureau Geocoder (no key)'}`,
    `Parcel boundary: ${polygon.source}`,
    'Google Static Maps (satellite) for current aerial view, with parcel polygon drawn in red',
    'Google Street View Static API for ground-level imagery',
    ...adapterResult.sourcesTried,
  ];
  if (visualComparison.performed) {
    dataSources.push(`Anthropic Claude (${visualComparison.modelUsed}) for AI visual comparison`);
  }
  if (historicalAerials.then && historicalAerials.now) {
    dataSources.push(
      `Microsoft Planetary Computer (USDA NAIP) for historical aerial imagery — compared ${historicalAerials.then.captureYear} vs ${historicalAerials.now.captureYear}`,
    );
  }
  if (historicalStreetView.then && historicalStreetView.now) {
    const src = historicalStreetView.source ?? 'Historical Street View';
    dataSources.push(
      `${src} — compared ${historicalStreetView.then.captureYear} vs ${historicalStreetView.now.captureYear}`,
    );
  }

  const dataLimitations: string[] = [
    ...adapterResult.notes,
    'Records reflect the digital portal only. Paper/microfilm permit archives predating county digital migration may not appear.',
    polygon.isFallback
      ? 'No parcel polygon was available for this county; a synthetic ~120ft box was drawn around the geocoded point as a subject-area hint. This reduces the accuracy of the neighbor/subject distinction.'
      : 'Parcel polygon came from a live county or statewide source; AI visual analysis was constrained to the area inside the red outline.',
    'This tool never makes legal or final compliance determinations. Always verify with the AHJ before acting.',
  ];

  const finalReport: DiagnosticReport = {
    generatedAt: new Date().toISOString(),
    query: {
      address: rawAddress || geo.formattedAddress,
      zip: null,
    },
    property: {
      folio: adapterResult.propertyBasics.prettyFolio ?? adapterResult.propertyBasics.folio,
      siteAddress: adapterResult.propertyBasics.siteAddress ?? geo.formattedAddress ?? null,
      mailingAddress: adapterResult.propertyBasics.mailingAddress,
      mailingMatchesSite: adapterResult.propertyBasics.mailingMatchesSite,
      owner: adapterResult.propertyBasics.owner,
      subdivision: adapterResult.propertyBasics.subdivision,
      yearBuilt: adapterResult.propertyBasics.yearBuilt,
      heatedArea: adapterResult.propertyBasics.heatedArea,
      totalArea: adapterResult.propertyBasics.totalArea,
      lotSize: adapterResult.propertyBasics.lotSize,
      bedrooms: adapterResult.propertyBasics.bedrooms,
      bathrooms: adapterResult.propertyBasics.bathrooms,
      dorDescription: adapterResult.propertyBasics.dorDescription,
      zoning: adapterResult.propertyBasics.zoning,
      homesteadBaseYear: adapterResult.propertyBasics.homesteadBaseYear,
      homesteadPercent: adapterResult.propertyBasics.homesteadPercent,
      homesteadStatusText: adapterResult.propertyBasics.homesteadStatusText,
    },
    sales: adapterResult.sales,
    extraFeatures: features,
    permitHistory: {
      totalSubjectPermits: permits.length,
      subjectPermits: permits,
      totalInspections: adapterResult.inspectionCount,
      neighborPermitCount: adapterResult.neighborPermitTotal,
      neighborByAddress: adapterResult.neighborByAddress,
    },
    codeEnforcement: {
      openCount: codeEnf.open.length,
      closedPast5yCount: codeEnf.closedPast5.length,
      openCases: codeEnf.open,
      closedCases: codeEnf.closedPast5,
    },
    flags,
    confidenceAssessment: confidence,
    nextSteps,
    dataSources,
    dataLimitations,
    ahj: {
      slug: countyInfo.slug,
      name: countyInfo.name + ' Building Department',
      note: countyInfo.scraperNote,
    },
    county: countyInfo,
    thenVsNow,
    bottomLine,
  };

  // Append every successful diagnostic to the Palma Ledger. Fire-and-log:
  // ledger failures NEVER block the user response. Skipped silently for
  // counties not yet in scope (Miami-Dade / Broward / Palm Beach in Phase 1).
  await recordToLedger(countyKey, { lat: geo.lat, lng: geo.lng }, finalReport);

  return finalReport;
}

// Used by /api/check/pdf to ensure a CountyInfo is present even on legacy
// clients that POST an older-shape report back to the server.
export { FL_COUNTY_DIRECTORY };
