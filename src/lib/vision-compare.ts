// AI-powered visual comparison.
//
// Inputs: satellite imagery with the subject parcel outlined in red, Street
// View imagery facing the property, and the permit / extra-features digest
// for the parcel. Output: a structured list of observations with severity
// flags — "flag" is only emitted when the model sees clear post-construction
// work inside the red polygon that isn't matched by a permit on file.
//
// The red polygon is the critical primitive. Before this change the model
// would flag neighbor features (e.g. a neighbor's pool) as the subject's
// unpermitted work. The polygon tells it exactly where to look.
//
// If ANTHROPIC_API_KEY is not set, returns performed=false so the UI falls
// back to the static checklist gracefully.

import type {
  ExtraFeature,
  Permit,
  StreetViewImage,
  VisualComparison,
  VisionObservation,
  VisionSeverity,
} from './types';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-5-20250929';

async function fetchImageBase64(url: string, timeoutMs = 8000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab).toString('base64');
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function buildPermitDigest(permits: Permit[], features: ExtraFeature[], yearBuilt: number | null): string {
  const lines: string[] = [];
  lines.push(`Year built: ${yearBuilt ?? 'unknown'}`);
  lines.push(`Total permits on file: ${permits.length}`);
  if (permits.length > 0) {
    const permitLines = permits
      .slice(0, 25)
      .map((p) => `  - ${p.issueDate ?? '?'} | ${p.appType ?? '?'} | ${p.scope ?? ''}`.trim());
    lines.push('Permit list:');
    lines.push(...permitLines);
  } else {
    lines.push('Permit list: (none)');
  }
  if (features.length > 0) {
    lines.push('Property Appraiser extra features (county-dated):');
    for (const f of features.slice(0, 20)) {
      lines.push(`  - ${f.description}${f.units ? ` (${f.units} units)` : ''}${f.actualYearBuilt ? ` dated ${f.actualYearBuilt}` : ''}`);
    }
  }
  return lines.join('\n');
}

