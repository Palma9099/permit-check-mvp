import type { Page } from 'playwright';
import type { ScrapeResult, PortalLink } from '../types.js';

export interface ScraperCtx {
  page: Page;
  address: string | null;
  folio: string | null;
  log: (msg: string) => void;
}

// Declarative config for a county portal. Selectors are best-effort lists —
// the generic engine tries each in order, so adding/calibrating a selector is a
// one-line change. See CALIBRATION in worker/README.md.
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

export type Scraper = (ctx: ScraperCtx) => Promise<ScrapeResult>;
