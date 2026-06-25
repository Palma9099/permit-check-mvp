// Per-county portal configs.
//
// ⚠ CALIBRATION: the searchUrl / selector lists below are best-effort starting
// points. Run `npm run calibrate -- "<address>" <county>` against the deployed
// worker (which has a real browser) to confirm each portal's current search URL,
// input selectors, and submit button, then tighten these arrays. The generic
// engine tries every selector in order and degrades to portal links on miss, so
// an out-of-date selector never produces wrong data — only a "use the link"
// email until calibrated.

import type { PortalConfig } from './types.js';

const COMMON_SUBMIT = [
  'input[type=submit]',
  'button[type=submit]',
  'button:has-text("Search")',
  'input[value="Search" i]',
  'a:has-text("Search")',
  '#ctl00_PlaceHolderMain_btnNewSearch',
];

const COMMON_ADDRESS_INPUTS = [
  'input[name*="address" i]',
  'input[id*="address" i]',
  'input[placeholder*="address" i]',
  'input[aria-label*="address" i]',
];

export const COUNTY_CONFIGS: Record<string, PortalConfig> = {
  'broward': {
    county: 'broward',
    source: 'Broward County permit & code-enforcement portals',
    portalLinks: [
      { label: 'BCPA (Property Appraiser)', url: 'https://web.bcpa.net/bcpaclient/#/Record-Search' },
      { label: 'Broward ePermits / BASS', url: 'https://bassonline.broward.org/' },
      { label: 'Broward Code Enforcement', url: 'https://www.broward.org/CodeEnforcement' },
    ],
    permit: {
      searchUrl: 'https://aca-prod.accela.com/BROWARD/Cap/CapHome.aspx?module=Building&TabName=Building',
      addressInputSelectors: [
        'input[id*="GeneralSearch_txtGSStreetName" i]',
        'input[id*="StreetName" i]',
        ...COMMON_ADDRESS_INPUTS,
      ],
      submitSelectors: COMMON_SUBMIT,
      resultHeaderKeywords: ['record', 'permit', 'date', 'status'],
    },
    code: {
      searchUrl: 'https://aca-prod.accela.com/BROWARD/Cap/CapHome.aspx?module=Enforcement',
      addressInputSelectors: COMMON_ADDRESS_INPUTS,
      submitSelectors: COMMON_SUBMIT,
      resultHeaderKeywords: ['case', 'record', 'status', 'date'],
    },
  },

  'palm-beach': {
    county: 'palm-beach',
    source: 'Palm Beach County ePZB permit & code portals',
    portalLinks: [
      { label: 'PBCPAO (Property Appraiser)', url: 'https://pbcpao.gov/' },
      { label: 'PBC ePZB (Building permits)', url: 'https://discover.pbcgov.org/pzb/building/' },
      { label: 'PBC Code Enforcement', url: 'https://discover.pbcgov.org/pzb/' },
    ],
    permit: {
      searchUrl: 'https://aca-prod.accela.com/PBC/Cap/CapHome.aspx?module=Building&TabName=Building',
      addressInputSelectors: [
        'input[id*="StreetName" i]',
        ...COMMON_ADDRESS_INPUTS,
      ],
      submitSelectors: COMMON_SUBMIT,
      resultHeaderKeywords: ['record', 'permit', 'date', 'status'],
    },
    code: {
      searchUrl: 'https://aca-prod.accela.com/PBC/Cap/CapHome.aspx?module=CodeEnforcement',
      addressInputSelectors: COMMON_ADDRESS_INPUTS,
      submitSelectors: COMMON_SUBMIT,
      resultHeaderKeywords: ['case', 'record', 'status', 'date'],
    },
  },

  'miami-dade': {
    county: 'miami-dade',
    source: 'Miami-Dade RER permit & code portals',
    portalLinks: [
      { label: 'Miami-Dade Property Appraiser', url: 'https://www.miamidade.gov/pa/property_search.asp' },
      { label: 'Miami-Dade Permits (EPS)', url: 'https://www.miamidade.gov/Apps/RER/EPSPortal/' },
      { label: 'Miami-Dade Code Enforcement', url: 'https://www.miamidade.gov/global/economy/building/home.page' },
    ],
    permit: {
      // Miami-Dade is already covered by the instant API in the app; the deep
      // scan here mainly adds the EPS portal view. EPS is an SPA — calibration
      // likely needs explicit waits on its result grid.
      searchUrl: 'https://www.miamidade.gov/Apps/RER/EPSPortal/',
      addressInputSelectors: COMMON_ADDRESS_INPUTS,
      submitSelectors: COMMON_SUBMIT,
      resultHeaderKeywords: ['permit', 'process', 'status', 'date'],
    },
  },
};

export const SUPPORTED_COUNTIES = Object.keys(COUNTY_CONFIGS);