const SYSTEM_PROMPT = `You are a Florida-licensed-realtor-grade visual property analyst.

You will be given multiple images of the same property:
  1. A tight satellite frame centered on the subject parcel, with the parcel
     boundary DRAWN AS A BRIGHT RED POLYGON OUTLINE.
  2. A wider block-context satellite frame showing neighboring parcels, with
     the subject parcel again drawn as a bright red polygon outline.
  3. One or more Street View images looking at the property from the street.

You will also be given the permit history and Property Appraiser extra-features
record for the subject parcel.

CRITICAL — PARCEL BOUNDARY RULE:
  The BRIGHT RED POLYGON on the satellite images marks the subject property
  boundary. EVERYTHING YOU FLAG MUST BE INSIDE THAT POLYGON. If a feature
  (pool, shed, patio, addition, driveway, fence segment) falls OUTSIDE the
  red outline, it belongs to a neighbor and is NOT a finding for this
  property — do not mention it as if it were the subject's. You may still
  use the neighbors as a control group for roof tone, vintage, and
  footprint — but never cite a neighbor's feature as the subject's.

  If the red polygon is obviously synthetic (a perfect rectangle smaller
  than the visible house footprint), treat it as a "subject area hint" and
  still avoid flagging anything that is clearly on an adjacent parcel.

Your job: look at the imagery and report what you actually see INSIDE the
red polygon, then cross-check it against the permit record. You are looking
for signs of work done AFTER the home was originally built but never
permitted:
  - a newer roof than the house's age or the neighbors (color uniformity,
    lack of algae streaks, sharp edges) with no re-roof permit
  - visible additions or enclosures tacked onto the original footprint
  - rear yard patios / covered patios / screen enclosures added later
    with no permit
  - fences that exceed 6ft with no fence permit
  - solar, antennas, AC condensers that suggest work not on file
  - Street-View-visible window/door changes vs the original vintage
    (new impact-window frames on an old house is a common unpermitted item)

CRITICAL — original-construction rule (HIGHLY-VISIBLE MAJOR STRUCTURES ONLY):
  If a major structure (pool, spa, cabana, detached garage, tiki, integral
  patio cover, original perimeter fence) is visible INSIDE THE RED POLYGON
  and appears to be of the SAME vintage as the house — consistent
  weathering, aligned with the original footprint, and would have been
  visible from the first day the house existed — then it was almost
  certainly bundled into the master construction permit. DO NOT flag it.
  A pool in particular requires electrical, structural, and barrier
  inspections; if it were unpermitted the AHJ would have written a
  violation within 1–2 years of construction. Its presence for the life
  of the home without a violation is strong evidence it WAS permitted,
  even if a standalone "POOL" permit doesn't appear in the digital archive.
  Florida county permit archives have poor digital coverage for master
  construction permits issued before roughly 2010; absence of a standalone
  permit does not equal absence of authorization.

  Flag a pool / major structure ONLY if it visibly appears to have been
  added AFTER original construction. When uncertain, classify as "match"
  or "uncertain", not "flag".

SCOPE LIMIT — "AHJ would have caught it" reasoning is visibility-bound:
  That inference applies ONLY to highly-visible major structures: pools,
  cabanas, detached garages, rear additions visible from overhead, tall
  perimeter walls. Code enforcement in Florida counties is largely
  complaint-driven; the categories below routinely sit unpermitted for
  decades, and absence-of-permit IS a legitimate flag for them even on
  old homes:
    - Interior remodels (kitchens, baths)
    - Mechanical / electrical / plumbing swaps (A/C condensers, water
      heaters, panel upgrades)
    - Window and door replacements — check Street View for frame-style
      changes that don't match the vintage
    - Re-roofs (a re-roof done 15 years ago that matches neighbor color
      can look like the original roof — if the permit log shows no
      re-roof and the tile/shingle style doesn't match the era, flag it)
    - Hidden rear additions (behind privacy fences or behind the
      original footprint, not visible from street)
    - Enclosed garages / carports — look in Street View for infill where
      an overhead door used to be, mismatched wall plane, added window
      in what was the garage opening
    - Interior conversions (bedroom → rental unit, garage → mother-in-law
      suite without exterior change)
  For these categories, do NOT rely on "it's been like that since the
  house was built" to conclude it was permitted. If the permit record is
  silent on work visibly present, flag it or classify as "uncertain".

Rules:
  - Only describe what is genuinely visible. If the image quality doesn't
    let you tell, say "uncertain from imagery."
  - Never invent a finding.
  - Compare the subject roof tone, age, and footprint specifically to the
    visible neighbor roofs in the wider frame. Neighbors are your control
    group, never a finding.
  - Keep each observation's text to 1-2 short sentences. Plain English.
    No jargon.
  - If everything looks consistent with the permit record, say so clearly
    with severity "match".
  - Severity "flag" is reserved for clear post-construction work INSIDE
    the red polygon with no matching permit. "No standalone permit on
    file" alone is never enough.

Return ONLY valid JSON matching this schema — no preamble, no code fences:
{
  "summary": "one-sentence plain-English takeaway (max 25 words)",
  "observations": [
    {
      "area": "Roof" | "Rear footprint" | "Fence" | "Pool" | "Shed / detached" | "Patio / cover" | "Driveway" | "Windows / doors" | "Other",
      "whatWeSaw": "short plain-English description of what you see in the image",
      "vsPermitRecord": "how that aligns or conflicts with the permits on file",
      "severity": "flag" | "note" | "match" | "uncertain"
    }
  ]
}

Keep the observation count between 3 and 6. Skip areas where there is nothing
notable to say.`;

function parseResult(text: string): { summary: string; observations: VisionObservation[] } | null {
  const cleaned = text
    .replace(/^[^{]*/s, '')
    .replace(/[^}]*$/s, '');
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
    const observations: VisionObservation[] = Array.isArray(parsed.observations)
      ? parsed.observations.slice(0, 8).map((o: any) => ({
          area: String(o?.area ?? 'Other'),
          whatWeSaw: String(o?.whatWeSaw ?? ''),
          vsPermitRecord: String(o?.vsPermitRecord ?? ''),
          severity: (['flag', 'note', 'match', 'uncertain'] as VisionSeverity[]).includes(o?.severity)
            ? (o.severity as VisionSeverity)
            : 'uncertain',
        })).filter((o: VisionObservation) => o.whatWeSaw.length > 0)
      : [];
    if (!summary && observations.length === 0) return null;
    return { summary, observations };
  } catch {
    return null;
  }
}

