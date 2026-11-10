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
import { DEFAULT_SHARD, searchUrlOn, type CitizenserveAgency } from './citizenserve-parse.js';
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
      // DEFAULT_SHARD, not a literal. Every link here used to be pinned to
      // www6, which on 2026-11-10 served a 2,591-byte stub with no search
      // form while www through www5 served the real page. That made the
      // adapter's honest refusal useless: it tells a reader to open the
      // portal and check the property themselves, and the link was dead.
      // The adapter rewrites these to the shard it actually opened, so this
      // is only the value before anything has been tried.
      url: searchUrlOn(DEFAULT_SHARD, id),
    },
    ...(site ? [{ label: 'Property Appraiser', url: site }] : []),
  ];
}

/**
 * The citizenserve CITY tenants that publish code cases, now routed.
 *
 * These sat parked in this file because the worker had no city-level routing
 * when the adapter was written. It has it now (CITY_JURISDICTIONS plus
 * resolveJurisdiction), so each one is wired below and the 115,430 people they
 * cover are no longer left on the table.
 *
 * Every county here was resolved from the Census, not assumed, because the
 * assumption is wrong at least once in this very list: the CITY of Seminole
 * is in PINELLAS County, not Seminole County. Resolved 2026-11-10 against
 * TIGERweb Incorporated Places (layer 25, Census 2020) for the place and
 * Counties (layer 55) for the county at the place's centroid.
 *
 * Layer 25 and not layer 26: layer 26 is Census DESIGNATED Places, which are
 * statistical areas with no government, so they can neither run a code office
 * nor be counted as municipalities.
 */
export const CITIZENSERVE_CITY_AGENCIES: CitizenserveAgency[] = [
  { installationID: 221, name: 'Casselberry', kind: 'city', fileTypes: ['Permit', 'License', 'Development', 'Code'] },
  { installationID: 441, name: 'City of Seminole', kind: 'city', fileTypes: ['Permit', 'License', 'Code'] },
  { installationID: 261, name: 'West Park', kind: 'city', fileTypes: ['Permit', 'Development', 'Code'] },
  { installationID: 401, name: 'Montverde', kind: 'city', fileTypes: ['Permit', 'Development', 'Code'] },
  { installationID: 237, name: 'Bradenton Beach', kind: 'city', fileTypes: ['Permit', 'License', 'Development', 'Code'] },
  { installationID: 326, name: 'Key Colony Beach', kind: 'city', fileTypes: ['Permit', 'License', 'Development', 'Code'] },
];

/**
 * County, municipality-as-the-appraiser-spells-it, and 2020 population for
 * each of the seven. The municipality string is the routing key, and it has to
 * match what the property appraiser returns, never a postal city.
 */
const CS_CITY_ROUTES: Array<{
  id: number;
  county: string;
  municipality: string;
  /** Census 2020 population, for coverage accounting that is checkable. */
  pop: number;
  /** The county property appraiser, so the reader can find their parcel id. */
  pa?: string;
}> = [
  // Titusville is NOT here. See CITIZENSERVE_NO_CODE: its code search refuses
  // an address alone and asks for additional criteria, so it cannot answer the
  // only question this product asks.
  { id: 221, county: 'seminole', municipality: 'CASSELBERRY', pop: 28794, pa: 'https://www.scpafl.org/' },
  // City of Seminole sits in PINELLAS County. Not Seminole County.
  { id: 441, county: 'pinellas', municipality: 'SEMINOLE', pop: 19364, pa: 'https://www.pcpao.gov/' },
  { id: 261, county: 'broward', municipality: 'WEST PARK', pop: 15130, pa: 'https://web.bcpa.net/' },
  { id: 401, county: 'lake', municipality: 'MONTVERDE', pop: 1655, pa: 'https://www.lakecopropappr.com/' },
  { id: 237, county: 'manatee', municipality: 'BRADENTON BEACH', pop: 908, pa: 'https://www.manateepao.gov/' },
  { id: 326, county: 'monroe', municipality: 'KEY COLONY BEACH', pop: 790, pa: 'https://www.mcpafl.org/' },
];

