// Jurisdiction registry - keyed by normalized county (later: city) key.
//
// The scraper is organized by PLATFORM, not by city: most Florida jurisdictions
// run one of a few permitting products, and the only thing that changes per
// jurisdiction is an agency code. Accela Citizen Access (ACA) alone hosts
// Broward, Palm Beach, and many cities at aca-prod.accela.com/<AGENCY>/… - so a
// single Accela flow + this registry of agency codes unlocks all of them.
//
// To add an Accela jurisdiction: confirm its agency code (the path segment in
// its ACA URL) and its module names, then add one entry below. To add a
// jurisdiction on a different product, give it platform:'generic' with a
// PortalConfig (see counties.ts) until a dedicated platform flow exists.

import type { PortalLink } from '../types.js';
import type { PortalConfig } from './portal-config.js';
import type { EnergovTenant } from './energov-parse.js';
import { COUNTY_CONFIGS } from './counties.js';

export interface AccelaJurisdiction {
  platform: 'accela';
  county: string;
  name: string;
  agency: string;               // ACA agency code, e.g. 'BROWARD' → aca-prod.accela.com/BROWARD/
  buildingModule: string;       // Accela module name for building permits
  enforcementModule: string | null; // module name for code cases, or null if none
  portalLinks: PortalLink[];
  source: string;
}

export interface EnergovJurisdiction {
  platform: 'energov';
  county: string;
  name: string;
  tenant: EnergovTenant;
  portalLinks: PortalLink[];
  source: string;
}

export interface BrowardJurisdiction {
  platform: 'broward-bcs';
  county: string;
  name: string;
  portalLinks: PortalLink[];
  source: string;
}

export interface PbcJurisdiction {
  platform: 'pbc-epzb';
  county: string;
  name: string;
  portalLinks: PortalLink[];
  source: string;
}

export interface GenericJurisdiction {
  platform: 'generic';
  county: string;
  name: string;
  config: PortalConfig;         // the existing best-effort form config
}

export type Jurisdiction =
  | AccelaJurisdiction
  | EnergovJurisdiction
  | BrowardJurisdiction
  | PbcJurisdiction
  | GenericJurisdiction;

export const JURISDICTIONS: Record<string, Jurisdiction> = {
  // Broward runs Posse (Computronix), not Accela. This entry used to point at
  // aca-prod.accela.com/BROWARD/, which returns HTTP 404 - so every Broward deep
  // scan silently fell through to "portal could not be read". See broward.ts.
  //
  // Note the county's reach: its code enforcement covers unincorporated Broward
  // (BMSD), 16,888 of 1,944,375 people, plus Unsafe Structure cases it hears for
  // cities under interlocal agreement. The adapter resolves the real authority
  // from the parcel point before interpreting an empty result.
  broward: {
    platform: 'broward-bcs',
    county: 'broward',
    name: 'Broward County',
    portalLinks: [
      { label: 'BCPA (Property Appraiser) - look up your folio', url: 'https://web.bcpa.net/bcpaclient/#/Record-Search' },
      { label: 'Broward County code case search', url: 'https://dpepp.broward.org/BCS/Default.aspx?PossePresentation=ParcelSearchForEnforcement' },
      { label: 'Broward County permit search', url: 'https://dpepp.broward.org/BCS/Default.aspx?PossePresentation=ParcelSearchByAddress' },
      { label: 'Broward Official Records (recorded liens)', url: 'https://officialrecords.broward.org/AcclaimWeb/' },
    ],
    source: 'Broward County BCS / Posse (county code cases + county permits, unincorporated Broward plus county-heard unsafe structure cases)',
  },

  // Palm Beach runs ePZB, not Accela. The previous entry here pointed at
  // aca-prod.accela.com/PBC/, which 404s - that agency code came from an
  // aggregator's coverage page and was never real (verified 2026-11-09: PBC,
  // PBCGOV, PALMBEACH and PBCFL all 404). See pbc.ts.
  'palm-beach': {
    platform: 'pbc-epzb',
    county: 'palm-beach',
    name: 'Palm Beach County',
    portalLinks: [
      { label: 'PBCPAO (Property Appraiser) - look up your PCN', url: 'https://pbcpao.gov/' },
      { label: 'PBC code compliance case search', url: 'https://pbc.gov/iPZB.CodeCompliance.Service/search' },
      { label: 'PBC building permit search', url: 'https://pbc.gov/iPZB.Building/guest/searchpermits' },
      { label: 'PBC certified lien & permit searches (paid)', url: 'https://discover.pbc.gov/pzb/administration/Pages/Lien-Permit-Searches.aspx' },
    ],
    source: 'Palm Beach County ePZB (free public code compliance + building permit searches, unincorporated county only)',
  },

  // Miami-Dade permits are already covered instantly by the app's countywide API;
  // the deep scan only adds the RER EPS portal view, which is a JS SPA - keep it on
  // the generic engine (with explicit result waits) until a dedicated flow exists.
  'miami-dade': {
    platform: 'generic',
    county: 'miami-dade',
    name: 'Miami-Dade County',
    config: COUNTY_CONFIGS['miami-dade'],
  },
};

