// AI-powered visual comparison — Then vs Now edition.
//
// Inputs: a historical NAIP aerial ("THEN") + current satellite/NAIP/Street
// View imagery ("NOW") + the permit / extra-features digest for the parcel.
// Output: a structured list of observations calling out what changed between
// the two dates, cross-referenced against permits issued in that window.
//
// The model's job is specifically before/after: did a pool appear that wasn't
// there in 2010? Did the roof pattern change? Did a rear addition appear?
// Then: does the permit log between the two dates explain what changed?
//
// Spatial anchoring:
//   - The Google Static Maps "NOW" frame has the parcel drawn as a bright
//     red polygon. That image is the authoritative "this is the subject"
//     cue for the model.
//   - The NAIP THEN / NOW frames are unannotated PNGs clipped tight to the
//     parcel bbox (~40ft buffer). The model cross-references building
//     footprints against the polygon frame to identify the subject.
//
// Fails closed (performed: false) if ANTHROPIC_API_KEY is missing or the
// primary current satellite URL is missing. Historical aerial is optional —
// if absent, we still run a current-only analysis and say so in the output.

import type {
  ExtraFeature,
  HistoricalAerialFrame,
  HistoricalStreetViewFrameType,
  Permit,
  StreetViewImage,
  VisualComparison,
  VisionObservation,
  VisionSeverity,
} from './types';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-5-20250929';

