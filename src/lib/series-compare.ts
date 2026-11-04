// AI check on a dated series of photos of one property (Street View photos of
// the front, or county aerials from above).
//
// The model only groups the numbered photos by how each area looks: a letter
// per distinct look, the same letter when it looks the same. This code then
// finds the first neighbouring pair of clear photos that differ and takes the
// years from those photos' dates, so a change can never be dated to photos in
// which the area looks the same. It runs three times and keeps what a majority
// agrees on.

import type { Permit, VisionObservation } from './types';
import { callVision, fetchImageBase64, imageMediaType, mergeVisionRuns, type ParsedVision } from './vision-compare';

export interface SeriesFrame {
  imageUrl: string;
  label: string; // "Oct 2008" or "2016"
}

export interface SeriesSpec {
  areas: string[];
  // What the photos are and how to find the subject property in them.
  intro: string;
  // Extra reading rules for this kind of photo.
  reading: string[];
  // Changes of this kind normally need a permit.
  permitKinds: string;
  // "Front" or "Yard and roof", used in the one-line summary.
  where: string;
}

export interface SeriesComparison {
  performed: boolean;
  summary: string;
  observations: VisionObservation[];
  runsAgreed: number;
  failureReason: string | null;
}

type PermitLite = Pick<Permit, 'issueDate' | 'appType' | 'scope'>;

// Miami-Dade's public permit data starts on 1 Jan 2020 (the full archive needs a
// records request), so "no permit" is only known for changes after that.
export const PERMITS_ONLINE_FROM = 2020;

// Which permits can explain a change to an area. A pool permit does not explain
// a new roof. Areas not listed accept any permit.
const PERMIT_WORDS: Record<string, RegExp> = {
  Roof: /ROOF/,
  'Roof (front)': /ROOF/,
  Pool: /POOL/,
  Solar: /SOLAR|PHOTOVOLT|\bPV\b/,
  'Shed / detached': /SHED|DETACHED|STORAGE|GAZEBO|ACCESSORY/,
  Fence: /FENCE|WALL|GATE/,
  'Fence / gate': /FENCE|WALL|GATE/,
  Driveway: /DRIVE|PAVER|PAVING|SLAB|CONCRETE|RIGHT OF WAY/,
  'Patio / cover': /PATIO|TERRACE|PERGOLA|GAZEBO|CARPORT|COVER|ADDITION|AWNING|SLAB/,
  'Screen enclosure': /SCREEN|ENCLOS|ALUMINUM/,
  'Rear addition': /ADDITION|ADD |ENCLOS|ROOM|EXTEN/,
  'Front addition': /ADDITION|ADD |ENCLOS|ROOM|EXTEN|PORCH/,
  'Front windows': /WINDOW|SHUTTER|ENT REPLACEMENT|OPENING/,
  'Front door': /DOOR|ENT REPLACEMENT|OPENING|ENTRANCE/,
  'Garage / carport': /GARAGE|CARPORT|DOOR|ENCLOS|CONVER/,
};
const permitFits = (area: string, p: PermitLite) => {
  const re = PERMIT_WORDS[area];
  return !re || re.test(`${p.appType ?? ''} ${p.scope ?? ''}`.toUpperCase());
};


function promptFor(spec: SeriesSpec): string {
  return `${spec.intro}

For each area below, sort the photos by how that area of the subject property looks. Give each distinct look a capital letter (A, B, C) and describe each letter in a few plain words. Photos where the area looks the same get the SAME letter. Use "?" for a photo where the area is hidden, outside the frame or too unclear. Areas: ${spec.areas.map((a) => `"${a}"`).join(', ')}.

How to read the photos:
${spec.reading.map((r) => `- ${r}`).join('\n')}
- An area is "changed" only if a specific physical difference is clearly visible: a different shape, size, material, layout, or a clearly different colour in good light.
- When in doubt whether two photos differ, give them the same letter.

Then say if the area's change (if any) is of a kind that normally needs a permit: ${spec.permitKinds}. Paint and landscaping do not.

Never use em dashes or en dashes.

Return ONLY JSON:
{"areas": [{"area": "...", "perPhoto": ["A", "A", "B", ...one letter or ? per photo, in photo order], "looks": {"A": "short description", "B": "short description"}, "needsPermitIfChanged": true|false}]}`;
}

function permitText(permits: PermitLite[], yearBuilt: number | null): string {
  const lines = [`Year built: ${yearBuilt ?? 'unknown'}`, `Permits on file: ${permits.length}`];
  for (const p of permits.slice(0, 30)) lines.push(`- ${p.issueDate ?? '?'} | ${p.appType ?? '?'} | ${p.scope ?? ''}`);
  if (!permits.length) lines.push('(none)');
  return lines.join('\n');
}

