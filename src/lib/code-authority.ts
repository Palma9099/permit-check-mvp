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
}

export type CodeVerdict =
  /** The authority that decides was searched and held nothing. */
  | { kind: 'clear' }
  /** Something was found. */
  | { kind: 'hits'; open: number; liens: number }
  /** The authority that decides was NOT searched. Never render this green. */
  | { kind: 'unchecked'; authority: string; searched: string | null; portalUrl: string | null };

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
    const city = cityLabel(authority.municipality) ?? 'the city';
    return {
      kind: 'unchecked',
      authority: city,
      searched: authority.countyChecked ? 'the county' : null,
      portalUrl: cityCodePortal(authority.municipality)?.url ?? null,
    };
  }

  // Nobody searched anything at all: also not clear.
  if (!authority.cityChecked && !authority.countyChecked) {
    return { kind: 'unchecked', authority: 'the code authority', searched: null, portalUrl: null };
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
    };
  }

  return { kind: 'clear' };
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
      return v.searched
        ? `${v.authority} enforces code here and its records were not searched. We searched ${v.searched} only.`
        : `${v.authority} enforces code here and its records were not searched.`;
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
      const portal = v.portalUrl
        ? ` ${v.authority} publishes its cases at ${v.portalUrl} - search it before you rely on anything above.`
        : ` Ask ${v.authority} directly, or order the full lien search.`;
      return `${v.authority} is the code authority for this address, and we could not search its records. This is NOT a clean result - it means nobody has looked. A violation here would not show up above.${portal}`;
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
      return `${v.authority} enforces code at this address and we could not search it, so treat this as unknown rather than clear.`;
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
// Known city code-case portals.
//
// When we cannot search a city ourselves, the next best thing is to send the
// reader straight to the search that WILL answer, rather than leaving "not
// checked" as a dead end. Each entry here has been opened and confirmed to
// return code cases for a real address without a login.
// ---------------------------------------------------------------------------

export interface CityCodePortal {
  /** Municipality exactly as the property appraiser spells it. */
  municipality: string;
  county: string;
  label: string;
  url: string;
  /** The platform, for whoever writes the adapter next. */
  platform: string;
  /** Can an adapter read it without an account? */
  publicSearch: boolean;
}

export const CITY_CODE_PORTALS: CityCodePortal[] = [
  {
    // Verified 2026-11-09 against 135 W 60 ST: module 5 ("Code Case") is
    // enabled and anonymous, and the search returned case BWOP-001873-2025,
    // "Building Without A Permit", status Lien, parcel 0421310020800 - the
    // violation a county-only check reported as "None open".
    municipality: 'HIALEAH',
    county: 'miami-dade',
    label: 'Hialeah code case search',
    url: 'https://hialeahfl-energovpub.tylerhost.net/apps/selfservice#/search',
    platform: 'Tyler EnerGov Citizen Self Service',
    publicSearch: true,
  },
];

/** The city's own code search, when we know of one. */
export function cityCodePortal(municipality: string | null): CityCodePortal | null {
  const m = (municipality ?? '').trim().toUpperCase();
  if (!m) return null;
  return CITY_CODE_PORTALS.find((p) => p.municipality.toUpperCase() === m) ?? null;
}
