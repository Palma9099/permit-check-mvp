// Scraper dispatch. Given a job's county, run the right portal scrape. Unknown
// or out-of-scope counties still get a useful result: a "no automated scrape
// for this county yet" message plus statewide guidance (never fabricated data).

import type { Browser } from 'playwright';
import type { ScanJob, ScrapeResult } from '../types.js';
import type { ScraperCtx } from './types.js';
import { runPortalScrape } from './generic.js';
import { COUNTY_CONFIGS } from './counties.js';

const HARD_TIMEOUT = Number(process.env.SCRAPE_TIMEOUT_MS ?? 240000);

export async function runScrapeForJob(browser: Browser, job: ScanJob): Promise<ScrapeResult> {
  const county = (job.county ?? '').toLowerCase();
  const cfg = COUNTY_CONFIGS[county];

  if (!cfg) {
    return {
      ok: false,
      county: county || 'unknown',
      matchedAddress: job.address,
      folio: job.folio,
      permits: [],
      violations: [],
      notes: [
        county
          ? `Automated deep scraping for ${county} isn't wired up yet — only Miami-Dade, Broward, and Palm Beach are. Use the county's property-appraiser and building-department search to confirm records.`
          : 'We could not determine the county for this property. Confirm the address/ZIP and try again.',
      ],
      portalLinks: [
        { label: 'Find your county Property Appraiser', url: 'https://floridarevenue.com/property/Pages/LocalOfficials.aspx' },
      ],
      source: 'no county adapter',
    };
  }

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  const logs: string[] = [];
  const ctx: ScraperCtx = {
    page,
    address: job.address,
    folio: job.folio,
    log: (m) => {
      logs.push(m);
      console.log(`[scrape ${job.id.slice(0, 8)}] ${m}`);
    },
  };

  try {
    const result = await Promise.race([
      runPortalScrape(ctx, cfg),
      new Promise<ScrapeResult>((_, reject) =>
        setTimeout(() => reject(new Error(`hard timeout after ${HARD_TIMEOUT}ms`)), HARD_TIMEOUT),
      ),
    ]);
    return result;
  } finally {
    await context.close().catch(() => {});
  }
}
