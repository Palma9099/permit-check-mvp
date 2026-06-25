// Calibration helper — run a single county scrape with a visible browser so you
// can confirm/tighten the selectors in scrapers/counties.ts against the live
// portal. Prints the structured result (no email, no queue).
//
//   HEADLESS=false npm run calibrate -- "1450 Collins Ave, Miami Beach, FL 33139" miami-dade
//   npm run calibrate -- "123 Main St, Fort Lauderdale, FL 33301" broward

import { chromium } from 'playwright';
import { runScrapeForJob } from './scrapers/index.js';
import type { ScanJob } from './types.js';

async function main() {
  const address = process.argv[2] ?? '';
  const county = (process.argv[3] ?? '').toLowerCase();
  if (!address || !county) {
    console.error('Usage: npm run calibrate -- "<address>" <county>');
    process.exit(1);
  }

  const headless = process.env.HEADLESS === 'true';
  const browser = await chromium.launch({ headless, args: ['--no-sandbox'] });

  const job: ScanJob = {
    id: 'calibrate-run',
    status: 'running',
    email: 'calibrate@local',
    address,
    folio: null,
    county,
    lat: null,
    lng: null,
    attempts: 1,
    max_attempts: 1,
  };

  const result = await runScrapeForJob(browser, job);
  console.log('\n===== SCRAPE RESULT =====');
  console.log(JSON.stringify(result, null, 2));

  if (!headless) {
    console.log('\nBrowser left open for 30s for inspection…');
    await new Promise((r) => setTimeout(r, 30000));
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
