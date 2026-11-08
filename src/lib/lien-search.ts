// Palma Lien Search: the municipal lien search a title company orders before a
// Florida closing.
//
// This file is the entry point and the county dispatcher. The work itself
// lives in src/lib/lien-providers/: one file per county that pulls cases live,
// plus fl-records.ts for every county that publishes none. See
// lien-providers/index.ts for which is which and how a county moves up.
//
// Two rules hold in every county:
//   - A source that did not answer is reported as "could not be checked",
//     never as clear.
//   - A record no public source publishes is a named staff step, not a gap and
//     not an implied "nothing found".

import { getLienProvider, type OpenLiens } from './lien-providers';
import type { LienSearch } from './lien-types';

// Re-exported so the pages, the PDF and the stored record keep one import.
export type {
  LienCoverage,
  LienLine,
  LienSearch,
  LienSection,
  LienSectionKey,
  LienTone,
  StaffStep,
  StaffStepKey,
} from './lien-types';
export { getLienProvider, lienCounties, type LienProvider, type OpenLiens } from './lien-providers';

export const DEFAULT_LIEN_COUNTY = 'miami-dade';

export class UnsupportedCountyError extends Error {
  constructor(public countyKey: string) {
    super(`No lien search is wired up for county "${countyKey}".`);
    this.name = 'UnsupportedCountyError';
  }
}

/**
 * Run the automated part of a lien search. `countyKey` defaults to Miami-Dade,
 * which is where the product started and what a bare folio still means.
 */
export async function runLienSearch(parcelId: string, countyKey: string = DEFAULT_LIEN_COUNTY): Promise<LienSearch> {
  const provider = getLienProvider(countyKey);
  if (!provider) throw new UnsupportedCountyError(countyKey);
  return provider.run(provider.normalize ? provider.normalize(parcelId) : parcelId);
}

/**
 * Just the liens and unpaid fines still standing, for the free property check.
 * Returns null when the county has no live source that can answer it, which is
 * NOT the same as "no liens" and the caller must not print it as such.
 * Throws when a live source exists but did not answer.
 */
export async function openLiens(parcelId: string, countyKey: string = DEFAULT_LIEN_COUNTY): Promise<OpenLiens | null> {
  const provider = getLienProvider(countyKey);
  if (!provider?.openLiens) return null;
  const got = await provider.openLiens(provider.normalize ? provider.normalize(parcelId) : parcelId);
  // An empty scope means nothing was actually checked: same as having no
  // source at all, and never printed as "no liens".
  return got.scope ? got : null;
}
