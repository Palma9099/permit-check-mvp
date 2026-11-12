// Phase 0, readability half: can the COUNTY adapters actually read code cases?
//
// The registry routes 12 counties. Their unincorporated populations total
// 4,372,181, which is more than double the 2,049,410 the 36 city tenants
// reach. None of that counts until a run shows the adapter reading the portal.
//
// Two separate questions, kept separate on purpose:
//
//   RETURNS        the run produced at least one case
//   READABLE_EMPTY the adapter completed and the portal held nothing on the
//                  probed streets. Readable, just unproven.
//   NEEDS_KEY      the tenant searches by parcel key, not street, and no key
//                  was supplied. Not a defect, not evidence either.
//   FAILED         the adapter could not complete the read.
//
// `ok` from the adapter is the signal, NOT the request counter. The counter
// only sees Accela's ASP.NET POSTs: citizenserve returned six real cases with
// zero counted requests, so treating zero as "nothing left the browser" is
// wrong everywhere but Accela. It is kept as a detail on Accela failures,
// where it still separates "the form bounced" from the Duval shape.
//
// A county with READABLE but no records on the probed street is not a failure,
// it is an unproven tenant: try another street. A county that is not READABLE
// is a dead end until something changes.
//
//   npx tsx src/phase0-county-probe.ts [transcript-path] [county-key ...]

import { chromium, type Browser } from 'playwright';
import { JURISDICTIONS } from './scrapers/jurisdictions.js';
import { runAccelaScrape } from './scrapers/accela.js';
import { runPbcScrape } from './scrapers/pbc.js';
import { runBrowardScrape } from './scrapers/broward.js';
import { runCitizenserveScrape } from './scrapers/citizenserve.js';
import { runEnergovScrape } from './scrapers/energov.js';
import { runPortalScrape } from './scrapers/generic.js';
import type { ScraperCtx } from './scrapers/types.js';
import { appendFileSync, writeFileSync } from 'node:fs';

// Written from inside the program: a backgrounded EnerGov run once lost its
// first lines to a pipe and nearly shipped cities on evidence that did not
// exist.
const OUT = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : null;
if (OUT) writeFileSync(OUT, `# Phase 0 county probe, started ${new Date().toISOString()}\n`);
const say = (l: string) => { if (OUT) appendFileSync(OUT, l + '\n'); console.log(l); };

// Common street names, tried in order. A county-wide portal covers a lot of
// ground, so a street this common having no case at all is itself a signal.
// Streets chosen to actually EXIST in unincorporated territory, not just to be
// common words. Brandon, Riverview and Lutz are unincorporated Hillsborough;
// a county code portal that holds anything holds something on these.
/**
 * Parcel keys for the tenants that search by key, not by street.
 *
 * Palm Beach ePZB is PCN-keyed and its code field rejects bare digits, so the
 * dashed form goes to both of its searches. Broward BCS is folio-keyed.
 * A street probe against either of these measures nothing, so without a key
 * they are reported UNPROBED rather than failing and looking like a defect.
 */
const PARCEL_KEYS: Record<string, string> = {
  'palm-beach': '00-41-43-10-00-000-4180',
};

const STREETS = ['BLOOMINGDALE', 'GIBSONTON', 'MAIN', 'OAK'];

const only = process.argv.slice(3).filter((a) => !a.startsWith('-'));

async function probeTenant(browser: Browser, key: string, j: any) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(90000);

  // Did a search request actually leave the browser? This is the Duval test.
  let searchRequests = 0;
  page.on('request', (r) => {
    const u = r.url();
    if (/Cap\/|CapHome|Search|result/i.test(u) && r.method() === 'POST') searchRequests++;
  });

  let lastWhy: string | undefined;
  let sawOk = false;
  try {
    for (const street of STREETS) {
      const ctx: ScraperCtx = {
        page, address: `${street} ST`, folio: PARCEL_KEYS[key] ?? null, lat: null, lng: null,
        municipality: null,
        // Pass the adapter's own log through when diagnosing. Swallowing it
        // once already cost a run: the probe reported "unreadable" while the
        // adapter was saying exactly where it stopped.
        log: process.env.CALIBRATE === '1' ? (m: string) => say('      ' + m) : () => {},
      };
      const run =
        j.platform === 'accela'
          ? runAccelaScrape(ctx, j)
          : j.platform === 'pbc-epzb'
            ? runPbcScrape(ctx, j)
            : j.platform === 'broward-bcs'
              ? runBrowardScrape(ctx, j)
              : j.platform === 'energov'
                ? runEnergovScrape(ctx, j)
                : j.platform === 'citizenserve'
                  ? runCitizenserveScrape(ctx, j)
                  : runPortalScrape(ctx, (j as any).config);
      const r = await run.catch((e) => ({ ok: false, violations: [], notes: [String(e).slice(0, 140)] } as any));
      const n = r.violations?.length ?? 0;
      say(`  ${key} / ${street}: ok=${r.ok} records=${n} searchPOSTs=${searchRequests}`);
      if (r.ok && n > 0) {
        say(`    sample: ${r.violations.slice(0, 2).map((v: any) => `${v.caseNumber} | ${(v.description ?? '').slice(0, 40)}`).join(' // ')}`);
        return { key, state: 'RETURNS', street, records: n };
      }
      sawOk = sawOk || r.ok === true;
      // The adapter says plainly when it wants a parcel key. Believe it rather
      // than reporting a street probe against a key-keyed portal as a failure.
      if ((r.notes ?? []).some((t: string) => /keyed by parcel|re-run with it|look the folio up/i.test(t))) {
        return { key, state: 'NEEDS_KEY', street: null, records: 0, why: (r.notes ?? [])[0] };
      }
      // Three states, not two. A search that FIRED and came back unparseable
      // is an adapter problem, which is fixable and worth a million residents
      // here. A search that fired zero requests is a shut portal. Collapsing
      // them loses exactly the distinction worth knowing.
      lastWhy = (r.notes ?? [])[0];
    }
    if (sawOk) return { key, state: 'READABLE_EMPTY', street: null, records: 0 };
    return {
      key,
      state: j.platform === 'accela' && searchRequests > 0 ? 'RAN_UNPARSED' : 'FAILED',
      street: null, records: 0, why: lastWhy,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  const keys = only.length ? only : Object.keys(JURISDICTIONS);
  say(`probing ${keys.length} county tenant(s): ${keys.join(', ')}\n`);
  const browser = await chromium.launch({ headless: true });
  const results: any[] = [];
  try {
    for (const key of keys) {
      const j = (JURISDICTIONS as any)[key];
      say(`${key} (${j.name}, platform ${j.platform}${j.tenant?.agency ? `, agency ${j.tenant.agency}` : ''}${j.tenant?.module ? `, module ${j.tenant.module}` : ''})`);
      results.push(await probeTenant(browser, key, j));
      say('');
    }
  } finally {
    await browser.close().catch(() => {});
  }

  say('--- verdict ---');
  say('RETURNS        = produced cases');
  say('READABLE_EMPTY = adapter completed, portal held nothing on these streets');
  say('NEEDS_KEY      = searches by parcel key; no key supplied, so not evidence');
  say('RAN_UNPARSED   = Accela only: the form came back instead of results (fixable)');
  say('FAILED         = the adapter could not complete the read');
  for (const r of results) {
    say(`${r.key.padEnd(14)} ${String(r.state).padEnd(13)} ${r.street ?? '-'} ${r.records || ''} ${r.why ?? ''}`);
  }
  if (OUT) appendFileSync(OUT, `# complete, ${new Date().toISOString()}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