export async function compareSeries(
  spec: SeriesSpec,
  opts: {
    frames: SeriesFrame[];
    permits: PermitLite[];
    yearBuilt: number | null;
    // Optional first image that shows which property is the subject (for
    // aerials: today's satellite photo with the lot outlined in red).
    keyImage?: { imageUrl: string; text: string } | null;
    // The permit lookup failed this run: never call a change unpermitted.
    permitsUnknown?: boolean;
  },
): Promise<SeriesComparison> {
  const empty = (reason: string): SeriesComparison => ({ performed: false, summary: '', observations: [], runsAgreed: 0, failureReason: reason });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return empty('AI key not configured');
  const [keyB64, ...imgs] = await Promise.all([
    opts.keyImage ? fetchImageBase64(opts.keyImage.imageUrl) : Promise.resolve(null),
    ...opts.frames.map((f) => fetchImageBase64(f.imageUrl)),
  ]);
  const loaded = opts.frames.filter((_, i) => !!imgs[i]);
  const data = imgs.filter((x): x is string => !!x);
  if (loaded.length < 2) return empty('fewer than two photos could be loaded');
  const content: any[] = [];
  if (opts.keyImage && keyB64) {
    content.push({ type: 'text', text: opts.keyImage.text });
    content.push({ type: 'image', source: { type: 'base64', media_type: imageMediaType(keyB64), data: keyB64 } });
  }
  loaded.forEach((f, i) => {
    content.push({ type: 'text', text: `Photo ${i + 1} of ${loaded.length}, taken ${f.label}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: imageMediaType(data[i]), data: data[i] } });
  });
  content.push({ type: 'text', text: `${permitText(opts.permits, opts.yearBuilt)}\n\nReturn the JSON.` });

  const system = promptFor(spec);
  const labels = loaded.map((f) => f.label);
  const runOnce = async (): Promise<ParsedVision | null> => {
    const call = await callVision(apiKey, system, content);
    return call.ok ? toObservations(call.text, labels, opts.permits, spec, opts.permitsUnknown) : null;
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
const noDash = (t: string) => t.replace(/\s*[—–]\s*/g, ', ');
// Descriptions sit mid-sentence, so start them lower case (keep acronyms).
const midSentence = (t: string) => (/^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);

// Turn one run's per-photo letters into observations. An area changed where
// two neighbouring clear photos carry different letters; the years come from
// those photos' labels, never from the model's own wording. When an area
// changed more than once, the most recent change is reported (an early one is
// usually the house being built and would hide, say, a pool added later).
export function toObservations(
  text: string,
  labels: string[],
  permits: PermitLite[],
  spec: Pick<SeriesSpec, 'areas' | 'where'>,
  permitsUnknown = false,
): ParsedVision | null {
  let parsed: any;
  try {
    parsed = JSON.parse(text.replace(/^[^{]*/s, '').replace(/[^}]*$/s, ''));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed?.areas)) return null;
  const observations: VisionObservation[] = [];
  for (const a of parsed.areas) {
    const area = spec.areas.find((x) => x === a?.area);
    const per: string[] = Array.isArray(a?.perPhoto) ? a.perPhoto.map((x: any) => String(x ?? '').trim().toUpperCase()) : [];
    const look = (k: string) => midSentence(noDash(String(a?.looks?.[k] ?? '').trim())) || 'a different look';
    if (!area || per.length !== labels.length) continue;
    const clear = per.map((d, i) => ({ d, i })).filter((x) => /^[A-Z]$/.test(x.d));
    if (clear.length < 2) {
      observations.push({ area, whatWeSaw: 'Not clear enough in the photos to compare.', vsPermitRecord: '', severity: 'uncertain' });
      continue;
    }
    let change: { from: number; to: number } | null = null;
    for (let k = clear.length - 1; k >= 1; k--) {
      if (clear[k].d !== clear[k - 1].d) {
        change = { from: clear[k - 1].i, to: clear[k].i };
        break;
      }
    }
    if (!change) {
      const first = look(clear[0].d);
      observations.push({
        area,
        whatWeSaw: `Looks the same from ${labels[clear[0].i]} to ${labels[clear[clear.length - 1].i]}: ${first}.`,
        vsPermitRecord: 'No change to explain.',
        severity: 'match',
      });
      continue;
    }
    const y0 = yearOf(labels[change.from]);
    const y1 = yearOf(labels[change.to]);
    const inWindow = permits.filter((p) => {
      const y = Number(String(p.issueDate ?? '').slice(0, 4));
      return Number.isFinite(y) && Number.isFinite(y0) && Number.isFinite(y1) && y >= y0 && y <= y1 && permitFits(area, p);
    });
    const needs = a?.needsPermitIfChanged === true;
    const beforeOnlineRecords = Number.isFinite(y0) && y0 < PERMITS_ONLINE_FROM && inWindow.length === 0;
    const named = inWindow
      .slice(0, 2)
      .map((p) => `${String(p.issueDate ?? '').slice(0, 4)} ${String(p.scope || p.appType || 'permit').split(' - ')[0].trim().toLowerCase()}`)
      .join(', ');
    observations.push({
      area,
      whatWeSaw: `Changed between ${labels[change.from]} and ${labels[change.to]}: ${look(per[change.from])} in ${labels[change.from]}, ${look(per[change.to])} in ${labels[change.to]}.`,
      vsPermitRecord: inWindow.length
        ? `Permit on file in those years (${named}); check that it covers this work.`
        : permitsUnknown
        ? 'The county permit lookup did not answer this time, so permits could not be checked. Re-run the report.'
        : beforeOnlineRecords
        ? `County online permit records start in ${PERMITS_ONLINE_FROM}, so an older permit may exist. Order the permit history to confirm.`
        : `No permit issued ${y0} to ${y1}.`,
      severity: needs && inWindow.length === 0 && !beforeOnlineRecords && !permitsUnknown ? 'flag' : 'note',
    });
  }
  const flags = observations.filter((o) => o.severity === 'flag').map((o) => o.area.toLowerCase());
  return {
    summary: flags.length ? `${spec.where} changes with no permit in the same years: ${flags.join(', ')}.` : `No ${spec.where.toLowerCase()} changes that need a permit were seen.`,
    observations,
  };
}