async function fetchImageBase64(url: string, timeoutMs = 10000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const urlForLog = url.length > 120 ? url.slice(0, 120) + '...' : url;
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      const bodyPreview = await res.text().catch(() => '').then((b) => b.slice(0, 200));
      console.error(`[vision-compare] fetchImageBase64 non-OK: status=${res.status} url=${urlForLog} body=${bodyPreview}`);
      return null;
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab).toString('base64');
  } catch (err: any) {
    console.error(`[vision-compare] fetchImageBase64 threw: url=${urlForLog} err=${String(err?.message ?? err).slice(0, 200)}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

function buildPermitDigest(
  permits: Permit[],
  features: ExtraFeature[],
  yearBuilt: number | null,
  thenYear: number | null,
  nowYear: number | null,
): string {
  const lines: string[] = [];
  lines.push(`Year built: ${yearBuilt ?? 'unknown'}`);
  if (thenYear && nowYear) {
    lines.push(`Comparison window: ${thenYear} → ${nowYear}`);
  }
  lines.push(`Total permits on file: ${permits.length}`);
  if (permits.length > 0) {
    // Sort permits by date; prioritize those in the Then→Now window for the
    // model's attention, but include all so the model can see the full
    // history context.
    const dated = permits
      .slice()
      .sort((a, b) => (a.issueDate ?? '').localeCompare(b.issueDate ?? ''));
    const inWindow = thenYear && nowYear
      ? dated.filter((p) => {
          if (!p.issueDate) return false;
          const y = Number(p.issueDate.slice(0, 4));
          return y >= thenYear && y <= nowYear;
        })
      : [];
    if (inWindow.length > 0) {
      lines.push(`Permits issued IN the ${thenYear}→${nowYear} window (${inWindow.length}):`);
      inWindow.slice(0, 20).forEach((p) => {
        lines.push(`  - ${p.issueDate ?? '?'} | ${p.appType ?? '?'} | ${p.scope ?? ''}`.trim());
      });
    }
    const outOfWindow = thenYear && nowYear
      ? dated.filter((p) => !inWindow.includes(p)).slice(0, 15)
      : dated.slice(0, 25);
    if (outOfWindow.length > 0) {
      lines.push(`Other permits on file${thenYear ? ' (outside window)' : ''}:`);
      outOfWindow.forEach((p) => {
        lines.push(`  - ${p.issueDate ?? '?'} | ${p.appType ?? '?'} | ${p.scope ?? ''}`.trim());
      });
    }
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

const SYSTEM_PROMPT = `You are a Florida-realtor-grade visual property analyst doing a Then-vs-Now diff.

You will be given multiple images of the same property. Some are labeled THEN
(historical aerial, with a capture date) and some are labeled NOW (current
aerial + Street View):

  THEN — one or more historical NAIP aerials (USDA National Agriculture
         Imagery Program, 1m resolution), captured in a specific year.
         These frames are clipped tight to the subject parcel bbox. No
         polygon is drawn on them.

  NOW  — a tight Google Static Maps satellite frame with the parcel
         boundary drawn as a BRIGHT RED POLYGON. Use this frame as your
         spatial anchor: it tells you exactly which building, pool, and
         yard belong to the subject vs the neighbors. The NAIP NOW frame
         (if present) gives you a same-provider comparison to the THEN
         frame, at 1m native resolution. Street View (if present) is
         ground-level.

Your job: compare THEN to NOW and describe what changed on the subject
property, then cross-check those changes against the permit log.

CRITICAL — PARCEL BOUNDARY RULE:
  The BRIGHT RED POLYGON on the NOW Google satellite frame marks the subject
  property boundary. EVERYTHING YOU FLAG MUST BE INSIDE THAT POLYGON. If a
  feature sits outside the outline it belongs to a neighbor and is never a
  finding for the subject. Neighbors are a visual control group only.

  If the red polygon is obviously synthetic (a perfect rectangle smaller
  than the visible house footprint), treat it as a "subject area hint" and
  still avoid flagging things clearly on adjacent parcels.

CRITICAL — THEN vs NOW REASONING:
  The goal is to identify features that appeared, disappeared, or changed
  between the THEN date and the NOW date, INSIDE the red polygon, and then
  check whether the permit log shows a matching permit in that window.

  Features to look for changing between THEN and NOW (aerial frames):
    - Pool that wasn't there before (or vice versa — rare)
    - New addition / new wing tacked onto the original footprint
    - New detached structure (shed, cabana, tiki, mother-in-law)
    - New or resurfaced driveway
    - New patio / covered patio / screen enclosure
    - Roof color or pattern change (indicates re-roof)
    - New perimeter wall or fence
    - Solar panels appearing
    - Carport enclosed into living space (infill where overhead door was)

  Features to look for changing between THEN and NOW (Street View frames,
  if a Mapillary historical pano is provided alongside the current pano):
    - Exterior paint color change on the main facade (e.g. tan → white)
    - Front door swap (panel/style/color obviously different)
    - Garage door swap (overhead → modern panel; or single → double opening)
    - Front-yard perimeter gate / fence appearing, disappearing, or
      changing material (chain-link → wrought iron, wood → CBS wall, etc.)
    - Window frame style change (single-hung wood → modern impact frames)
    - Exterior cladding change (stucco refinish, new wainscoting, stone
      veneer added)
    - Driveway material change (asphalt → pavers, plain concrete → stamped)
    - Visible roofing material change at the eave/edge (tile → shingle etc.)
  These facade-level changes typically require a permit (paint usually does
  not in unincorporated Miami-Dade, but new gates, doors, windows, and
  cladding generally do). When you flag a Street View change, name the
  specific feature ("dark wood front door in THEN replaced with modern
  glass-panel door in NOW") rather than "front looks different".

  For each change you see, check the "Permits issued IN the [then]→[now]
  window" section of the permit digest. If a matching permit exists
  (right type, right approximate date), classify severity as "match". If
  no matching permit exists, classify as "flag". If you can't tell
  whether something changed, classify as "uncertain".

CRITICAL — ORIGINAL-CONSTRUCTION RULE (features present in THEN):
  If a pool, cabana, detached garage, integral patio cover, or perimeter
  fence was ALREADY VISIBLE in the THEN frame — i.e. it has been there
  for the entire comparison window — do NOT flag its absence of a
  standalone permit. It almost certainly was bundled into the master
  construction permit (which predates most digital county archives) and
  would have generated a violation long ago if it were unpermitted.
  Classify as "match" or skip it entirely.

SCOPE LIMIT — inference bound:
  "It's been like that since THEN" only protects highly-visible major
  structures (pools, cabanas, rear additions, tall walls). It does NOT
  excuse:
    - Interior work implied by visible changes (new bath, new kitchen)
    - Mechanical/electrical/plumbing swaps (A/C pad position change,
      water heater visible in Street View)
    - Re-roofs (roof color/pattern change between THEN and NOW)
    - Window and door replacements (Street View frame-style changes)
    - Enclosed garages (overhead door removed between THEN and NOW)

  For these categories, absence of a matching permit IS a legitimate
  flag.

NOW-ONLY DEGRADED MODE:
  If no THEN frame is provided (historical aerial unavailable for this
  parcel), you still analyze the NOW imagery against the permit log as
  you would for a single-frame review. Say "no historical frame
  available" in your summary and focus on features that look post-
  construction versus the original vintage.

Rules:
  - Only describe what is genuinely visible. If the image quality doesn't
    let you tell, say "uncertain from imagery."
  - Never invent a finding. Never describe THEN by assumption — only by
    what you actually see in the THEN frame.
  - Be concrete about what changed: "roof appears uniformly dark tile
    in NOW vs streaky lighter tile in THEN" not "roof looks different".
  - Keep each observation's text to 1-2 short sentences. Plain English.
  - Severity "flag" is reserved for clear changes INSIDE the red polygon
    with no matching permit in the window. "No standalone permit on
    file" alone is never enough.
  - Include at least one "match" or skip-worthy item when relevant, so
    the realtor knows what DID line up with the permit log.

Return ONLY valid JSON matching this schema — no preamble, no code fences:
{
  "summary": "one-sentence plain-English takeaway about what changed THEN→NOW and whether permits explain it (max 30 words)",
  "observations": [
    {
      "area": "Roof" | "Rear footprint" | "Fence" | "Pool" | "Shed / detached" | "Patio / cover" | "Driveway" | "Windows / doors" | "Solar" | "Facade — paint" | "Front door" | "Garage door" | "Perimeter gate" | "Other",
      "whatWeSaw": "short plain-English description of THEN→NOW change (or current-only finding if no THEN)",
      "vsPermitRecord": "how that aligns or conflicts with permits issued in the window",
      "severity": "flag" | "note" | "match" | "uncertain"
    }
  ]
}

Keep observations between 3 and 6. Skip areas with nothing notable to say.`;

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
  closeSatelliteUrl: string | null;            // NOW — Google Static Maps, parcel polygon in red
  contextSatelliteUrl: string | null;          // NOW — wider block-context Google satellite
  streetViewImages?: StreetViewImage[];        // NOW — current Google Street View (multi-side aware)
  thenAerial?: HistoricalAerialFrame | null;   // THEN — historical NAIP, no overlay
  nowAerial?: HistoricalAerialFrame | null;    // NOW — latest NAIP, no overlay
  // Per-side Mapillary historical pairs. For typical lots there's 1 side;
  // for corner lots there are 2+. Each side is the same physical street
  // captured at different dates. The AI gets to see all pairs and call out
  // facade changes per side.
  streetViewSides?: Array<{
    sideLabel: string;
    then: HistoricalStreetViewFrameType | null;
    now: HistoricalStreetViewFrameType | null;
  }>;
  permits: Permit[];
  features: ExtraFeature[];
  yearBuilt: number | null;
  polygonIsFallback?: boolean;
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
      thenCaptureDate: null,
      nowCaptureDate: null,
    };
  }

  if (!opts.closeSatelliteUrl) {
    return {
      performed: false,
      modelUsed: null,
      summary: 'No satellite imagery available — address may not have geocoded.',
      observations: [],
      failureReason: 'no imagery url',
      thenCaptureDate: null,
      nowCaptureDate: null,
    };
  }

  const streetViewList = (opts.streetViewImages ?? []).filter((s) => s.imageUrl);

  // Flatten the multi-side Mapillary historical pairs into a parallel list of
  // {label, then, now} so we can fetch and reference them by index.
  const sides = (opts.streetViewSides ?? []).filter(
    (s) => s.then?.imageUrl || s.now?.imageUrl,
  );

  // Fetch all images in parallel. Some may fail (historical NAIP can 404 for
  // out-of-coverage parcels, Mapillary may have no historical pano for the
  // street) — that's fine, we degrade gracefully.
  const sideThenPromises = sides.map((s) =>
    s.then?.imageUrl ? fetchImageBase64(s.then.imageUrl) : Promise.resolve(null),
  );
  const sideNowPromises = sides.map((s) =>
    s.now?.imageUrl ? fetchImageBase64(s.now.imageUrl) : Promise.resolve(null),
  );

  const fixed = await Promise.all([
    opts.thenAerial?.imageUrl ? fetchImageBase64(opts.thenAerial.imageUrl) : Promise.resolve(null),
    opts.nowAerial?.imageUrl ? fetchImageBase64(opts.nowAerial.imageUrl) : Promise.resolve(null),
    fetchImageBase64(opts.closeSatelliteUrl),
    opts.contextSatelliteUrl ? fetchImageBase64(opts.contextSatelliteUrl) : Promise.resolve(null),
  ]);
  const [thenAerialB64, nowAerialB64, closeB64, contextB64] = fixed;
  const sideThenB64 = await Promise.all(sideThenPromises);
  const sideNowB64 = await Promise.all(sideNowPromises);
  const streetViewB64 = await Promise.all(
    streetViewList.map((s) => fetchImageBase64(s.imageUrl as string)),
  );

  if (!closeB64) {
    console.error(
      `[vision-compare] bailing — closeB64 is null. closeSatelliteUrl=${(opts.closeSatelliteUrl ?? '').slice(0, 200)}`,
    );
    return {
      performed: false,
      modelUsed: MODEL,
      summary: 'Current satellite image fetch failed — skipped visual comparison.',
      observations: [],
      failureReason: 'satellite fetch failed',
      thenCaptureDate: null,
      nowCaptureDate: null,
    };
  }
  console.log(
    `[vision-compare] fetched all imagery, calling Anthropic. aerial then=${opts.thenAerial?.captureYear ?? 'none'} now=${opts.nowAerial?.captureYear ?? 'current'} | sv-current=${streetViewB64.filter(Boolean).length} sv-historical-sides=${sides.length}`,
  );

  const thenYear = opts.thenAerial?.captureYear ?? null;
  const nowYear = opts.nowAerial?.captureYear ?? new Date().getUTCFullYear();
  const digest = buildPermitDigest(opts.permits, opts.features, opts.yearBuilt, thenYear, nowYear);

  const userContent: any[] = [];
  let imageCounter = 0;

  // ---- THEN ----
  if (thenAerialB64 && opts.thenAerial) {
    imageCounter++;
    userContent.push({
      type: 'text',
      text: `IMAGE ${imageCounter} — THEN (historical aerial). NAIP capture dated ${opts.thenAerial.captureDate.slice(0, 10)}. Clipped tight to the subject parcel bbox. No polygon overlay — identify the subject by cross-referencing the building footprint against the NOW Google-satellite-with-red-polygon frame coming later.`,
    });
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: thenAerialB64 },
    });
  }

  // ---- NOW (NAIP, same provider, for like-for-like comparison) ----
  if (nowAerialB64 && opts.nowAerial) {
    imageCounter++;
    userContent.push({
      type: 'text',
      text: `IMAGE ${imageCounter} — NOW (historical aerial source, latest capture). NAIP capture dated ${opts.nowAerial.captureDate.slice(0, 10)}. Same clipping and projection as THEN — use this as the like-for-like comparison.`,
    });
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: nowAerialB64 },
    });
  }

  // ---- NOW (Google Static Maps tight frame WITH red polygon) ----
  imageCounter++;
  userContent.push({
    type: 'text',
    text:
      (opts.polygonIsFallback
        ? `IMAGE ${imageCounter} — NOW (Google satellite, tight). NOTE: parcel layer unavailable; red outline is a ~120ft synthetic box centered on the geocoded address. Treat as a subject-area hint.`
        : `IMAGE ${imageCounter} — NOW (Google satellite, tight). BRIGHT RED polygon = subject parcel boundary. This is your spatial anchor — any feature inside the red outline is the subject's; anything outside belongs to neighbors.`),
  });
  userContent.push({
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: closeB64 },
  });

  // ---- NOW (Google context / block-wide) ----
  if (contextB64) {
    imageCounter++;
    userContent.push({
      type: 'text',
      text: `IMAGE ${imageCounter} — NOW (Google satellite, wider block context). Same red polygon marks the subject. Use neighbors as a visual control for roof vintage, footprint scale, lot size — never cite a neighbor feature as the subject's.`,
    });
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: contextB64 },
    });
  }

  // ---- THEN/NOW Street View (Mapillary historical), one pair per side ----
  // For corner lots we get multiple sides — emit a labeled THEN/NOW pair
  // for each so the AI can flag facade changes per street independently.
  sides.forEach((side, idx) => {
    const tB64 = sideThenB64[idx];
    const nB64 = sideNowB64[idx];
    const tFrame = side.then;
    const nFrame = side.now;
    if (tB64 && tFrame) {
      imageCounter++;
      userContent.push({
        type: 'text',
        text: `IMAGE ${imageCounter} — THEN STREET VIEW (Mapillary, ${side.sideLabel}), captured ${tFrame.captureDate.slice(0, 10)} (${tFrame.captureYear}). Historical ground-level view of the ${side.sideLabel.toLowerCase()} of the subject. Use this as the THEN reference for facade-level comparison on this side: paint color, front door, perimeter gate, garage door, windows, fence material. Compare against the matching NOW frame.`,
      });
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: tB64 },
      });
    }
    if (nB64 && nFrame) {
      imageCounter++;
      userContent.push({
        type: 'text',
        text: `IMAGE ${imageCounter} — NOW STREET VIEW (Mapillary, ${side.sideLabel}), captured ${nFrame.captureDate.slice(0, 10)} (${nFrame.captureYear}). Latest ground-level view of the same side. Compare paint, doors, gates, garage, windows, fence vs the THEN frame for this side. Source-matched with THEN so any change you call out should be real, not a provider artifact.`,
      });
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: nB64 },
      });
    }
  });

  // ---- NOW Street View (current Google, heading-aware) ----
  streetViewB64.forEach((b64, i) => {
    if (!b64) return;
    imageCounter++;
    const sv = streetViewList[i];
    userContent.push({
      type: 'text',
      text: `IMAGE ${imageCounter} — NOW (Google Street View, ${sv.label}, heading ${sv.heading}°). Highest-resolution current ground-level look at the property. Use this for fine details (window frame style, condenser unit position, water-heater placement) that the Mapillary frame may be too low-res to show.`,
    });
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
    });
  });

  const windowText = thenYear
    ? `Specifically focus on what changed between ${thenYear} and ${nowYear}, and whether permits issued in that window explain the changes.`
    : `No historical aerial was available for this parcel (Planetary Computer NAIP returned no coverage). Run a current-only analysis and note the missing historical frame in your summary.`;

  userContent.push({
    type: 'text',
    text: `Permit record for the subject parcel:\n${digest}\n\n${windowText}\n\nReturn the JSON object per the schema in the system prompt. Red polygon on the Google NOW frame = subject boundary — never flag anything outside it.`,
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
        max_tokens: 1800,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[vision-compare] Anthropic non-OK: status=${res.status} body=${errText.slice(0, 400)}`);
      return {
        performed: false,
        modelUsed: MODEL,
        summary: 'Vision comparison API call failed.',
        observations: [],
        failureReason: `HTTP ${res.status}${errText ? `: ${errText.slice(0, 300)}` : ''}`,
        thenCaptureDate: opts.thenAerial?.captureDate ?? null,
        nowCaptureDate: opts.nowAerial?.captureDate ?? null,
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
        thenCaptureDate: opts.thenAerial?.captureDate ?? null,
        nowCaptureDate: opts.nowAerial?.captureDate ?? null,
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
      thenCaptureDate: opts.thenAerial?.captureDate ?? null,
      nowCaptureDate: opts.nowAerial?.captureDate ?? null,
    };
  } catch (err: any) {
    console.error(`[vision-compare] threw: ${String(err?.message ?? err).slice(0, 300)}`);
    return {
      performed: false,
      modelUsed: MODEL,
      summary: 'Vision comparison errored out.',
      observations: [],
      failureReason: String(err?.message ?? err).slice(0, 300),
      thenCaptureDate: opts.thenAerial?.captureDate ?? null,
      nowCaptureDate: opts.nowAerial?.captureDate ?? null,
    };
  }
}
