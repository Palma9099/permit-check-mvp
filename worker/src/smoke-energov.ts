// Live smoke test for the Tyler EnerGov adapter.
//
//   npx tsx src/smoke-energov.ts ["<address>"]
//
// Hits Hialeah's real portal. The pure parsers are covered offline in
// tests/energov-adapter.test.ts.

import { chromium } from 'playwright';
import { runEnergovScrape } from './scrapers/energov.js';
import { CITY_JURISDICTIONS, ENERGOV_TENANTS, resolveJurisdiction, type EnergovJurisdiction } from './scrapers/jurisdictions.js';
import type { ScraperCtx } from './scrapers/types.js';

// The address that started all of this: reported "None open" by a county-only
// check while Hialeah held case BWOP-001873-2025 at status Lien.
const DEFAULT_ADDRESS = '135 W 60 ST';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures++;
}

async function main() {
  console.log('--- routing ---');
  const hialeah = resolveJurisdiction('miami-dade', 'HIALEAH');
  check('a known municipality routes to its own city portal', hialeah?.platform === 'energov');
  check('that city is Hialeah', (hialeah as EnergovJurisdiction)?.tenant.host.includes('hialeahfl'));
  const noMuni = resolveJurisdiction('miami-dade', null);
  check('no municipality falls back to the county, never a guess', noMuni?.platform !== 'energov');
  check('an unknown municipality also falls back', resolveJurisdiction('miami-dade', 'SWEETWATER')?.platform !== 'energov');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const mk = (address: string | null): ScraperCtx => ({
    page,
    address,
    folio: null,
    lat: null,
    lng: null,
    municipality: 'HIALEAH',
    log: (m) => console.log(`      ${m}`),
  });

  try {
    console.log('\n--- a tenant with Code Case switched off must refuse, not search ---');
    const stLucie: EnergovJurisdiction = {
      platform: 'energov',
      county: 'st-lucie',
      name: 'St Lucie County',
      tenant: ENERGOV_TENANTS['st-lucie'],
      portalLinks: [{ label: 'portal', url: 'https://example.invalid' }],
      source: 'test',
    };
    const sl = await runEnergovScrape(mk(DEFAULT_ADDRESS), stLucie);
    check('no-Code tenant does not claim ok', sl.ok === false);
    check('no-Code tenant says nothing was checked', sl.notes.some((n) => /checked nothing here/i.test(n)));

    console.log('\n--- no address must refuse, not search ---');
    const j = CITY_JURISDICTIONS['miami-dade:HIALEAH'] as EnergovJurisdiction;
    const noAddr = await runEnergovScrape(mk(null), j);
    check('missing address does not claim ok', noAddr.ok === false);

    const address = process.argv[2] ?? DEFAULT_ADDRESS;
    console.log(`\n--- LIVE Hialeah: "${address}" ---`);
    const t0 = Date.now();
    const r = await runEnergovScrape(mk(address), j);
    console.log(`      (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

    check('live scrape reports ok', r.ok === true);
    check('the missed violation is found', r.violations.length > 0, `(${r.violations.length})`);
    check(
      'it is the Building Without A Permit case',
      r.violations.some((v) => /Building Without A Permit/i.test(v.description ?? '')),
    );
    check('its lien status is surfaced', r.violations.some((v) => /lien/i.test(v.status ?? '')));
    check(
      'a lien is called out as attached to the property',
      r.violations.some((v) => /attached to the property/i.test(v.lastAction ?? '')),
    );
    check('the parcel came back', !!r.folio, `(${r.folio ?? '-'})`);
    check('no dollar amount is invented', !JSON.stringify(r.violations).match(/\$\s*[\d,]+/));
    check('the amount caveat is stated', r.notes.some((n) => /not the dollar amount/i.test(n)));
    check('a city tenant does not claim unincorporated coverage', !r.notes.some((n) => /unincorporated/i.test(n)));

    console.log('\n--- LIVE: an address with no cases must read as zero, not as broken ---');
    const empty = await runEnergovScrape(mk('99999 NOWHERE RD'), j);
    check('a clean address still reports ok', empty.ok === true);
    check('a clean address returns no cases', empty.violations.length === 0);

    console.log('\n  cases:');
    for (const v of r.violations.slice(0, 5)) {
      console.log(`    ${v.caseNumber} | ${v.status} | ${v.openedDate ?? '-'}`);
      console.log(`        ${(v.description ?? '').slice(0, 90)}`);
      if (v.lastAction) console.log(`        ${v.lastAction}`);
    }
    console.log('\n  notes:');
    for (const n of r.notes) console.log(`    - ${n}`);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
