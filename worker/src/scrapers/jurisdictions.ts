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

export interface GenericJurisdiction {
  platform: 'generic';
  county: string;
  name: string;
  config: PortalConfig;         // the existing best-effort form config
}

export type Jurisdiction = AccelaJurisdiction | GenericJurisdiction;

export const JURISDICTIONS: Record<string, Jurisdiction> = {
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

  'palm-beach': {
    platform: 'accela',
    county: 'palm-beach',
    name: 'Palm Beach County',
    agency: 'PBC',
    buildingModule: 'Building',
    enforcementModule: 'CodeEnforcement',
    portalLinks: [
      { label: 'PBCPAO (Property Appraiser)', url: 'https://pbcpao.gov/' },
      { label: 'PBC Accela Citizen Access', url: 'https://aca-prod.accela.com/PBC/Default.aspx' },
      { label: 'PBC ePZB (Building)', url: 'https://discover.pbcgov.org/pzb/building/' },
    ],
    source: 'Palm Beach County Accela Citizen Access',
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
