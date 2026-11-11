// Who enforces code at this parcel, and did we actually ask them?
//
// This module exists because of a real wrong answer. A report for
// 135 W 60 ST, Hialeah printed "Code and liens: None open - No open cases or
// recorded liens", in green, for a property that had an active violation.
// Nothing in the pipeline was broken: Miami-Dade County's code data was
// searched and genuinely held nothing. The problem is that Miami-Dade County
// is not the code authority for an address inside the City of Hialeah, and the
// report had no way to know the difference between "the authority says no" and
// "we never asked the authority".
//
// Florida makes that distinction constantly. A county's code enforcement
// usually reaches its unincorporated area only; inside a municipality the city
// enforces its own code. Of Florida's largest counties, Miami-Dade, Broward,
// Palm Beach and Collier all work this way. So a county search returning zero
// is the NORMAL result for most addresses in those counties and says nothing
// about the property.
//
// The rule this module encodes: a source nobody checked is never reported as
// clear. Green is reserved for "we asked the government that decides, and it
// said no".

/** What we know about who governs code at a parcel and what we searched. */
export interface CodeAuthority {
  /** Municipality from the property appraiser, e.g. "HIALEAH". Null when unknown. */
  municipality: string | null;
  /** True when a municipality, not the county, enforces code here. */
  cityGoverns: boolean;
  /** True when we searched that city's own code records. */
  cityChecked: boolean;
  /** True when we searched the county's code records. */
  countyChecked: boolean;
  /**
   * True when the property appraiser actually told us which jurisdiction this
   * parcel sits in, including when the answer was "unincorporated".
   *
   * A null municipality is NOT evidence of unincorporated land. It is the
   * absence of an answer, and the two have to be separable: an unincorporated
   * parcel the county searched is genuinely clear, while a parcel whose
   * jurisdiction we never established cannot be, because the authority we
   * failed to identify may be a city holding an open case.
   */
  municipalityKnown: boolean;
  /**
   * What this product can do about this city's code records, looked up from
   * the adapter registry by the caller.
   *
   * Passed IN rather than imported, so this module stays a pure function of
   * its arguments and its tests stay hermetic. `lib/city-code-portals.ts` is
   * what reads the registry.
   *
   * Absent or null means we know of no way to reach this city. It does NOT
   * soften the verdict either way: a city the deep scan can read has still
   * not been read until someone runs it.
   */
  cityCoverage?: CityCodeReach | null;
  /**
   * The county's display name, e.g. "Hillsborough County".
   *
   * Only used when the COUNTY is the authority - an explicitly unincorporated
   * parcel. Optional because an authority object built without it still has to
   * produce a true sentence, just a less specific one.
   */
  countyName?: string | null;
}

/** The part of a city's coverage that changes what the report may say. */
export interface CityCodeReach {
  /** The city's own public code search, when one is known. */
  portalUrl: string | null;
  /** True when a deep scan of this address searches THIS city, not its county. */
  deepScanReads: boolean;
}

export type CodeVerdict =
  /** The authority that decides was searched and held nothing. */
  | { kind: 'clear' }
  /** Something was found. */
  | { kind: 'hits'; open: number; liens: number }
  /**
   * The authority that decides was NOT searched. Never render this green.
   *
   * `deepScanReads` says this product can reach that authority on request. It
   * changes the advice from "go ask them yourself" to "order the scan" - it
   * never changes the verdict, because nothing has been searched either way.
   */
  | {
      kind: 'unchecked';
      authority: string;
      searched: string | null;
      portalUrl: string | null;
      deepScanReads: boolean;
      /**
       * Do we know WHO governs this parcel, or is `authority` a stand-in for a
       * jurisdiction never established?
       *
       * This is jurisdiction-known, NOT has-a-city-name. Codex R1 P2-2: an
       * explicitly unincorporated parcel has a known authority - its county -
       * and calling that "we could not establish which authority" is false,
       * not merely vague. A city name and a county both count as named.
       * Decided from the authority inputs, never by matching a display string.
       */
      authorityNamed: boolean;
    };

const UNINCORPORATED = /unincorp|^none$|^n\/?a$/i;

/** Tidy a property-appraiser municipality for display: "HIALEAH" -> "Hialeah". */
export function cityLabel(municipality: string | null): string | null {
  const m = (municipality ?? '').trim();
  if (!m || UNINCORPORATED.test(m)) return null;
  if (/^miami$/i.test(m)) return 'City of Miami';
  return m
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bOf\b/g, 'of');
}