/**
 * Total population the routed city tenants reach: 66,641.
 *
 * Six cities, not seven. Titusville (48,789, the largest of the original
 * seven and 42 percent of the batch) was dropped after a live probe, so this
 * number is what the adapter can actually read rather than what the tenant
 * list suggests. Crediting it would have been the single biggest overcount
 * available here.
 */
export const CITIZENSERVE_CITY_POPULATION = CS_CITY_ROUTES.reduce((n, r) => n + r.pop, 0);

for (const route of CS_CITY_ROUTES) {
  const agency = CITIZENSERVE_CITY_AGENCIES.find((a) => a.installationID === route.id);
  // A route with no agency would silently route a city to nothing, so fail
  // loudly at module load rather than at a reader's request.
  if (!agency) throw new Error(`citizenserve route ${route.id} has no agency entry`);
  CITY_JURISDICTIONS[`${route.county}:${route.municipality}`] = {
    platform: 'citizenserve',
    county: route.county,
    name: agency.name.startsWith('City of') ? agency.name : `City of ${agency.name}`,
    agency,
    portalLinks: csLinks(route.id, route.pa),
    source: `${agency.name} citizenserve portal (code enforcement cases, citywide)`,
  };
}

/**
 * Florida citizenserve tenants that do NOT publish usable code cases.
 *
 * Two different failures live here and both end the same way. Most of these
 * tenants simply do not expose the Code file type. Titusville and Eatonville
 * are worse: they offer it and then give nothing to search with, which looks
 * like coverage from the tenant list and is not.
 */
export const CITIZENSERVE_NO_CODE: CitizenserveAgency[] = [
  // Verified live 2026-11-10, and the FIRST reason recorded here was wrong.
  //
  // It is not that no criteria fields render. They do: selecting the only file
  // type, "Code Complaints", renders #address and #parcelNumber, both visible
  // at 885x35, once the page's own handler has run. An earlier check missed
  // them because a plain selectOption leaves them hidden and only the
  // keystroke fallback brings them up, so "no fields" was a reading of a
  // half-driven form.
  //
  // The real blocker is one step later. Filling #address with a real
  // Titusville street and submitting returns:
  //
  //   "No records found" + "Error / Please enter additional search criteria"
  //
  // The tenant demands more than an address. Since an address is what this
  // product has, no property can be looked up here. Same conclusion, correct
  // reason. Its fileTypes are recorded as [] to keep it out of any search,
  // and the adapter now recognises that rejection by name rather than
  // reaching the right answer through a fallback.
  { installationID: 403, name: 'Titusville', kind: 'city', fileTypes: [] },
  { installationID: 245, name: 'Walton County', kind: 'county', fileTypes: ['Development'] },
  { installationID: 175, name: 'Wakulla County', kind: 'county', fileTypes: ['Permit', 'License', 'Development'] },
  { installationID: 197, name: 'Gulf County', kind: 'county', fileTypes: ['Permit', 'License'] },
  { installationID: 331, name: 'City of Cocoa', kind: 'city', fileTypes: ['Permit'] },
  { installationID: 117, name: 'Southwest Ranches', kind: 'city', fileTypes: ['Permit'] },
  { installationID: 171, name: 'Anna Maria', kind: 'city', fileTypes: ['Permit', 'License', 'Development'] },
  { installationID: 391, name: 'Eatonville', kind: 'city', fileTypes: [] },
];


