// Declarative config for a county portal, kept apart from ScraperCtx on
// purpose.
//
// ScraperCtx holds a playwright Page, so anything importing it imports
// playwright. The jurisdiction registry needs only this config type, and the
// repo-root tests need the registry - so putting the two in one file dragged
// playwright into the Next.js build's TypeScript program, where it does not
// exist (Vercel installs root dependencies only). Nothing in this file may
// import playwright.
//
// Selectors are best-effort lists - the generic engine tries each in order, so
// adding or calibrating a selector is a one-line change. See CALIBRATION in
// worker/README.md.

import type { PortalLink } from '../types.js';

export interface PortalConfig {
  county: string;
  source: string;
  portalLinks: PortalLink[];

  permit: {
    searchUrl: string;
    addressInputSelectors: string[];
    folioInputSelectors?: string[];
    submitSelectors: string[];
    resultHeaderKeywords: string[]; // pick the results table by header match
  };
  code?: {
    searchUrl: string;
    addressInputSelectors: string[];
    submitSelectors: string[];
    resultHeaderKeywords: string[];
  };
}
