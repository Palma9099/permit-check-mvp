// Deep-scan worker entry point. Long-lived process: claim a job → scrape →
// email → mark done. Safe to run multiple replicas (atomic claim).

import { chromium, type Browser } from 'playwright';
import { claimJob, completeJob, failJob, markEmailed } from './queue.js';
import { runScrapeForJob } from './scrapers/index.js';
import { buildEmail } from './report.js';
import { sendEmail } from './email.js';
import type { ScrapeResult } from './types.js';

const POLL = Number(process.env.POLL_INTERVAL_MS ?? 5000);
const HEADLESS = process.env.HEADLESS !== 'false';

async function processOne(browser: Browser): Promise<boolean> {
  const job = await claimJob();
  if (!job) return false;
  console.log(`[worker] claimed ${job.id} county=${job.county} attempt=${job.attempts}/${job.max_attempts}`);

  try {
    const result = await runScrapeForJob(browser, job);
    const { subject, html, text } = buildEmail(result, job.address);
    await sendEmail(job.email, subject, html, text);
    await completeJob(job.id, result);
    await markEmailed(job.id);
    console.log(
      `[worker] done ${job.id} permits=${result.permits.length} violations=${result.violations.length} → ${job.email}`,
    );
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const outcome = await failJob(job, msg);
    console.error(`[worker] ${job.id} ${outcome}: ${msg}`);

    // On terminal failure, still email a graceful "couldn't complete" note so
    // the requester is never left hanging.
    if (outcome === 'failed') {
      const fallback: ScrapeResult = {
        ok: false,
        county: job.county ?? 'unknown',
        matchedAddress: job.address,
        folio: job.folio,
        permits: [],
        violations: [],
        notes: [
          'The automated scan could not complete after several attempts. Use the county portal links below, or reply to this email and we will pull the records manually.',
        ],
        portalLinks: [
          { label: 'Florida county officials directory', url: 'https://floridarevenue.com/property/Pages/LocalOfficials.aspx' },
        ],
        source: 'scan failed',
      };
      try {
        const { subject, html, text } = buildEmail(fallback, job.address);
        await sendEmail(job.email, subject, html, text);
        await markEmailed(job.id);
      } catch (mailErr: any) {
        console.error(`[worker] fallback email failed for ${job.id}: ${mailErr?.message ?? mailErr}`);
      }
    }
  }
  return true;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required.');
  }
  const browser = await chromium.launch({ headless: HEADLESS, args: ['--no-sandbox'] });
  console.log(`[worker] started (headless=${HEADLESS}); polling every ${POLL}ms`);

  let stop = false;
  const shutdown = () => {
    console.log('[worker] shutdown signal received; finishing current loop…');
    stop = true;
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  while (!stop) {
    let worked = false;
    try {
      worked = await processOne(browser);
    } catch (e: any) {
      console.error('[worker] loop error:', e?.message ?? e);
    }
    if (!worked) await new Promise((r) => setTimeout(r, POLL));
  }

  await browser.close().catch(() => {});
  process.exit(0);
}

main().catch((e) => {
  console.error('[worker] fatal:', e);
  process.exit(1);
});
