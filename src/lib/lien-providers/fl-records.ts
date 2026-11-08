// Records-level lien provider: every Florida county that publishes no
// parcel-keyed code-case or lien data.
//
// What it pulls live: the parcel itself, from the Florida Department of
// Revenue certified tax roll (the statewide cadastral layer already used by
// the county adapters) and the municipality containing the parcel point.
// That fixes the three things a lien search has to get right before any
// records are pulled: which parcel, whose name is on it, and which city is
// the code authority.
//
// What it does NOT pull, and says so: code liens, code cases, permits, taxes,
// Official Records and utilities. Those are staff steps naming the office that
// holds them. A county with no public case data is reported that way, never as
// clear. That is the whole difference between this and Miami-Dade, and the
// coverage block on every search prints it.

import { getCountyDirectoryEntry } from '../counties/portals';
import { parcelByFolio, parcelByPoint } from '../counties/statewide-cadastral';
import { cap, countTotals, type LienCoverage, type LienSearch, type StaffStep } from '../lien-types';
import { municipalityAt } from './municipality';

export interface FlRecordsOptions {
  /** County-specific wording for the county code / permit staff step. */
  countyCodeNote?: string;
  /** Anything else a person must pull for this county, appended to byHand. */
  extraByHand?: string[];
  /** What this county calls its parcel number. */
  parcelLabel?: string;
  /** Pretty-print the parcel id; defaults to the id as the roll stores it. */
  pretty?: (id: string) => string;
}

const coverage = (opts: FlRecordsOptions): LienCoverage => ({
  level: 'records',
  automated: [
    'Parcel, owner and legal description, from the Florida Department of Revenue certified tax roll',
    'Which municipality the parcel sits in, from the parcel point',
  ],
  byHand: [
    'Recorded code liens and releases, from the Clerk of Court Official Records',
    'Open code cases and code board fines',
    'Open and expired building permits',
    'Property taxes, delinquent years and tax certificates',
    'Water and sewer balance',
    ...(opts.extraByHand ?? []),
  ],
});

/**
 * The parcel id of the lot under a map point, when it is in this county.
 * Returns null for a point in another county, so a near-boundary geocode can
 * never be searched against the wrong county's records.
 */
export async function flRecordsParcelAtPoint(countyKey: string, lat: number, lng: number): Promise<string | null> {
  const p = await parcelByPoint(lat, lng);
  if (!p || p.countyKey !== countyKey) return null;
  return p.parcelId ?? null;
}

export async function runFlRecordsLienSearch(
  countyKey: string,
  parcelIdIn: string,
  opts: FlRecordsOptions = {},
): Promise<LienSearch> {
  const dir = getCountyDirectoryEntry(countyKey);
  const countyName = dir?.name ?? cap(countyKey.replace(/-/g, ' ')) + ' County';
  const parcelId = parcelIdIn.trim();

  const resolved = await parcelByFolio(parcelId).catch(() => null);
  // The statewide roll holds every county's parcel ids, so a match in the
  // wrong county is a real risk: reject it rather than search the wrong lot.
  const parcel = resolved && resolved.parcel.countyKey === countyKey ? resolved : null;

  // A failed boundary lookup is NOT "unincorporated": that would drop the city
  // lien letter, which is the step most likely to hold up a closing.
  const cityLookup = parcel
    ? await municipalityAt(parcel.lat, parcel.lng).then(
        (name) => ({ ok: true as const, name }),
        () => ({ ok: false as const, name: null }),
      )
    : { ok: false as const, name: null };
  const cityName = cityLookup.name;
  const unincorporated = cityLookup.ok && !cityName;
  const city = cityName ? cap(cityName) : 'the city';

  const staffSteps: StaffStep[] = [
    {
      key: 'records',
      title: 'Official Records',
      how: `Recorded liens and releases against the owner and parcel, from the ${countyName} Clerk of the Circuit Court. Behind a search form, so it is pulled by hand.`,
    },
    {
      key: 'taxes',
      title: 'Property taxes',
      how: `Current-year bill, any delinquent years and tax certificates, from the ${countyName} Tax Collector.`,
    },
    {
      key: 'countyCode',
      title: `${countyName} code cases`,
      how:
        opts.countyCodeNote ??
        `Open code cases, code board fines and recorded code liens from ${countyName} Code Enforcement. The county publishes no parcel-keyed case data, so this is read by hand.`,
      url: dir?.codeEnforcement ?? dir?.buildingDept ?? undefined,
    },
    {
      key: 'countyPermits',
      title: `${countyName} permits`,
      how: `Open and expired permits from ${countyName} Building. ${
        unincorporated ? 'County permits cover this unincorporated parcel.' : `County permits cover unincorporated work; ${city} permits its own.`
      }`,
      url: dir?.buildingDept ?? undefined,
    },
    {
      key: 'utilities',
      title: 'Water and sewer',
      how: unincorporated
        ? `Open balance or lien from the ${countyName} utility serving this parcel.`
        : `Open balance or lien from ${city}'s utility or the ${countyName} utility.`,
    },
  ];
  if (!cityLookup.ok) {
    staffSteps.push({
      key: 'city',
      title: 'City lien letter',
      how: 'Which city this parcel sits in could not be determined just now, so the city is confirmed from the parcel record and the letter is requested from it. County records do not cover city cases.',
    });
  } else if (!unincorporated) {
    staffSteps.push({
      key: 'city',
      title: `${city} lien letter`,
      how: `${city} code liens, code fines, city permits and city fees. County records do not cover city cases, so this is requested from the city. Confirm the city with the parcel's own records if the address is near a boundary.`,
    });
  }

  const sections: LienSearch['sections'] = [];
  return {
    county: countyKey,
    countyName,
    parcelLabel: opts.parcelLabel ?? 'Parcel ID',
    coverage: coverage(opts),
    folio: parcelId,
    prettyFolio: opts.pretty ? opts.pretty(parcelId) : parcelId,
    address: parcel?.parcel.siteAddress ?? null,
    owner: parcel?.parcel.owner ?? null,
    legal: parcel?.parcel.legal ?? null,
    municipality: cityName ? cap(cityName) : null,
    unincorporated,
    searchedAt: new Date().toISOString(),
    sections,
    staffSteps,
    ...countTotals(sections),
  };
}
