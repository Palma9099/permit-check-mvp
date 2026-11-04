// "What we found": the visible changes with no permit to explain them, pulled
// from the aerial and Street View AI checks (each already majority-agreed) and
// stated plainly at the very top of the report. Wording stays factual: a
// visible change, and no permit found in county records. Never "illegal".

import type { DiagnosticReport, VisionObservation } from './types';
import type { Persona } from './persona';

export interface Finding {
  source: 'aerial' | 'street';
  area: string;
  text: string;
}

export function collectFindings(r: DiagnosticReport, streetObs: VisionObservation[] | null | undefined): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  const add = (source: Finding['source'], o: VisionObservation) => {
    const k = `${source}:${o.area.toLowerCase()}`;
    if (seen.has(k) || o.severity !== 'flag') return;
    seen.add(k);
    // House style: no long dashes in reader-facing text, even from older AI output.
    out.push({ source, area: o.area, text: o.whatWeSaw.replace(/\s*[\u2014\u2013]\s*/g, ', ') });
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
  'Each change was found consistently across three independent checks of the photos, and no permit for it appears in county records. Paper permits or permits filed under another address may not show up, so confirm with the county.';
