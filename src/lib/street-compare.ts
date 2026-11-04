// AI check on dated Street View photos of the front of a property.
//
// The browser finds the older Street View captures (Google only lists them to
// its web map tool), then sends their image addresses here. We look for front
// changes that aerial photos miss (windows, doors, garage enclosure, front
// additions, roof slope, fence) and compare them to the permit record. Like the
// aerial check, it runs three times and keeps only what a majority agrees on.

import type { Permit, VisionObservation } from './types';
import { callVision, fetchImageBase64, mergeVisionRuns, type ParsedVision } from './vision-compare';

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

const AREAS = ['Front windows', 'Front door', 'Garage / carport', 'Front addition', 'Roof (front)', 'Fence / gate', 'Driveway', 'Exterior finish'];

// The model only groups the numbered photos by how each area looks (a letter per look).
// The code below works out whether it changed and between which years, so a
// change can never be dated to photos where the area looks the same.
const PROMPT = `You look at dated Street View photos of ONE house, numbered in date order, all taken from about the same street position.

For each area below, sort the photos by how that area of the subject house (the house centred in the photos) looks. Give each distinct look a capital letter (A, B, C) and describe each letter in a few plain words. Photos where the area looks the same get the SAME letter. Use "?" for a photo where the area is hidden or too unclear. Areas: ${AREAS.map((a) => `"${a}"`).join(', ')}.

How to read the photos:
- Older photos are smaller, hazier and differently lit. Haze, glare, shadow, a different sun angle or a lower-quality image is NOT a change. Colour shifts from lighting are NOT a change.
- Cars, people, bins, plants and trees growing or being trimmed are NOT changes. Look past them.
- An area is "changed" only if a specific physical difference is clearly visible: a different shape, size, material, opening layout, style or a clearly different colour in good light.
- When in doubt whether two photos differ, give them the same letter.

Then say if the area's change (if any) is of a kind that normally needs a permit: windows or doors replaced, garage enclosed, addition, roof replaced, new or replaced fence or wall, driveway rebuilt. Paint and landscaping do not.

Never use em dashes or en dashes.

Return ONLY JSON:
{"areas": [{"area": "...", "perPhoto": ["A", "A", "B", ...one letter or ? per photo, in photo order], "looks": {"A": "short description", "B": "short description"}, "needsPermitIfChanged": true|false}]}`;

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
  const loaded = frames.filter((_, i) => !!imgs[i]);
  const data = imgs.filter((x): x is string => !!x);
  if (loaded.length < 2) return empty('fewer than two photos could be loaded');
  const content: any[] = [];
  loaded.forEach((f, i) => {
    content.push({ type: 'text', text: `Photo ${i + 1} of ${loaded.length}, taken ${f.label}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: data[i] } });
  });
  content.push({ type: 'text', text: `${permitText(opts.permits, opts.yearBuilt)}\n\nReturn the JSON.` });

  const labels = loaded.map((f) => f.label);
  const runOnce = async (): Promise<ParsedVision | null> => {
    const call = await callVision(apiKey, PROMPT, content);
    return call.ok ? toObservations(call.text, labels, opts.permits) : null;
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

const yearOf = (label: string) => Number(label.match(/(19|20)\d{2}/)?.[0] ?? NaN);

// Turn one run's per-photo letters into observations. An area changed where
// two neighbouring clear photos carry different letters; the years
// come from those photos' labels, never from the model's own wording.
export function toObservations(
  text: string,
  labels: string[],
  permits: Array<Pick<Permit, 'issueDate' | 'appType' | 'scope'>>,
): ParsedVision | null {
  let parsed: any;
  try {
    parsed = JSON.parse(text.replace(/^[^{]*/s, '').replace(/[^}]*$/s, ''));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed?.areas)) return null;
  const noDash = (t: string) => t.replace(/\s*[\u2014\u2013]\s*/g, ', ');
  const observations: VisionObservation[] = [];
  for (const a of parsed.areas) {
    const area = AREAS.find((x) => x === a?.area);
    const per: string[] = Array.isArray(a?.perPhoto) ? a.perPhoto.map((x: any) => String(x ?? '').trim().toUpperCase()) : [];
    const look = (k: string) => noDash(String(a?.looks?.[k] ?? '').trim()) || 'a different look';
    if (!area || per.length !== labels.length) continue;
    const clear = per.map((d, i) => ({ d, i })).filter((x) => /^[A-Z]$/.test(x.d));
    if (clear.length < 2) {
      observations.push({ area, whatWeSaw: 'Not clear enough in the photos to compare.', vsPermitRecord: '', severity: 'uncertain' });
      continue;
    }
    let change: { from: number; to: number } | null = null;
    for (let k = 1; k < clear.length; k++) {
      if (clear[k].d !== clear[k - 1].d) {
        change = { from: clear[k - 1].i, to: clear[k].i };
        break;
      }
    }
    if (!change) {
      observations.push({
        area,
        whatWeSaw: `Looks the same from ${labels[clear[0].i]} to ${labels[clear[clear.length - 1].i]}: ${look(clear[0].d)}.`,
        vsPermitRecord: 'No change to explain.',
        severity: 'match',
      });
      continue;
    }
    const y0 = yearOf(labels[change.from]);
    const y1 = yearOf(labels[change.to]);
    const inWindow = permits.filter((p) => {
      const y = Number(String(p.issueDate ?? '').slice(0, 4));
      return Number.isFinite(y) && Number.isFinite(y0) && Number.isFinite(y1) && y >= y0 && y <= y1;
    });
    const needs = a?.needsPermitIfChanged === true;
    observations.push({
      area,
      whatWeSaw: `Changed between ${labels[change.from]} and ${labels[change.to]}: ${look(per[change.from])} in ${labels[change.from]}, ${look(per[change.to])} in ${labels[change.to]}.`,
      vsPermitRecord: inWindow.length
        ? `${inWindow.length} permit(s) issued ${y0} to ${y1}; check whether one covers it.`
        : `No permit issued ${y0} to ${y1}.`,
      severity: needs && inWindow.length === 0 ? 'flag' : 'note',
    });
  }
  const flags = observations.filter((o) => o.severity === 'flag').map((o) => o.area.toLowerCase());
  return {
    summary: flags.length ? `Front changes with no permit in the same years: ${flags.join(', ')}.` : 'No front changes that need a permit were seen.',
    observations,
  };
}