/**
 * The county as a code authority, for an explicitly unincorporated parcel.
 *
 * Falls back to "the county", which is still true and still not a tautology,
 * when the caller had no county name to hand.
 */
export function countyLabel(countyName: string | null | undefined): string {
  const c = (countyName ?? '').trim();
  if (!c) return 'the county';
  return /county\s*$/i.test(c) ? c : `${c} County`;
}

/**
 * Is a municipality the code authority at this parcel?
 *
 * Only a NAMED city governs. A blank is not a vote for the county: see
 * `municipalityKnown`, which is what separates "the appraiser said
 * unincorporated" from "the appraiser told us nothing".
 */
export function cityGoverns(municipality: string | null): boolean {
  return cityLabel(municipality) !== null;
}

/**
 * Did the source actually name a jurisdiction for this parcel?
 *
 * "UNINCORPORATED" (and the other spellings of it the appraisers use) is an
 * answer. An empty string or a missing field is not.
 */
export function municipalityKnown(municipality: string | null | undefined): boolean {
  return (municipality ?? '').trim().length > 0;
}

/**
 * What the report is allowed to say about code enforcement.
 *
 * `open` and `liens` are whatever the searches returned. The point of this
 * function is that those counts alone can never produce a clean verdict - the
 * authority has to have been asked first.
 */
export function codeVerdict(
  authority: CodeAuthority,
  open: number,
  liens: number,
): CodeVerdict {
  if (open > 0 || liens > 0) return { kind: 'hits', open, liens };

  if (authority.cityGoverns && !authority.cityChecked) {
    const named = cityLabel(authority.municipality);
    return {
      kind: 'unchecked',
      authority: named ?? 'the city',
      searched: authority.countyChecked ? 'the county' : null,
      portalUrl: authority.cityCoverage?.portalUrl ?? null,
      deepScanReads: authority.cityCoverage?.deepScanReads === true,
      authorityNamed: named !== null,
    };
  }

  // Nobody searched anything at all: also not clear.
  if (!authority.cityChecked && !authority.countyChecked) {
    // But "nobody searched" does not mean "nobody is known". An explicit
    // UNINCORPORATED from the appraiser is positive evidence that the COUNTY
    // governs. Saying we could not establish the authority there is false.
    if (authority.municipalityKnown && !authority.cityGoverns) {
      return {
        kind: 'unchecked',
        authority: countyLabel(authority.countyName),
        searched: null,
        portalUrl: null,
        // The deep scan reads CITY code records. An unincorporated parcel has
        // no city to read, so there is nothing extra to offer here.
        deepScanReads: false,
        authorityNamed: true,
      };
    }
    return {
      kind: 'unchecked',
      authority: 'the code authority',
      searched: null,
      portalUrl: null,
      deepScanReads: false,
      authorityNamed: false,
    };
  }

  // We never established which jurisdiction this parcel is in, so a county
  // search cannot stand in for the authority. A blank municipality is the
  // absence of an answer, not a finding of unincorporated land, and inside a
  // city the county holds nothing even when the city holds a lien.
  if (!authority.municipalityKnown && !authority.cityChecked) {
    return {
      kind: 'unchecked',
      authority: 'the city or county that governs this address',
      searched: authority.countyChecked ? 'the county' : null,
      portalUrl: null,
      // We do not know which jurisdiction this is, so we cannot claim a scan
      // would reach the right one. An unidentified authority is not a covered
      // authority, however many cities the registry holds.
      deepScanReads: false,
      authorityNamed: false,
    };
  }

  return { kind: 'clear' };
}

/**
 * Capitalise a sentence that may start with a generic authority stand-in.
 *
 * "the county enforces code here" is true but reads like a fragment. Named
 * authorities ("Tampa", "Hillsborough County") are already capitalised, so
 * this is a no-op for them.
 */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Short tile value, e.g. "None open" or "Not checked". */
export function verdictValue(v: CodeVerdict): string {
  switch (v.kind) {
    case 'hits':
      return v.liens > 0
        ? `${v.liens} lien${v.liens > 1 ? 's' : ''} or fine${v.liens > 1 ? 's' : ''}`
        : `${v.open} open`;
    case 'unchecked':
      return 'Not checked';
    case 'clear':
      return 'None open';
  }
}

