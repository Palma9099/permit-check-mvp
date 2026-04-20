// AI-powered visual comparison.
//
// Fetches two Esri World Imagery tiles — a property-tight view and a wider
// block-context view — then asks Claude (via the Anthropic Messages API with
// vision) to compare the subject to its neighbors and cross-check what it
// sees against the permit record.
//
// If ANTHROPIC_API_KEY is not set, we return a VisualComparison with
// performed=false and a failureReason so the UI falls back to the static
// checklist gracefully.
//
// This module is deliberately self-contained — no Anthropic SDK dependency —
// so the serverless bundle stays small and deployments don't break on a
// missing peer dep.

import type {
  ExtraFeature,
  Permit,
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

You will be given two aerial images of the same property:
  1. A tight satellite frame centered on the subject parcel.
  2. A wider block-context frame showing neighboring parcels.

You will also be given the permit history and Property Appraiser extra-features
record for the subject parcel.

Your job is to look at the imagery and report what you actually see, then
cross-check it against the permit record. You are looking for signs of:
  - a newer roof than the house's age or the neighbors (color uniformity,
    lack of algae streaks, sharp edges) with no re-roof permit
  - visible additions or enclosures: rear bump-outs, enclosed garages,
    enclosed carports, bonus rooms tacked onto the footprint
  - pool or spa not matching a pool permit
  - detached structures (sheds, cabanas, gazebos) with no matching permit
  - rear yard patios / covered patios / screen enclosures with no permit
  - fences that exceed 6ft with no fence permit
  - solar, antennas, AC condensers that suggest work not on file

Rules:
  - Only describe what is genuinely visible. If the image quality doesn't
    let you tell, say "uncertain from imagery."
  - Never invent a finding.
  - Compare the subject roof tone, age, and footprint specifically to the
    visible neighbor roofs in the wider frame. Neighbors are your control
    group.
  - Keep each observation's text to 1-2 short sentences. Plain English.
    No jargon.
  - If everything looks consistent with the permit record, say so clearly
    with severity "match".

Return ONLY valid JSON matching this schema — no preamble, no code fences:
{
  "summary": "one-sentence plain-English takeaway (max 25 words)",
  "observations": [
    {
      "area": "Roof" | "Rear footprint" | "Fence" | "Pool" | "Shed / detached" | "Patio / cover" | "Driveway" | "Other",
      "whatWeSaw": "short plain-English description of what you see in the image",
      "vsPermitRecord": "how that aligns or conflicts with the permits on file",
      "severity": "flag" | "note" | "match" | "uncertain"
    }
  ]
}

Keep the observation count between 3 and 6. Skip areas where there is nothing
notable to say.`;

function parseResult(text: string): { summary: string; observations: VisionObservation[] } | null {
  // Strip common fencing patterns in case the model wraps output anyway.
  const cleaned = text
    .replace(/^[^{]*/s, '')       // anything before the first {
    .replace(/[^}]*$/s, '');      // anything after the last }
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
  permits: Permit[];
  features: ExtraFeature[];
  yearBuilt: number | null;
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

  const [closeB64, contextB64] = await Promise.all([
    fetchImageBase64(opts.closeSatelliteUrl),
    opts.contextSatelliteUrl ? fetchImageBase64(opts.contextSatelliteUrl) : Promise.resolve(null),
  ]);

  if (!closeB64) {
    return {
      performed: false,
      modelUsed: null,
      summary: 'Esri satellite fetch failed — skipped visual comparison.',
      observations: [],
      failureReason: 'Esri fetch failed',
    };
  }

  const digest = buildPermitDigest(opts.permits, opts.features, opts.yearBuilt);

  const userContent: any[] = [
    {
      type: 'text',
      text:
        'IMAGE 1 of 2 — TIGHT satellite frame centered on the subject parcel:',
    },
    {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: closeB64 },
    },
  ];
  if (contextB64) {
    userContent.push({
      type: 'text',
      text: 'IMAGE 2 of 2 — WIDER block context (subject is near the center; use neighbors as your control):',
    });
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: contextB64 },
    });
  }
  userContent.push({
    type: 'text',
    text: `Permit record for the subject parcel:\n${digest}\n\nAnalyze the imagery and return the JSON object per the schema in the system prompt.`,
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
        max_tokens: 1024,
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
