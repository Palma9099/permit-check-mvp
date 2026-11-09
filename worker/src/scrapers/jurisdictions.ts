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
import type { PortalConfig } from './types.js';
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

export type Jurisdiction = AccelaJurisdiction | PbcJurisdiction | GenericJurisdiction;

export const JURISDICTIONS: Record<string, Jurisdiction> = {
  // DEFECT, verified 2026-11-09: aca-prod.accela.com/BROWARD/ returns HTTP 404.
  // Broward County is not on Accela; it runs Posse (Computronix) at
  // dpepp.broward.org/BCS, whose folio search works and whose detail pages are
  // plain GET. This entry therefore cannot read anything and every Broward deep
  // scan falls through to "portal could not be read". Needs its own adapter -
  // note that Broward's county caseload is unincorporated-only too (16,888
  // people), so weigh that before building it.
  broward: {
    platform: 'accela',
    county: 'broward',
    name: 'Broward County',
    agency: 'BROWARD',
    buildingModule: 'Building',
    enforcementModule: 'Enforcement',
    portalLinks: [
      { label: 'BCPA (Property Appraiser)', url: 'https://web.bcpa.net/bcpaclient/#/Record-Search' },
      { label: 'Broward Accela Citizen Access', url: 'https://aca-prod.accela.com/BROWARD/Default.aspx' },
      { label: 'Broward Code Enforcement', url: 'https://www.broward.org/CodeEnforcement' },
    ],
    source: 'Broward County Accela Citizen Access (permits + code enforcement)',
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