/** One sentence under the tile value. */
export function verdictDetail(v: CodeVerdict, liensChecked: boolean): string {
  switch (v.kind) {
    case 'hits':
      return v.liens > 0
        ? `Recorded in county records${v.open > 0 ? `, plus ${v.open} open case${v.open > 1 ? 's' : ''}` : ''}.`
        : 'See the code portal for details.';
    case 'unchecked':
      if (!v.authorityNamed) {
        return v.searched
          ? `We did not establish which authority enforces code here, so its records were not searched. We searched ${v.searched} only.`
          : 'We did not establish which authority enforces code here, so its records were not searched.';
      }
      return sentence(
        v.searched
          ? `${v.authority} enforces code here and its records were not searched. We searched ${v.searched} only.`
          : `${v.authority} enforces code here and its records were not searched.`,
      );
    case 'clear':
      return liensChecked ? 'No open cases or recorded liens.' : 'No open cases. Liens not checked this time.';
  }
}

/**
 * The buyer-facing explanation. The unchecked wording is the whole reason this
 * module exists, so it says plainly that this is not a clean result.
 */
export function verdictBuyerNote(v: CodeVerdict): string {
  switch (v.kind) {
    case 'hits':
      return 'Open cases can carry daily fines and liens that transfer to the new owner. Make the seller close them before closing.';
    case 'unchecked': {
      // What the reader can do next, best option first. A city we can read on
      // request is not a dead end, and saying "ask them yourself" about one of
      // those sends the reader away from the answer we already hold.
      const next = v.deepScanReads
        ? ` A deep scan reads ${v.authority}'s own code records directly - order it and this question gets a real answer.${
            v.portalUrl ? ` To check it yourself, ${v.authority} publishes its cases at ${v.portalUrl}.` : ''
          }`
        : v.portalUrl
          ? ` ${v.authority} publishes its cases at ${v.portalUrl} - search it before you rely on anything above.`
          : v.authorityNamed
            ? ` Ask ${v.authority} directly, or order the full lien search.`
            : ' Confirm which city or county governs this address, then search that office, or order the full lien search.';
      // An unnamed authority cannot be the subject of this sentence: it would
      // read "the code authority is the code authority for this address", which
      // is what every address outside Miami-Dade actually said.
      const opener = v.authorityNamed
        ? `${v.authority} is the code authority for this address, and we could not search its records.`
        : 'We could not establish which authority enforces code at this address, so nothing was searched.';
      return sentence(
        `${opener} This is NOT a clean result - it means nobody has looked. A violation here would not show up above.${next}`,
      );
    }
    case 'clear':
      return 'No open violations means no fines or liens tied to this address right now.';
  }
}

/** The owner-facing version. */
export function verdictOwnerNote(v: CodeVerdict): string {
  switch (v.kind) {
    case 'hits':
      return 'Resolve open cases before you sell. Fines add up until the authority signs off.';
    case 'unchecked':
      if (!v.authorityNamed) {
        return 'We did not establish which authority enforces code at this address, so treat this as unknown rather than clear.';
      }
      return sentence(
        v.deepScanReads
          ? `${v.authority} enforces code at this address and the quick check does not reach it, so treat this as unknown rather than clear. A deep scan searches ${v.authority} directly.`
          : `${v.authority} enforces code at this address and we could not search it, so treat this as unknown rather than clear.`,
      );
    case 'clear':
      return 'Keep it that way. Unresolved cases grow fines every day.';
  }
}

/** Tile colour. Green is only ever for a searched authority that said no. */
export function verdictTone(v: CodeVerdict): 'green' | 'amber' | 'red' {
  switch (v.kind) {
    case 'hits':
      return 'red';
    case 'unchecked':
      return 'amber';
    case 'clear':
      return 'green';
  }
}


// ---------------------------------------------------------------------------
// There is no list of city code portals here any more. On purpose.
//
// This file used to carry one, and it held a single entry (Hialeah) while the
// worker's adapter registry grew to 36 cities. Every one of the other 35 -
// Tampa, West Palm Beach, Coral Gables, Boca Raton - read as a dead end to the
// reader, who was told to go ask the city about records this product reads on
// request. A second copy of an answer does not stay equal to the first; it just
// stops being checked.
//
// The one registry that decides which cities we can read is
// `CITY_JURISDICTIONS` in worker/src/scrapers/jurisdictions.ts. `codeVerdict`
// takes what it needs as `CodeAuthority.cityCoverage`, and
// `lib/city-code-portals.ts` is the only thing that reads the registry, so this
// module stays pure and there is nothing left to go stale.
// ---------------------------------------------------------------------------
