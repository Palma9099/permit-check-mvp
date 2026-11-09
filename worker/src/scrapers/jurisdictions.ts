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

export const SUPPORTED_JURISDICTIONS = Object.keys(JURISDICTIONS);
