import type { Page } from 'playwright';
import type { ScrapeResult, PortalLink } from '../types.js';

export interface ScraperCtx {
  page: Page;
  address: string | null;
  folio: string | null;
  log: (msg: string) => void;
}

// PortalConfig moved to portal-config.ts, which must stay playwright-free so
// the jurisdiction registry can be imported from the repo-root tests. It is
// re-exported here so existing importers are unchanged.
export type { PortalConfig } from './portal-config.js';

export type Scraper = (ctx: ScraperCtx) => Promise<ScrapeResult>;