// --- Tyler EnerGov Citizen Self Service ------------------------------------
//
// One platform, many jurisdictions, all on tylerhost.net. The only thing that
// changes per tenant is the host and WHICH MODULES ARE ENABLED, and that
// second part decides whether the tenant is any use at all:
//
//   Hialeah       modules 1,2,3,4,5,6,10,11   Code Case ON   (verified 2026-11-09)
//   St Lucie Co   modules 1,2,3,4,6,10,11     Code Case OFF  (verified 2026-11-09)
//
// Note the gap at 5 for St Lucie. Same vendor, same page, opposite answer.

export const ENERGOV_TENANTS: Record<string, EnergovTenant> = {
  hialeah: {
    host: 'hialeahfl-energovpub.tylerhost.net',
    name: 'City of Hialeah',
    kind: 'city',
    // Verified 2026-11-09 against 135 W 60 ST, which returned case
    // BWOP-001873-2025 "Building Without A Permit", status Lien, parcel
    // 0421310020800 - the violation a county-only check called "None open".
    modules: [1, 2, 3, 4, 5, 6, 10, 11],
  },
  'st-lucie': {
    host: 'stluciecountyfl-energovpub.tylerhost.net',
    name: 'St Lucie County',
    kind: 'county',
    // Code Case deliberately absent; the county sells a $20 lien search
    // instead. Registered so we refuse honestly rather than searching a
    // module that is not there and calling the silence clean.
    modules: [1, 2, 3, 4, 6, 10, 11],
  },
};

const energovLinks = (t: EnergovTenant, extra: PortalLink[] = []): PortalLink[] => [
  { label: `${t.name} code case search`, url: `https://${t.host}/apps/selfservice#/search` },
  ...extra,
];

/**
 * City-level jurisdictions, keyed "<county>:<MUNICIPALITY>".
 *
 * The municipality must come from an authoritative source - the property
 * appraiser - and never from the postal city on the address. A Florida postal
 * city routinely names a place that does not govern the parcel, which is the
 * mistake this whole area of the codebase exists to avoid.
 */
export const CITY_JURISDICTIONS: Record<string, Jurisdiction> = {
  'miami-dade:HIALEAH': {
    platform: 'energov',
    county: 'miami-dade',
    name: 'City of Hialeah',
    tenant: ENERGOV_TENANTS.hialeah,
    portalLinks: energovLinks(ENERGOV_TENANTS.hialeah, [
      { label: 'Miami-Dade Property Appraiser', url: 'https://www.miamidade.gov/pa/property_search.asp' },
    ]),
    source: 'City of Hialeah EnerGov portal (code cases, citywide)',
  },
};

/**
 * Pick the jurisdiction that actually governs code at this parcel.
 *
 * A city entry wins over the county when we KNOW the municipality. When we do
 * not, we fall back to the county and the adapter says what it covered - we
 * never guess a city from the address.
 */
export function resolveJurisdiction(
  county: string | null,
  municipality?: string | null,
): Jurisdiction | undefined {
  const c = (county ?? '').toLowerCase();
  const m = (municipality ?? '').trim().toUpperCase();
  if (c && m) {
    const city = CITY_JURISDICTIONS[`${c}:${m}`];
    if (city) return city;
  }
  return JURISDICTIONS[c];
}

export const SUPPORTED_JURISDICTIONS = Object.keys(JURISDICTIONS);
