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
import type { CitizenserveAgency } from './citizenserve-parse.js';
import { searchUrl as energovSearchUrl, type EnergovTenant } from './energov-parse.js';
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

export interface CitizenserveJurisdiction {
  platform: 'citizenserve';
  county: string;
  name: string;
  agency: CitizenserveAgency;
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
  | CitizenserveJurisdiction
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
  alachua: {
    platform: 'citizenserve',
    county: 'alachua',
    name: 'Alachua County',
    agency: {
      installationID: 318,
      name: 'Alachua County',
      kind: 'county',
      fileTypes: ['Permit', 'License', 'Development', 'Code'],
    },
    portalLinks: csLinks(318, 'https://www.acpafl.org/'),
    source: 'Alachua County citizenserve portal (code enforcement cases, unincorporated county)',
  },

  sumter: {
    platform: 'citizenserve',
    county: 'sumter',
    name: 'Sumter County',
    agency: {
      installationID: 445,
      name: 'Sumter County',
      kind: 'county',
      fileTypes: ['Permit', 'Development', 'Code'],
    },
    portalLinks: csLinks(445, 'https://www.sumterpa.com/'),
    source: 'Sumter County citizenserve portal (code enforcement cases, unincorporated county)',
  },

  franklin: {
    platform: 'citizenserve',
    county: 'franklin',
    name: 'Franklin County',
    agency: {
      installationID: 389,
      name: 'Franklin County',
      kind: 'county',
      fileTypes: ['Permit', 'License', 'Development', 'Code'],
    },
    portalLinks: csLinks(389, 'https://www.franklincountypa.gov/'),
    source: 'Franklin County citizenserve portal (code enforcement cases, unincorporated county)',
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
  // Verified 2026-11-09. Module 5 present on all three.
  'coral-gables': {
    host: 'coralgablesfl-energovpub.tylerhost.net',
    name: 'City of Coral Gables',
    kind: 'city',
    modules: [1, 2, 3, 4, 5, 6, 10, 11],
  },
  doral: {
    host: 'doralfl-energovweb.tylerhost.net',
    name: 'City of Doral',
    kind: 'city',
    // "energovWEB", not "energovpub" - the suffix is not constant either.
    modules: [1, 2, 3, 4, 5, 6, 10, 11],
  },
  'miami-beach': {
    host: 'energovcss.miamibeachfl.gov',
    name: 'City of Miami Beach',
    kind: 'city',
    // Self-hosted on the city's own domain, and served from its own path
    // rather than /apps/selfservice.
    basePath: '/energovprod/selfservice',
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
  { label: `${t.name} code case search`, url: energovSearchUrl(t) },
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
  'miami-dade:MIAMI BEACH': {
    platform: 'energov',
    county: 'miami-dade',
    name: 'City of Miami Beach',
    tenant: ENERGOV_TENANTS['miami-beach'],
    portalLinks: energovLinks(ENERGOV_TENANTS['miami-beach']),
    source: 'City of Miami Beach EnerGov portal (code cases, citywide)',
  },

  'miami-dade:CORAL GABLES': {
    platform: 'energov',
    county: 'miami-dade',
    name: 'City of Coral Gables',
    tenant: ENERGOV_TENANTS['coral-gables'],
    portalLinks: energovLinks(ENERGOV_TENANTS['coral-gables']),
    source: 'City of Coral Gables EnerGov portal (code cases, citywide)',
  },

  'miami-dade:DORAL': {
    platform: 'energov',
    county: 'miami-dade',
    name: 'City of Doral',
    tenant: ENERGOV_TENANTS.doral,
    portalLinks: energovLinks(ENERGOV_TENANTS.doral),
    source: 'City of Doral EnerGov portal (code cases, citywide)',
  },

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

// --- citizenserve -----------------------------------------------------------
//
// The one platform with an open registry: every tenant is the same URL with an
// integer installationID, so Florida's whole tenant list was enumerable (39
// tenants between id 97 and 650).
//
// But being on citizenserve says NOTHING about whether code cases are public.
// The file types a tenant exposes are per-tenant configuration. Surveyed live
// on 2026-11-09 across the 17 confirmed Florida tenants:
//
//   Code exposed (10)   318 Alachua Co, 445 Sumter Co, 389 Franklin Co,
//                       403 Titusville, 221 Casselberry, 441 Seminole,
//                       261 West Park, 401 Montverde, 237 Bradenton Beach,
//                       326 Key Colony Beach
//   No Code (7)         245 Walton Co (Development only), 175 Wakulla Co,
//                       197 Gulf Co, 331 Cocoa (Permit only),
//                       117 Southwest Ranches (Permit only), 171 Anna Maria,
//                       391 Eatonville (search offers nothing)
//
// Reach of the 10, counting counties at their UNINCORPORATED population only:
// 340,783 people - 225,353 unincorporated county plus 115,430 city.
//
// Only the three counties are wired below, because this registry is keyed by
// county and the worker has no city-level routing yet. The seven city tenants
// are listed in CITIZENSERVE_CITY_AGENCIES, ready for when it does; that is
// 115,430 people currently left on the table.

// A function declaration, not a const arrow: JURISDICTIONS is declared above
// this block and calls it, so it has to hoist.
function csLinks(id: number, site?: string): PortalLink[] {
  return [
    {
      label: 'Code case search (citizenserve portal)',
      url: `https://www6.citizenserve.com/Portal/PortalController?Action=showSearchPage&ctzPagePrefix=Portal_&installationID=${id}`,
    },
    ...(site ? [{ label: 'Property Appraiser', url: site }] : []),
  ];
}

/** City tenants that publish code cases, pending city-level routing. */
export const CITIZENSERVE_CITY_AGENCIES: CitizenserveAgency[] = [
  { installationID: 403, name: 'Titusville', kind: 'city', fileTypes: ['Code'] },
  { installationID: 221, name: 'Casselberry', kind: 'city', fileTypes: ['Permit', 'License', 'Development', 'Code'] },
  { installationID: 441, name: 'City of Seminole', kind: 'city', fileTypes: ['Permit', 'License', 'Code'] },
  { installationID: 261, name: 'West Park', kind: 'city', fileTypes: ['Permit', 'Development', 'Code'] },
  { installationID: 401, name: 'Montverde', kind: 'city', fileTypes: ['Permit', 'Development', 'Code'] },
  { installationID: 237, name: 'Bradenton Beach', kind: 'city', fileTypes: ['Permit', 'License', 'Development', 'Code'] },
  { installationID: 326, name: 'Key Colony Beach', kind: 'city', fileTypes: ['Permit', 'License', 'Development', 'Code'] },
];

/** Florida citizenserve tenants that do NOT publish code cases. */
export const CITIZENSERVE_NO_CODE: CitizenserveAgency[] = [
  { installationID: 245, name: 'Walton County', kind: 'county', fileTypes: ['Development'] },
  { installationID: 175, name: 'Wakulla County', kind: 'county', fileTypes: ['Permit', 'License', 'Development'] },
  { installationID: 197, name: 'Gulf County', kind: 'county', fileTypes: ['Permit', 'License'] },
  { installationID: 331, name: 'City of Cocoa', kind: 'city', fileTypes: ['Permit'] },
  { installationID: 117, name: 'Southwest Ranches', kind: 'city', fileTypes: ['Permit'] },
  { installationID: 171, name: 'Anna Maria', kind: 'city', fileTypes: ['Permit', 'License', 'Development'] },
  { installationID: 391, name: 'Eatonville', kind: 'city', fileTypes: [] },
];

export const SUPPORTED_JURISDICTIONS = Object.keys(JURISDICTIONS);