// --- EnerGov city expansion, verified 2026-11-10 -----------------------------
//
// Found by probing Florida's 412 incorporated places (Census TIGERweb layer 25,
// Census 2020) against the EnerGov host patterns actually observed, because a
// single pattern guess fails: the Tyler-hosted tenants split between
// -energovPUB and -energovWEB, Doral capitalises its path /apps/SelfService,
// and Miami Beach self-hosts on its own domain entirely.
//
// 26 tenants answered. 22 are listed below. THE OTHER FOUR ARE NOT COVERAGE,
// and the difference is the whole point:
//
//   Sanibel          6,382  TWO RUNS DISAGREED, see below
//   Marco Island    15,760  portal could not be read on the verification run
//   Neptune Beach    7,217  portal could not be read on the verification run
//   Marianna         6,245  portal could not be read on the verification run
//
// Sanibel is the interesting one and the reason this list is worth reading.
// The first verification run refused it with "runs EnerGov but does not
// publish code cases - that module is switched off", which is the note that
// fires only after the live module list HAS been read and found to lack
// module 5. Fourteen minutes later a second run read it as usable, answering
// a PERIWINKLE WAY search with zero cases.
//
// Both readings cannot be right, and a tenant whose module list answers
// differently fourteen minutes apart is UNSTABLE, which is not the same as
// usable. It stays out. Routing it would mean a property in Sanibel could
// report clear on a run that happened to read the module list successfully
// while the records behind it were never searched - and picking the
// convenient reading of two contradictory ones is exactly the habit this
// product exists to not have. It can be routed when runs agree.
//
// Each was left out rather than entered hopefully. A hostname answering says
// nothing about whether code cases are public, and the three unreadable ones
// may well be fine on another day - they can be added when a run confirms it,
// which is a smaller cost than a city wrongly reporting clear.
//
// Every entry below was confirmed by running the PRODUCTION adapter against a
// real street in that city and getting a readable result, not by checking that
// a host responds. Three times today a hand-written probe reported a failed
// read as a finding - one of them would have discarded seven cities and
// 675,709 people - so the adapter's own answer is the only one recorded.
//
// Counties come from the Census, never from the city name: resolved against
// TIGERweb Incorporated Places for the place and Counties (layer 55) for the
// county at its centroid. The city of Seminole sitting in Pinellas County,
// found earlier in the citizenserve batch, is why.

interface EnergovCityRoute {
  /** Census 2020 population, so coverage can be audited rather than asserted. */
  pop: number;
  county: string;
  /** Municipality as the property appraiser spells it. The routing key. */
  municipality: string;
  host: string;
  basePath: string;
}

/** The county property appraiser, so a reader can find their own parcel id.
 *  Every URL below was loaded and confirmed to serve a real search page;
 *  paslc.gov answers 403 to a plain fetch but loads normally in a browser. */
const COUNTY_PA: Record<string, string> = {
  'miami-dade': 'https://www.miamidade.gov/pa/property_search.asp',
  broward: 'https://web.bcpa.net/',
  'palm-beach': 'https://pbcpao.gov/',
  volusia: 'https://vcpa.vcgov.org/',
  'st-lucie': 'https://www.paslc.gov/',
  seminole: 'https://www.scpafl.org/',
  orange: 'https://ocpaweb.ocpafl.org/',
  pasco: 'https://pascopa.com/',
  pinellas: 'https://www.pcpao.gov/',
};

