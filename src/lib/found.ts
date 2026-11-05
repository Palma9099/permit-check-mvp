// "What we found": the visible changes with no permit to explain them, pulled
// from the aerial and Street View AI checks (each already majority-agreed) and
// stated plainly at the very top of the report. Wording stays factual: a
// visible change, and no permit found in county records. Never "illegal".

import type { DiagnosticReport, VisionObservation } from './types';
import type { Persona } from './persona';

export type FindingSource = 'aerial' | 'street';

export interface Finding {
  source: FindingSource; // where it was first seen
  sources: FindingSource[]; // every check that saw it
  area: string;
  text: string;
}

// The aerial and Street View checks name areas differently ("Roof" and
// "Roof (front)"), so one real change could be listed twice. Map both to a
// topic and list each change once, naming every source that saw it.
const TOPICS: Array<[string, RegExp]> = [
  ['garage', /garage|carport/i],
  ['roof', /roof/i],
  ['driveway', /driveway/i],
  ['fence', /fence|gate/i],
  ['windows', /window/i],
  ['door', /door/i],
  ['patio', /patio|cover/i],
  ['pool', /pool/i],
  ['shed', /shed|detached/i],
  ['addition', /addition|footprint/i],
  ['solar', /solar/i],
  ['finish', /facade|finish|paint/i],
];
const topicOf = (area: string) => TOPICS.find(([, re]) => re.test(area))?.[0] ?? area.toLowerCase();

export function sourceLabel(f: Finding): string {
  return f.sources.length > 1 ? 'Aerial and Street View' : f.source === 'street' ? 'Street View' : 'Aerial photos';
}

// Areas the street photos see whole. When dated Street View shows one of these
// unchanged across the years, a "changed" call from the softer 2 to 3 ft aerials
// is dropped: on a test house the aerials read old pavers as "plain concrete in
// 2010", while a 2008 Street View photo already showed the same pavers.
// Fences and roofs are not overruled, since the street sees only the front.
const STREET_SEES_WHOLE = new Set(['driveway', 'garage']);

export function collectFindings(r: DiagnosticReport, streetObs: VisionObservation[] | null | undefined): Finding[] {
  const out: Finding[] = [];
  const byTopic = new Map<string, Finding>();
  const streetSame = new Set((streetObs ?? []).filter((o) => o.severity === 'match').map((o) => topicOf(o.area)));
  const add = (source: FindingSource, o: VisionObservation) => {
    if (o.severity !== 'flag') return;
    const t = topicOf(o.area);
    if (source === 'aerial' && STREET_SEES_WHOLE.has(t) && streetSame.has(t)) return;
    const prev = byTopic.get(t);
    if (prev) {
      if (!prev.sources.includes(source)) prev.sources.push(source);
      return;
    }
    // House style: no long dashes in reader-facing text, even from older AI output.
    const f: Finding = { source, sources: [source], area: o.area, text: o.whatWeSaw.replace(/\s*[\u2014\u2013]\s*/g, ', ') };
    byTopic.set(t, f);
    out.push(f);
  };
  for (const o of r.thenVsNow?.visualComparison?.observations ?? []) add('aerial', o);
  for (const o of streetObs ?? []) add('street', o);
  return out;
}

export function foundHeadline(role: Persona | null | undefined, n: number): string {
  if (n === 0) return 'No visible changes without a permit found';
  const c = `${n} change${n > 1 ? 's' : ''}`;
  switch (role) {
    case 'seller':
      return `A buyer will see ${c} with no permit on file`;
    case 'owner':
      return `${n} visible change${n > 1 ? 's' : ''} on your property with no permit on file`;
    case 'pro':
      return `${n} visible change${n > 1 ? 's' : ''} with no permit on file for your client`;
    default:
      return `${c} we can see, with no permit on file`;
  }
}

export function foundCta(role: Persona | null | undefined): string {
  switch (role) {
    case 'owner':
    case 'seller':
      return 'Get it legalized';
    case 'buyer':
      return 'Price the fix';
    case 'pro':
      return 'Quote for my client';
    default:
      return 'Get a quote';
  }
}

export const FOUND_NOTE =
  'Each change was seen in separate checks of the photos, and no permit for it is in county records. Older paper permits may not show, so confirm with the county.';
