// Which county does a lien search, and how.
//
// Every Florida county has a provider. Two of them pull cases live; the rest
// pull the parcel live and name the office that holds each record a person has
// to read. Whether a county is one or the other is not a judgement call: it is
// whether that county publishes parcel-keyed case data, checked against its
// own GIS. A county moves up by adding a provider here, not by changing the
// wording of this file.
//
// Adding a county: write src/lib/lien-providers/<county>.ts with a run() and
// (when it can answer "are there liens standing") an openLiens(), then add one
// row to CASE_LEVEL below.

import { FL_COUNTY_DIRECTORY } from '../counties/portals';
import type { LienLine, LienSearch } from '../lien-types';

/**
 * Liens and fines standing against a parcel, plus a plain-language note of
 * what was actually looked at. The note matters: Broward's live source is two
 * cities' code cases, not the whole county, and a report must not round that
 * up to "no liens anywhere".
 */
export interface OpenLiens {
  lines: LienLine[];
  scope: string;
}
import { folioAtPoint as miamiDadeFolioAtPoint } from '../miami-dade-raw';
import { browardFolioAtPoint, browardOpenLiens, compactBrowardFolio, runBrowardLienSearch } from './broward';
import { flRecordsParcelAtPoint, runFlRecordsLienSearch, type FlRecordsOptions } from './fl-records';
import { miamiDadeOpenLiens, runMiamiDadeLienSearch } from './miami-dade';

export interface LienProvider {
  county: string;
  countyName: string;
  parcelLabel: string;
  /** 'cases' pulls code/lien/permit cases live. 'records' pulls the parcel. */
  level: 'cases' | 'records';
  /** The full search, automated part plus the staff steps. */
  run(parcelId: string): Promise<LienSearch>;
  /**
   * Just the liens and fines still standing, for the free property check.
   * Present only where a live source can answer it. MUST throw when a source
   * does not answer, so the caller never prints "no liens" for a failed pull.
   */
  openLiens?(parcelId: string): Promise<OpenLiens>;
  /**
   * The parcel number of the lot under a map point, for an address search.
   * Returns null when the point is not on a parcel in this county, so a
   * near-boundary geocode can never be searched against the wrong records.
   */
  parcelAtPoint(lat: number, lng: number): Promise<string | null>;
  /** Normalize a typed parcel number to the form the county's layers use. */
  normalize?(parcelId: string): string;
}

// Counties whose own GIS publishes parcel-keyed cases.
const CASE_LEVEL: Record<string, LienProvider> = {
  'miami-dade': {
    county: 'miami-dade',
    countyName: 'Miami-Dade County',
    parcelLabel: 'Folio',
    level: 'cases',
    run: runMiamiDadeLienSearch,
    openLiens: miamiDadeOpenLiens,
    parcelAtPoint: miamiDadeFolioAtPoint,
  },
  broward: {
    county: 'broward',
    countyName: 'Broward County',
    parcelLabel: 'Folio',
    level: 'cases',
    run: runBrowardLienSearch,
    openLiens: browardOpenLiens,
    parcelAtPoint: browardFolioAtPoint,
    normalize: compactBrowardFolio,
  },
};

// Per-county wording for the records-level provider, where the county's own
// arrangement is worth stating. A county with nothing here still gets a
// search; it just gets the generic sentence.
const RECORDS_OPTIONS: Record<string, FlRecordsOptions> = {
  duval: {
    countyCodeNote:
      'Open code cases and recorded code liens from the City of Jacksonville Municipal Code Compliance. Duval is consolidated, so the city is the code authority for nearly the whole county.',
  },
  monroe: {
    countyCodeNote:
      'Open code cases and recorded code liens from Monroe County Code Compliance for the unincorporated Keys; Key West, Marathon, Islamorada, Layton and Key Colony Beach each run their own code office.',
    extraByHand: ['Flood elevation and the cumulative 50% substantial-improvement history, which drives most Keys permit holds'],
  },
  hillsborough: {
    countyCodeNote:
      'Open code cases and recorded code liens from Hillsborough County Code Enforcement for unincorporated work; Tampa, Temple Terrace and Plant City each run their own code office.',
  },
  'palm-beach': {
    countyCodeNote:
      'Open code cases and recorded code liens from Palm Beach County Code Enforcement (PZB) for unincorporated work; each of the 39 municipalities runs its own code office.',
  },
  orange: {
    countyCodeNote:
      'Open code cases and recorded code liens from Orange County Code Enforcement for unincorporated work; the City of Orlando runs its own code office.',
  },
  pinellas: {
    countyCodeNote:
      'Open code cases and recorded code liens from Pinellas County Code Enforcement for unincorporated work; St. Petersburg, Clearwater and Largo each run their own.',
  },
};

export function getLienProvider(countyKey: string | null): LienProvider | null {
  if (!countyKey) return null;
  const cased = CASE_LEVEL[countyKey];
  if (cased) return cased;
  const dir = FL_COUNTY_DIRECTORY[countyKey];
  if (!dir) return null;
  const opts = RECORDS_OPTIONS[countyKey] ?? {};
  return {
    county: countyKey,
    countyName: dir.name,
    parcelLabel: opts.parcelLabel ?? 'Parcel ID',
    level: 'records',
    run: (parcelId: string) => runFlRecordsLienSearch(countyKey, parcelId, opts),
    parcelAtPoint: (lat: number, lng: number) => flRecordsParcelAtPoint(countyKey, lat, lng),
  };
}

/** Every county a lien search can be run for, in name order. */
export function lienCounties(): Array<{ key: string; name: string; level: 'cases' | 'records' }> {
  return Object.keys(FL_COUNTY_DIRECTORY)
    .map((key) => {
      const p = getLienProvider(key)!;
      return { key, name: p.countyName, level: p.level };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
