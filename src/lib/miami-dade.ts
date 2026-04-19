// Miami-Dade pipeline — public unauthenticated endpoints only.
//
// The Property Appraiser exposes a rich JSON endpoint for folio lookups.
// The RER Open Data ArcGIS FeatureServer exposes permit, inspection, and
// code-enforcement datasets that mirror what the gated portals hide
// behind reCAPTCHA + OAuth. We use those directly — no API keys.

import type { DiagnosticReport, Flag, Sale, ExtraFeature, Permit, CodeCase } from './types';

const PA_PROXY =
  'https://apps.miamidadepa.gov/PAPublicServiceProxy/PaServicesProxy.ashx';
const ARCGIS_BASE =
  'https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/ArcGIS/rest/services';

// ----------------------------------------------------------------------------
// Small fetch helpers
// ----------------------------------------------------------------------------

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function fromEpochMs(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function cleanString(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s.replace(/\s+/g, ' ').trim();
}

function compactFolio(folio: string): string {
  return folio.replace(/\D+/g, '').padStart(13, '0').slice(-13);
}

function prettyFolio(folio: string): string {
  const f = compactFolio(folio);
  if (f.length !== 13) return folio;
  return `${f.slice(0, 2)}-${f.slice(2, 6)}-${f.slice(6, 9)}-${f.slice(9, 13)}`;
}

// ----------------------------------------------------------------------------
// Property Appraiser lookups
// ----------------------------------------------------------------------------

export async function paByAddress(address: string): Promise<{
  folio: string | null;
  candidates: Array<{ folio: string; address: string }>;
}> {
  // Strip city/state/zip from the address — PA GetAddress requires the bare
  // street form ("4202 SW 84 CT") with no comma, no city, no state, no zip.
  // The endpoint returns: "Could not find this address. The correct format is
  // 'Address' without city, state, or zip code." if anything else is present.
  const bare = address
    .split(',')[0] // everything up to the first comma
    .replace(/\s+\d{5}(-\d{4})?\s*$/, '') // trailing zip if there's no comma
    .replace(/\s+(miami|fl|florida)\s*.*$/i, '') // bare-string city/state
    .replace(/\s+/g, ' ')
    .trim();
  const url =
    PA_PROXY +
    '?Operation=GetAddress&clientAppName=PropertySearch' +
    '&from=1&to=25' +
    '&myAddress=' + encodeURIComponent(bare) +
    '&myUnit=';
  const data = await fetchJson(url).catch(() => null);
  if (!data) return { folio: null, candidates: [] };
  const list: any[] =
    data?.MinimumPropertyInfos ??
    data?.MinimumPropertyInfo ??
    data?.SearchResults ??
    [];
  if (!Array.isArray(list) || list.length === 0) return { folio: null, candidates: [] };
  const cands = list.map((r: any) => ({
    folio: compactFolio(String(r.Strap ?? r.Folio ?? r.FOLIO ?? '')),
    address: cleanString(r.SiteAddress ?? r.Address ?? ''),
  })).filter((c) => c.folio.length === 13);
  return { folio: cands[0]?.folio ?? null, candidates: cands };
}

export async function paByFolio(folio: string): Promise<any | null> {
  const url =
    PA_PROXY +
    '?Operation=GetPropertySearchByFolio&clientAppName=PropertySearch' +
    '&folioNumber=' + encodeURIComponent(compactFolio(folio));
  return fetchJson(url).catch(() => null);
}

// ----------------------------------------------------------------------------
// ArcGIS layer queries
// ----------------------------------------------------------------------------

async function arcgisQuery(service: string, where: string, out: string = '*'): Promise<any[]> {
  const url =
    `${ARCGIS_BASE}/${encodeURIComponent(service)}/FeatureServer/0/query` +
    `?where=${encodeURIComponent(where)}` +
    `&outFields=${encodeURIComponent(out)}` +
    `&returnGeometry=false&f=json&resultRecordCount=200`;
  const data = await fetchJson(url).catch(() => null);
  if (!data || !Array.isArray(data.features)) return [];
  return data.features.map((f: any) => f.attributes ?? {});
}

export async function permitsByFolio(folio: string): Promise<Permit[]> {
  const f = compactFolio(folio);
  const rows = await arcgisQuery(
    'BuildingPermit_gdb',
    `FOLIO='${f}'`,
    'FOLIO,PROCNUM,APPTYPE,ISSUDATE,BPSTATUS,ESTVALUE,CONTRNAME,DESC1,DESC2'
  );
  return rows.map((r) => ({
    permitNumber: cleanString(r.PROCNUM) || null,
    processNumber: cleanString(r.PROCNUM) || null,
    appType: cleanString(r.APPTYPE) || null,
    issueDate: fromEpochMs(r.ISSUDATE),
    status: cleanString(r.BPSTATUS) || null,
    estValue: typeof r.ESTVALUE === 'number' ? r.ESTVALUE : null,
    contractor: cleanString(r.CONTRNAME) || null,
    scope: [cleanString(r.DESC1), cleanString(r.DESC2)].filter(Boolean).join(' — ') || null,
  }));
}

export async function inspectionsByAddress(addressFragment: string): Promise<number> {
  const frag = addressFragment.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().toUpperCase();
  if (!frag) return 0;
  const rows = await arcgisQuery(
    'inspectionsData',
    `job_site_address LIKE '%${frag.replace(/'/g, "''")}%'`,
    'permit_number,job_site_address'
  );
  return rows.length;
}

export async function neighborPermits(folio: string): Promise<{
  total: number;
  byAddress: Array<{ address: string; count: number }>;
}> {
  // Same block — FOLIO LIKE '<first9digits>%'
  const f = compactFolio(folio);
  const prefix = f.slice(0, 9);
  if (prefix.length !== 9) return { total: 0, byAddress: [] };
  const rows = await arcgisQuery(
    'BuildingPermit_gdb',
    `FOLIO LIKE '${prefix}%' AND FOLIO <> '${f}'`,
    'FOLIO,ADDRESS,PROCNUM'
  );
  const by = new Map<string, number>();
  for (const r of rows) {
    const a = cleanString(r.ADDRESS);
    if (!a) continue;
    by.set(a, (by.get(a) ?? 0) + 1);
  }
  const sorted = Array.from(by.entries())
    .map(([address, count]) => ({ address, count }))
    .sort((a, b) => b.count - a.count);
  return { total: rows.length, byAddress: sorted.slice(0, 12) };
}

async function codeCaseQuery(service: string, folio: string): Promise<CodeCase[]> {
  const f = compactFolio(folio);
  // Try both FOLIO and PARCELNUMBER — different endpoints use different field names
  const where =
    service.startsWith('Energov') ? `PARCELNUMBER='${f}'` : `FOLIO='${f}'`;
  const rows = await arcgisQuery(service, where);
  return rows.map((r) => ({
    caseNumber: cleanString(r.CASE_NUM ?? r.CASENUMBER ?? ''),
    caseDate: fromEpochMs(r.CASE_DATE ?? r.OPENEDDATE),
    status: cleanString(r.STAT_DESC ?? r.STATUS ?? r.CASE_STATUS ?? ''),
    problemDescription: cleanString(r.PROBLEM_DESC ?? r.DESCRIPTION ?? ''),
    lastAction: cleanString(r.LAST_ACTV ?? ''),
    lien: cleanString(r.LN_RFRLTYP ?? ''),
  }));
}

export async function codeEnforcement(folio: string): Promise<{
  open: CodeCase[];
  closedPast5: CodeCase[];
}> {
  const [open1, open2, open3, closed1, ener1] = await Promise.all([
    codeCaseQuery('CodeComplianceViolation_Open_View', folio),
    codeCaseQuery('Open_Building_Violations', folio),
    codeCaseQuery('BuildingViolation_gdb', folio),
    codeCaseQuery('CodeComplianceViolation_ClosedPast5Years_View', folio),
    codeCaseQuery('EnergovCodeCasePublicView', folio),
  ]);
  const seen = new Set<string>();
  const open = [...open1, ...open2, ...open3, ...ener1].filter((c) => {
    const k = c.caseNumber + '|' + c.caseDate;
    if (seen.has(k)) return false;
    seen.add(k);
    return Boolean(c.caseNumber);
  });
  const closedPast5 = closed1.filter((c) => Boolean(c.caseNumber));
  return { open, closedPast5 };
}

// ----------------------------------------------------------------------------
// Assemble the full DiagnosticReport
// ----------------------------------------------------------------------------

function parseHomestead(pa: any): {
  baseYear: number | null;
  percent: number | null;
  statusText: string;
} {
  const pi = pa?.PropertyInfo ?? {};
  const base = typeof pi.HxBaseYear === 'number' ? pi.HxBaseYear : null;
  const pct =
    typeof pi.PercentHomesteadCapped === 'number' ? pi.PercentHomesteadCapped : null;

  // Check latest three years of taxable info
  const taxInfos: any[] = pa?.Taxable?.TaxableInfos ?? [];
  const recentYears = taxInfos
    .filter((t) => typeof t?.Year === 'number')
    .sort((a, b) => b.Year - a.Year)
    .slice(0, 3);
  const exemptZeroYears = recentYears
    .filter((t) => (t.CountyExemptionValue ?? 0) === 0)
    .map((t) => String(t.Year));

  let text = '';
  if (base && base > 1900) {
    text = `Homestead on file — HxBaseYear ${base}. `;
  } else {
    text = 'No homestead on file. ';
  }
  if (exemptZeroYears.length > 0) {
    text += `CountyExemptionValue $0 for: ${exemptZeroYears.join(', ')}.`;
  }
  return { baseYear: base, percent: pct, statusText: text.trim() };
}

function dedupeExtraFeatures(arr: any[]): ExtraFeature[] {
  const seen = new Set<string>();
  const out: ExtraFeature[] = [];
  for (const raw of arr) {
    const feature: ExtraFeature = {
      description: cleanString(raw.Description ?? ''),
      units: typeof raw.Units === 'number' ? raw.Units : null,
      actualYearBuilt:
        typeof raw.ActualYearBuilt === 'number' ? raw.ActualYearBuilt : null,
    };
    if (!feature.description) continue;
    const key = `${feature.description}|${feature.units}|${feature.actualYearBuilt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(feature);
  }
  return out;
}

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
  pa: any,
  permits: Permit[],
  neighborTotal: number,
  buckets: Record<number, ExtraFeature[]>,
  codeEnf: { open: CodeCase[]; closedPast5: CodeCase[] },
  homesteadStatusText: string,
  yearBuilt: number | null,
): { strong: Flag[]; medium: Flag[]; weak: Flag[] } {
  const strong: Flag[] = [];
  const medium: Flag[] = [];
  const weak: Flag[] = [];

  // Strong: any extra-feature-bucket dated AFTER year built with NO matching permit
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
      // Is there any permit within +/- 2 years of this addition year?
      const matching = permits.filter((p) => {
        if (!p.issueDate) return false;
        const py = Number(p.issueDate.slice(0, 4));
        return Math.abs(py - y) <= 2;
      });
      if (matching.length === 0) {
        strong.push({
          severity: 'strong',
          title: `${y} additions with no matching permit on file`,
          detail: `The Property Appraiser's extra-features record dates the following to ${y}, ${y - yearBuilt} year(s) after the original ${yearBuilt} construction: ${itemList}. No permits issued in ${y - 2}–${y + 2} appear in the Miami-Dade public permit database for this folio.`,
        });
      }
    }
  }

  // Strong: zero permits on the entire parcel while neighbors have many
  if (permits.length === 0 && neighborTotal >= 5) {
    strong.push({
      severity: 'strong',
      title: 'Zero permits on file — neighbors have many',
      detail: `This parcel has no records in the county's digital permit archive. Adjacent parcels on the same block show ${neighborTotal} permits combined. Most likely explanations: work was unpermitted, records never migrated from paper/microfilm into the current portal, or records filed under a different folio. Certified records pull required.`,
    });
  }

  // Medium: major long-cycle systems (roof, A/C, water heater) with no permit on a
  // house over 15 years old
  if (permits.length === 0 && yearBuilt && new Date().getFullYear() - yearBuilt >= 15) {
    medium.push({
      severity: 'medium',
      title: 'Long-cycle systems never permitted despite age',
      detail: `House is ${new Date().getFullYear() - yearBuilt} years old with no re-roof, A/C swap, water-heater swap, or window-replacement permit on file. A/C and water heaters typically reach end-of-life well before this; if they were replaced, they were replaced without permits.`,
    });
  }

  // Medium: non-homestead profile
  if (/\$0 for:/.test(homesteadStatusText)) {
    medium.push({
      severity: 'medium',
      title: 'Non-homestead profile correlates with unpermitted repairs',
      detail: `${homesteadStatusText} Absentee-owner properties show a higher rate of unpermitted repairs in Miami-Dade code-enforcement statistics. This increases the prior probability that the flags above reflect real gaps.`,
    });
  }

  // Weak: any past code case, even unrelated (tells us an inspector was onsite)
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
  paOk: boolean,
  neighborCount: number,
): DiagnosticReport['confidenceAssessment'] {
  return [
    {
      topic: 'Property basics (owner, address, year built, size)',
      grade: paOk ? 'high' : 'low',
      note: paOk
        ? 'Pulled live from the Miami-Dade Property Appraiser public JSON endpoint.'
        : 'Property Appraiser endpoint did not resolve this address. Results limited.',
    },
    {
      topic: 'Permit record',
      grade: paOk ? 'high' : 'low',
      note:
        permitCount === 0
          ? 'Zero permits across the Miami-Dade BuildingPermit_gdb archive. High confidence that nothing is in the digital system; does NOT rule out paper archives.'
          : `${permitCount} permits retrieved from the live ArcGIS endpoint.`,
    },
    {
      topic: 'Code enforcement',
      grade: 'high',
      note:
        codeEnfCount === 0
          ? 'No cases in any of the six code-compliance endpoints (Open, Civil, Lien, Closed-past-5y, Energov, Building).'
          : `${codeEnfCount} case(s) retrieved across code-compliance endpoints.`,
    },
    {
      topic: 'Unpermitted-work inference',
      grade: 'medium',
      note:
        'Inference compares extra-features actual-year-built to permit issue-date. Strong signal when neighbor permits exist but subject has none. Certified records pull by address will upgrade to high or rule out entirely.',
    },
    {
      topic: 'Neighbor comparison',
      grade: neighborCount > 0 ? 'high' : 'low',
      note:
        neighborCount > 0
          ? `${neighborCount} permits found on parcels in the same block (same 9-digit folio prefix).`
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
): string[] {
  const s: string[] = [];
  if (permits.length === 0) {
    s.push(
      'Pull a certified records package from the Miami-Dade Building Department — by ADDRESS, not just folio. Request everything from five years before the original year built through today. This is the single most important step. If the original build plus any additions come back permitted but misfiled, the whole report changes.',
    );
  }
  if (flags.strong.length > 0) {
    s.push(
      'Ask the seller / listing agent for any permit paperwork — original construction permit, any invoices, any inspection approvals. A single document can close the biggest strong flag fast.',
    );
  }
  s.push(
    'Walk the property with eyes on the specific features the Property Appraiser dates as post-build additions. Look for cold joints at the concrete-to-original boundary; look for a permit sticker or engineer stamp on any rear wall; look for permit-card residue on fence posts.',
  );
  s.push(
    'Open the Google Maps Street View timeline manually (10 minutes): pegman on address → clock icon → scrub oldest-available pano to most recent. If the additions appear between two specific years, that photographically confirms (or refutes) the Property Appraiser extra-features dates.',
  );
  if (flags.strong.length > 0) {
    s.push(
      'If work is confirmed unpermitted, ask the seller to run after-the-fact permits (permit rescue) before closing. In Miami-Dade this usually means an engineer letter, as-builts, and double fees. Budget 3x the original scope cost as a rule of thumb.',
    );
  }
  s.push(
    'If the owner refuses or cannot legalize the work, price the unpermitted work into your offer and get a written disclosure naming each specific item.',
  );
  return s;
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

function formatSales(pa: any): Sale[] {
  const arr = Array.isArray(pa?.SalesInfos) ? pa.SalesInfos : [];
  return arr.map((s: any) => ({
    date: cleanString(s.DateOfSale) || null,
    price: typeof s.SalePrice === 'number' ? s.SalePrice : null,
    qualificationDescription: cleanString(s.QualificationDescription) || null,
  }));
}

function mailingMatchesSite(pa: any): { matches: boolean | null; mail: string | null; site: string | null } {
  const site = pa?.SiteAddress?.[0]?.Address as string | undefined;
  const mail = pa?.MailingAddress?.Address1 as string | undefined;
  if (!site || !mail) return { matches: null, mail: mail ?? null, site: site ?? null };
  const s = site.trim().toUpperCase();
  const m = mail.trim().toUpperCase();
  return { matches: s === m, mail, site };
}

// ----------------------------------------------------------------------------
// Main entry — run(address | folio)
// ----------------------------------------------------------------------------

export async function runDiagnostic(input: {
  address?: string;
  folio?: string;
}): Promise<DiagnosticReport> {
  // 1. Resolve folio
  let folio = input.folio ? compactFolio(input.folio) : null;
  let resolvedAddress = input.address ?? '';

  if (!folio && input.address) {
    const byAddr = await paByAddress(input.address);
    folio = byAddr.folio;
    if (folio && byAddr.candidates[0]) {
      resolvedAddress = byAddr.candidates[0].address || input.address;
    }
  }
  if (!folio) {
    throw new Error(
      `Could not resolve address "${input.address ?? ''}" to a Miami-Dade folio. ` +
        `The app currently supports unincorporated Miami-Dade County and cities within it. ` +
        `If this is in Miami Beach, Coral Gables, or another city with its own portal, ` +
        `the v1 pipeline does not yet cover it.`,
    );
  }

  // 2. Pull everything in parallel
  const [pa, permits, neighbors, codeEnf, inspectionCount] = await Promise.all([
    paByFolio(folio),
    permitsByFolio(folio),
    neighborPermits(folio),
    codeEnforcement(folio),
    inspectionsByAddress(resolvedAddress),
  ]);

  if (!pa) throw new Error(`PA lookup failed for folio ${folio}.`);

  const pi = pa.PropertyInfo ?? {};
  const owner = cleanString(pa.OwnerInfos?.[0]?.Name);
  const site = pa.SiteAddress?.[0]?.Address as string | undefined;
  const zip = pa.SiteAddress?.[0]?.ZipCode as string | undefined;
  const mailMatch = mailingMatchesSite(pa);

  const homestead = parseHomestead(pa);
  const features = dedupeExtraFeatures(pa.ExtraFeature?.ExtraFeatureInfos ?? []);
  const buckets = yearBuckets(features);

  const flags = buildFlags(
    pa,
    permits,
    neighbors.total,
    buckets,
    codeEnf,
    homestead.statusText,
    pi.YearBuilt ?? null,
  );

  const confidence = buildConfidence(
    permits.length,
    codeEnf.open.length + codeEnf.closedPast5.length,
    true,
    neighbors.total,
  );

  const nextSteps = buildNextSteps(permits, flags);

  const postBuildSummary = summarizeBuckets(buckets, pi.YearBuilt ?? null);
  const bottomLine: string[] = [];
  bottomLine.push(
    `${pi.YearBuilt ?? '?'}-built ${pi.DORDescription ?? 'property'}, ` +
      `${pi.BuildingHeatedArea ?? '?'} heated sq ft on a ${pi.LotSize ?? '?'} sq ft lot.`,
  );
  bottomLine.push(
    permits.length === 0
      ? 'Zero building permits on file in the Miami-Dade public ArcGIS archive. Neighbors on the same block show ' +
          `${neighbors.total} combined permits.`
      : `${permits.length} building permit(s) on file for this parcel.`,
  );
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
  if (/\$0 for:/.test(homestead.statusText)) {
    bottomLine.push(
      `Homestead: ${homestead.statusText} Owner mailing ${mailMatch.matches === false ? 'does NOT match' : 'matches'} site address.`,
    );
  }
  bottomLine.push('This is a records flag, not a confirmed violation. Verify with the AHJ before acting.');

  return {
    generatedAt: new Date().toISOString(),
    query: {
      address: input.address ?? resolvedAddress,
      zip: zip ?? null,
    },
    property: {
      folio: prettyFolio(folio),
      siteAddress: site ?? null,
      mailingAddress: mailMatch.mail,
      mailingMatchesSite: mailMatch.matches,
      owner: owner || null,
      subdivision: cleanString(pa.LegalDescription?.[0]?.Description ?? '') || null,
      yearBuilt: pi.YearBuilt ?? null,
      heatedArea: pi.BuildingHeatedArea ?? null,
      totalArea: pi.BuildingActualArea ?? null,
      lotSize: pi.LotSize ?? null,
      bedrooms: pi.BedroomCount ?? null,
      bathrooms: pi.BathroomCount ?? null,
      dorDescription: cleanString(pi.DORDescription ?? '') || null,
      zoning: cleanString(pi.PrimaryZone ?? '') || null,
      homesteadBaseYear: homestead.baseYear,
      homesteadPercent: homestead.percent,
      homesteadStatusText: homestead.statusText,
    },
    sales: formatSales(pa),
    extraFeatures: features,
    permitHistory: {
      totalSubjectPermits: permits.length,
      subjectPermits: permits,
      totalInspections: inspectionCount,
      neighborPermitCount: neighbors.total,
      neighborByAddress: neighbors.byAddress,
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
    dataSources: [
      'Miami-Dade Property Appraiser public JSON (PaServicesProxy): owner, building, extra features, sales, benefit/taxable',
      'Miami-Dade Open Data (ArcGIS FeatureServer): BuildingPermit_gdb, Open_Building_Violations, BuildingViolation_gdb, CodeComplianceViolation (Open/Closed past 5y), EnergovCodeCasePublicView, inspectionsData',
    ],
    dataLimitations: [
      'Records reflect the digital portal only. Paper/microfilm permit archives predating the Miami-Dade digital migration may not appear.',
      'This v1 covers unincorporated Miami-Dade County. Properties inside city portals (Miami Beach, Coral Gables, Hialeah, etc.) are not yet connected.',
      'No site visit, no Street View timeline scrub, no certified records pull is performed automatically. See Next Steps.',
      'Never makes legal or final compliance determinations. Always verify with the AHJ before acting.',
    ],
    ahj: {
      slug: 'fl-miami-dade',
      name: 'Miami-Dade County Building Department',
      note: 'Unincorporated Miami-Dade + RER Open Data. City-level AHJs coming in v2.',
    },
    bottomLine,
  };
}
