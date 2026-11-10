// Which cities this product can actually read, asked of the registry that decides.
//
// This module exists because of a stale copy. `code-authority.ts` carried a
// hand-written list of city code portals - ONE entry, Hialeah - and used it to
// decide whether an unsearched city was a dead end for the reader. By
// 2026-11-10 the worker's registry held 36 city adapters, Tampa among them, so
// the report was telling readers to "ask the city directly" about cities this
// product reads on request.
//
// The fix is not a longer hand-written list. The one thing that decides which
// cities the deep scan can read is `CITY_JURISDICTIONS` in
// worker/src/scrapers/jurisdictions.ts, so that is what gets asked.
//
// It is asked through `city-code-coverage.generated.ts` rather than imported,
// because the Next.js build cannot resolve the worker's ".js"-suffixed imports
// of ".ts" files - confirmed, it fails the build outright with "Can't resolve
// './citizenserve-parse.js'". So `npm run gen:coverage` flattens the registry
// into a committed data file.
//
// That is a second copy, which is the very thing that caused this bug, so what
// makes it safe is not the generator: it is that
// tests/city-adapters-reachable.test.ts rebuilds the data from the registry and
// fails when the two disagree. The old hand-written list went stale because
// nothing ever compared it to anything. This one cannot.

import { CITY_CODE_COVERAGE } from './city-code-coverage.generated';

/** What the product can do about one city's code records. */
export interface CityCodeCoverage {
  /** The city as the registry names it, e.g. "City of Tampa". */
  name: string;
  /** The platform behind it, e.g. "accela". For whoever debugs this next. */
  platform: string;
  /**
   * The city's own public code search, when the registry carries one.
   *
   * This is the link a reader can open right now without waiting for us.
   */
  portalUrl: string | null;
  /**
   * True when a deep scan of this address would search THIS CITY's code
   * records rather than falling back to its county.
   *
   * It says the request reaches the city's adapter, not that the adapter
   * found nothing. A reader who has not ordered the scan has had nothing
   * searched, and the verdict must still say so.
   */
  deepScanReads: boolean;
}

/** The registry key: county slug plus the appraiser's spelling of the city. */
const keyFor = (countyKey: string, municipality: string) =>
  `${countyKey.trim().toLowerCase()}:${municipality.trim().toUpperCase()}`;

const BY_KEY = new Map(CITY_CODE_COVERAGE.map((r) => [r.key, r]));

/**
 * What we can do about code records in this municipality.
 *
 * `countyKey` is the normalized county key ("hillsborough", "miami-dade").
 * It is REQUIRED, and a missing one returns null rather than guessing: two
 * Florida counties can hold places of the same name, and Longboat Key is in
 * the registry twice, once under Manatee and once under Sarasota, because the
 * town straddles the county line. Matching on the city name alone would let
 * one county's answer stand in for another's, which is the mistake this whole
 * area of the code exists to prevent.
 */
export function cityCodeCoverage(
  municipality: string | null | undefined,
  countyKey: string | null | undefined,
): CityCodeCoverage | null {
  const m = (municipality ?? '').trim();
  const c = (countyKey ?? '').trim();
  if (!m || !c) return null;

  // The generator leaves out 'generic' registry entries: those drive guessed,
  // uncalibrated selectors and degrade to "here is the link" rather than
  // returning wrong data. That is the right behaviour, but it is NOT a city we
  // can promise to read, so an uncalibrated city reports as no coverage - the
  // same answer as a city with no entry at all.
  const row = BY_KEY.get(keyFor(c, m));
  if (!row) return null;

  return {
    name: row.name,
    platform: row.platform,
    portalUrl: row.portalUrl,
    deepScanReads: true,
  };
}

/** Every city the deep scan can read, for the coverage page and for tests. */
export function citiesWithCodeCoverage(): string[] {
  return CITY_CODE_COVERAGE.map((r) => r.key).sort();
}