export async function compareImagery(opts: {
  closeSatelliteUrl: string | null;
  contextSatelliteUrl: string | null;
  streetViewImages?: StreetViewImage[];
  permits: Permit[];
  features: ExtraFeature[];
  yearBuilt: number | null;
  polygonIsFallback?: boolean;       // tell the model when the polygon is a synthesized box
}): Promise<VisualComparison> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      performed: false,
      modelUsed: null,
      summary:
        'Automated visual comparison did not run — no ANTHROPIC_API_KEY configured on the server. The static checklist below covers the areas a realtor should eyeball.',
      observations: [],
      failureReason: 'ANTHROPIC_API_KEY not set',
    };
  }

  if (!opts.closeSatelliteUrl) {
    return {
      performed: false,
      modelUsed: null,
      summary: 'No satellite imagery available — address may not have geocoded.',
      observations: [],
      failureReason: 'no imagery url',
    };
  }

  // Fetch all images in parallel.
  const streetViewList = (opts.streetViewImages ?? []).filter((s) => s.imageUrl);
  const [closeB64, contextB64, ...streetViewB64] = await Promise.all([
    fetchImageBase64(opts.closeSatelliteUrl),
    opts.contextSatelliteUrl ? fetchImageBase64(opts.contextSatelliteUrl) : Promise.resolve(null),
    ...streetViewList.map((s) => fetchImageBase64(s.imageUrl as string)),
  ]);

  if (!closeB64) {
    return {
      performed: false,
      modelUsed: null,
      summary: 'Satellite image fetch failed — skipped visual comparison.',
      observations: [],
      failureReason: 'satellite fetch failed',
    };
  }

  const digest = buildPermitDigest(opts.permits, opts.features, opts.yearBuilt);

  const userContent: any[] = [
    {
      type: 'text',
      text:
        (opts.polygonIsFallback
          ? 'IMAGE 1 — TIGHT satellite frame. NOTE: the parcel layer was unavailable, so the red outline is a ~120ft synthetic box centered on the geocoded address. Treat it as a "subject area hint" and avoid flagging things clearly on neighboring parcels.\n'
          : 'IMAGE 1 — TIGHT satellite frame centered on the subject parcel. The BRIGHT RED polygon outlines the subject property boundary. Everything INSIDE the red polygon is the subject; everything OUTSIDE belongs to neighbors and is never a finding for this property.\n'),
    },
    {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: closeB64 },
    },
  ];
  if (contextB64) {
    userContent.push({
      type: 'text',
      text: 'IMAGE 2 — WIDER block-context satellite frame. Same red polygon marks the subject parcel. Use neighbors as a visual control group for roof vintage, footprint scale, and lot size — but never cite a neighbor feature as the subject\'s.',
    });
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: contextB64 },
    });
  }

  // Street View images — ground-level. No polygon overlay possible, but the
  // model can still compare window frames, garage doors, roof edges, paint,
  // door color, fence material etc. against the permit log.
  streetViewB64.forEach((b64, i) => {
    if (!b64) return;
    const sv = streetViewList[i];
    userContent.push({
      type: 'text',
      text: `IMAGE ${3 + i} — Street View, ${sv.label} (heading ${sv.heading}°). Ground-level look at the property. Compare windows, doors, roof edge, fence, and any visible condenser/water-heater/electrical against the permit log.`,
    });
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
    });
  });

  userContent.push({
    type: 'text',
    text: `Permit record for the subject parcel:\n${digest}\n\nAnalyze the imagery and return the JSON object per the schema in the system prompt. Remember: red polygon = subject; outside red polygon = neighbors = never a finding.`,
  });

  try {
    const res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        performed: false,
        modelUsed: MODEL,
        summary: 'Vision comparison API call failed.',
        observations: [],
        failureReason: `HTTP ${res.status}${errText ? `: ${errText.slice(0, 300)}` : ''}`,
      };
    }

    const data: any = await res.json();
    const textBlock = Array.isArray(data?.content)
      ? data.content.find((b: any) => b?.type === 'text')
      : null;
    const text = typeof textBlock?.text === 'string' ? textBlock.text : '';
    const parsed = parseResult(text);
    if (!parsed) {
      return {
        performed: false,
        modelUsed: MODEL,
        summary: 'Vision model returned an unparseable response.',
        observations: [],
        failureReason: 'json parse failed',
      };
    }
    return {
      performed: true,
      modelUsed: MODEL,
      summary:
        parsed.summary ||
        (parsed.observations.length > 0
          ? 'See observations below.'
          : 'No notable discrepancies observed.'),
      observations: parsed.observations,
      failureReason: null,
    };
  } catch (err: any) {
    return {
      performed: false,
      modelUsed: MODEL,
      summary: 'Vision comparison errored out.',
      observations: [],
      failureReason: String(err?.message ?? err).slice(0, 300),
    };
  }
}
