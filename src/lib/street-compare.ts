// AI check on dated Street View photos of the front of a property.
//
// The browser finds the older Street View captures (Google only lists them to
// its web map tool), then sends their image addresses here. We look for front
// changes that aerial photos miss (windows, doors, garage enclosure, front
// additions, roof slope, fence) and compare them to the permit record. Like the
// aerial check, it runs three times and keeps only what a majority agrees on.

import type { Permit, VisionObservation } from './types';
import { MODEL, fetchImageBase64, mergeVisionRuns, parseResult, type ParsedVision } from './vision-compare';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

export interface StreetFrameIn {
  imageUrl: string;
  label: string; // "Oct 2008"
}

export interface StreetComparison {
  performed: boolean;
  summary: string;
  observations: VisionObservation[];
  runsAgreed: number;
  failureReason: string | null;
}

const PROMPT = `You compare dated Street View photos of ONE house, all taken from about the same street position, looking at it. Your job: list visible changes to the subject house over time, and say whether the permit record explains each one.

The subject house is the one centred in the photos. Ignore neighbours, cars, people, plants that only grew, light and weather.

Check these areas: "Front windows", "Front door", "Garage / carport", "Front addition", "Roof (front)", "Fence / gate", "Driveway", "Exterior finish".

Severity:
- "flag": a visible change of a kind that normally needs a permit (windows or doors replaced, garage enclosed, addition, roof replaced, new fence or wall, driveway rebuilt) with NO matching permit in the record for the years between the photos.
- "note": a visible change that usually needs no permit (paint colour, landscaping), or a change a permit does explain.
- "match": no visible change.
- "uncertain": the photos do not show the area clearly enough to say.

Rules: describe only what you can see. Name the years between which a change appears. Never invent a change. Never use em dashes or en dashes; use commas or periods.

Return ONLY JSON: {"summary": "one sentence", "observations": [{"area": "...", "whatWeSaw": "...", "vsPermitRecord": "...", "severity": "flag|note|match|uncertain"}]}`;

function permitText(permits: Array<Pick<Permit, 'issueDate' | 'appType' | 'scope'>>, yearBuilt: number | null): string {
  const lines = [`Year built: ${yearBuilt ?? 'unknown'}`, `Permits on file: ${permits.length}`];
  for (const p of permits.slice(0, 30)) lines.push(`- ${p.issueDate ?? '?'} | ${p.appType ?? '?'} | ${p.scope ?? ''}`);
  if (!permits.length) lines.push('(none)');
  return lines.join('\n');
}

export async function compareStreetHistory(opts: {
  frames: StreetFrameIn[];
  permits: Array<Pick<Permit, 'issueDate' | 'appType' | 'scope'>>;
  yearBuilt: number | null;
}): Promise<StreetComparison> {
  const empty = (reason: string): StreetComparison => ({ performed: false, summary: '', observations: [], runsAgreed: 0, failureReason: reason });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return empty('AI key not configured');
  const frames = opts.frames.slice(0, 4);
  const imgs = await Promise.all(frames.map((f) => fetchImageBase64(f.imageUrl)));
  const content: any[] = [];
  frames.forEach((f, i) => {
    if (!imgs[i]) return;
    content.push({ type: 'text', text: `Street View photo, ${f.label}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imgs[i] } });
  });
  if (content.length < 4) return empty('fewer than two photos could be loaded');
  content.push({ type: 'text', text: `Permit record:\n${permitText(opts.permits, opts.yearBuilt)}\n\nReturn the JSON.` });

  const body = JSON.stringify({ model: MODEL, max_tokens: 1400, temperature: 0, system: PROMPT, messages: [{ role: 'user', content }] });
  const runOnce = async (): Promise<ParsedVision | null> => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body,
      });
      if (res.ok) {
        const data: any = await res.json();
        const t = Array.isArray(data?.content) ? data.content.find((b: any) => b?.type === 'text')?.text : '';
        return parseResult(typeof t === 'string' ? t : '');
      }
      if (![429, 500, 502, 503, 504, 529].includes(res.status)) return null;
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }
    return null;
  };
  try {
    const runs = (await Promise.all([runOnce(), runOnce(), runOnce()])).filter((x): x is ParsedVision => !!x);
    if (!runs.length) return empty('AI comparison failed');
    const merged = mergeVisionRuns(runs);
    return { performed: true, summary: merged.summary, observations: merged.observations, runsAgreed: merged.runs, failureReason: null };
  } catch (err: any) {
    return empty(String(err?.message ?? err).slice(0, 200));
  }
}