const ENERGOV_CITY_ROUTES: EnergovCityRoute[] = [
  { pop: 171178, county: 'broward',     municipality: 'PEMBROKE PINES',     host: 'pembrokepinesfl-energovweb.tylerhost.net',    basePath: '/apps/SelfService' },
  { pop: 134721, county: 'broward',     municipality: 'MIRAMAR',            host: 'miramarfl-energovweb.tylerhost.net',          basePath: '/apps/SelfService' },
  { pop: 117415, county: 'palm-beach',  municipality: 'WEST PALM BEACH',    host: 'westpalmbeachfl-energovpub.tylerhost.net',    basePath: '/apps/selfservice' },
  { pop: 111640, county: 'miami-dade',  municipality: 'MIAMI GARDENS',      host: 'miamigardensfl-energovpub.tylerhost.net',     basePath: '/apps/selfservice' },
  { pop:  97422, county: 'palm-beach',  municipality: 'BOCA RATON',         host: 'bocaratonfl-energovpub.tylerhost.net',        basePath: '/apps/selfservice' },
  { pop:  93692, county: 'volusia',     municipality: 'DELTONA',            host: 'deltonafl-energovweb.tylerhost.net',          basePath: '/apps/SelfService' },
  { pop:  61637, county: 'palm-beach',  municipality: 'WELLINGTON',         host: 'wellingtonfl-energovweb.tylerhost.net',       basePath: '/apps/SelfService' },
  { pop:  59182, county: 'palm-beach',  municipality: 'PALM BEACH GARDENS', host: 'palmbeachgardensfl-energovweb.tylerhost.net', basePath: '/apps/SelfService' },
  { pop:  47297, county: 'st-lucie',    municipality: 'FORT PIERCE',        host: 'fortpiercefl-energovweb.tylerhost.net',       basePath: '/apps/SelfService' },
  { pop:  44229, county: 'broward',     municipality: 'OAKLAND PARK',       host: 'oaklandparkfl-energovweb.tylerhost.net',      basePath: '/apps/SelfService' },
  { pop:  43080, county: 'volusia',     municipality: 'ORMOND BEACH',       host: 'ormondbeachfl-energovweb.tylerhost.net',      basePath: '/apps/SelfService' },
  { pop:  38342, county: 'seminole',    municipality: 'WINTER SPRINGS',     host: 'winterspringsfl-energovweb.tylerhost.net',    basePath: '/apps/SelfService' },
  { pop:  37604, county: 'palm-beach',  municipality: 'RIVIERA BEACH',      host: 'rivierabeachfl-energovweb.tylerhost.net',     basePath: '/apps/SelfService' },
  { pop:  30142, county: 'volusia',     municipality: 'NEW SMYRNA BEACH',   host: 'newsmyrnabeachfl-energovweb.tylerhost.net',   basePath: '/apps/SelfService' },
  { pop:  19543, county: 'orange',      municipality: 'MAITLAND',           host: 'maitlandfl-energovpub.tylerhost.net',         basePath: '/apps/selfservice' },
  { pop:  17194, county: 'pasco',       municipality: 'ZEPHYRHILLS',        host: 'zephyrhillsfl-energovweb.tylerhost.net',      basePath: '/apps/SelfService' },
  { pop:   8159, county: 'miami-dade',  municipality: 'NORTH BAY VILLAGE',  host: 'northbayvillagefl-energovpub.tylerhost.net',  basePath: '/apps/selfservice' },
  { pop:   5689, county: 'miami-dade',  municipality: 'SURFSIDE',           host: 'surfsidefl-energovpub.tylerhost.net',         basePath: '/apps/selfservice' },
  { pop:   5353, county: 'pinellas',    municipality: 'SOUTH PASADENA',     host: 'southpasadenafl-energovweb.tylerhost.net',    basePath: '/apps/SelfService' },
];

/** People reached by the EnerGov cities added in this expansion: 1,143,519. */
export const ENERGOV_EXPANSION_POPULATION = ENERGOV_CITY_ROUTES.reduce((n, r) => n + r.pop, 0);

function titleCase(muni: string): string {
  return muni
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

for (const r of ENERGOV_CITY_ROUTES) {
  const name = `City of ${titleCase(r.municipality)}`;
  const tenant: EnergovTenant = {
    host: r.host,
    name,
    kind: 'city',
    // Module 5 confirmed on the live page during verification. The adapter
    // re-reads the module list every run and refuses if it has gone, so this
    // is a snapshot rather than a standing claim.
    modules: [1, 2, 3, 4, 5, 6, 10, 11],
    basePath: r.basePath,
  };
  const pa = COUNTY_PA[r.county];
  if (!pa) throw new Error(`no property appraiser link for county ${r.county}`);
  CITY_JURISDICTIONS[`${r.county}:${r.municipality}`] = {
    platform: 'energov',
    county: r.county,
    name,
    tenant,
    portalLinks: energovLinks(tenant, [{ label: 'County Property Appraiser', url: pa }]),
    source: `${name} EnerGov portal (code cases, citywide)`,
  };
}

export const SUPPORTED_JURISDICTIONS = Object.keys(JURISDICTIONS);
