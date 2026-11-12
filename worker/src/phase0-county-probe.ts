// Phase 0, readability half: can the COUNTY adapters actually read code cases?
//
// The registry routes 12 counties. Their unincorporated populations total
// 4,372,181, which is more than double the 2,049,410 the 36 city tenants
// reach. None of that counts until a run shows the adapter reading the portal.
//
// Two separate questions, kept separate on purpose:
//
//   READABLE  the search actually RAN and a result region came back. Duval is
//             why this is its own question: its grid renders, prints "No data
//             matching applied search" BEFORE any search runs, and clicking
//             search fires zero requests. That reads like a clean property.
//   RETURNS   the run produced at least one case, so the portal has data for
//             an anonymous visitor rather than an empty shell.
//
// A county with READABLE but no records on the probed street is not a failure,
// it is an unproven tenant: try another street. A county that is not READABLE
// is a dead end until something changes.
//
//   npx tsx src/phase0-county-probe.ts [transcript-path] [county-key ...]

import { chromium, type Browser } from 'playwright';
import { JURISDICTIONS } from './scrapers/jurisdictions.js';
import { runAccelaScrape } from './scrapers/accela.js';
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
const STREETS = ['BLOOMINGDALE', 'GIBSONTON', 'MAIN', 'OAK'];

const only = process.argv.slice(3).filter((a) => !a.startsWith('-'));

async function probeAccela(browser: Browser, key: string, j: any) {
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
  try {
    for (const street of STREETS) {
      const ctx: ScraperCtx = {
        page, address: `${street} ST`, folio: null, lat: null, lng: null,
        municipality: null,
        // Pass the adapter's own log through when diagnosing. Swallowing it
        // once already cost a run: the probe reported "unreadable" while the
        // adapter was saying exactly where it stopped.
        log: process.env.CALIBRATE === '1' ? (m: string) => say('      ' + m) : () => {},
      };
      const r = await runAccelaScrape(ctx, j).catch((e) => ({ ok: false, violations: [], notes: [String(e).slice(0, 120)] } as any));
      const n = r.violations?.length ?? 0;
      say(`  ${key} / ${street}: ok=${r.ok} records=${n} searchPOSTs=${searchRequests}`);
      if (r.ok && n > 0) {
        say(`    sample: ${r.violations.slice(0, 2).map((v: any) => `${v.caseNumber} | ${(v.description ?? '').slice(0, 40)}`).join(' // ')}`);
        return { key, state: 'RETURNS', street, records: n };
      }
      // Three states, not two. A search that FIRED and came back unparseable
      // is an adapter problem, which is fixable and worth a million residents
      // here. A search that fired zero requests is a shut portal. Collapsing
      // them loses exactly the distinction worth knowing.
      lastWhy = (r.notes ?? [])[0];
      if (!r.ok && searchRequests === 0) {
        return { key, state: 'NO_SEARCH', street, records: 0, why: lastWhy };
      }
    }
    return { key, state: searchRequests > 0 ? 'RAN_UNPARSED' : 'NO_SEARCH', street: null, records: 0, why: lastWhy };
  } finally {
    await context.close().catch(() => {});
  }
}

async function main() {
  const keys = (only.length ? only : Object.keys(JURISDICTIONS))
    .filter((k) => (JURISDICTIONS as any)[k]?.platform === 'accela');

  say(`probing ${keys.length} Accela county tenant(s): ${keys.join(', ')}\n`);
  const browser = await chromium.launch({ headless: true });
  const results: any[] = [];
  try {
    for (const key of keys) {
      const j = (JURISDICTIONS as any)[key];
      say(`${key} (${j.name}, agency ${j.tenant?.agency}, module ${j.tenant?.module})`);
      results.push(await probeAccela(browser, key, j));
      say('');
    }
  } finally {
    await browser.close().catch(() => {});
  }

  say('--- verdict ---');
  say('RETURNS      = search ran and produced cases');
  say('RAN_UNPARSED = search ran, portal answered, adapter could not read it (fixable)');
  say('NO_SEARCH    = nothing left the browser (the Duval shape)');
  for (const r of results) {
    say(`${r.key.padEnd(14)} ${String(r.state).padEnd(13)} ${r.street ?? '-'} ${r.records || ''} ${r.why ?? ''}`);
  }
  if (OUT) appendFileSync(OUT, `# complete, ${new Date().toISOString()}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
