// Live smoke test for the citizenserve adapter.
//
//   npx tsx src/smoke-citizenserve.ts ["<address>"]
//
// Hits the real Alachua County portal, so it needs network. The pure parsers
// are covered offline in tests/citizenserve-adapter.test.ts.

import { chromium } from 'playwright';
import { runCitizenserveScrape, fileTypesFrom, hasCode } from './scrapers/citizenserve.js';
import { JURISDICTIONS, CITIZENSERVE_NO_CODE, type CitizenserveJurisdiction } from './scrapers/jurisdictions.js';
import type { ScraperCtx } from './scrapers/types.js';

// An Alachua County address with a known open "Work without Permit" case
// (file 23-013194, opened 02/20/2023).
const DEFAULT_ADDRESS = '100 SW 122ND ST';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures++;
}

async function main() {
  console.log('--- offline checks ---');
  check('file types parse out of HTML', JSON.stringify(fileTypesFrom('<option value="Permit"><option value="Code">')) === '["Permit","Code"]');
  check('hasCode is false without Code', !hasCode(['Permit', 'Development']));

  const alachua = JURISDICTIONS['alachua'] as CitizenserveJurisdiction;
  check('Alachua registered on citizenserve', alachua?.platform === 'citizenserve');
  check('Alachua is a county agency', alachua?.agency.kind === 'county');

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
    log: (m) => console.log(`      ${m}`),
  });

  try {
    console.log('\n--- a tenant with no Code module must refuse, not search ---');
    const walton = {
      platform: 'citizenserve' as const,
      county: 'walton',
      name: 'Walton County',
      agency: CITIZENSERVE_NO_CODE.find((a) => a.installationID === 245)!,
      portalLinks: [{ label: 'portal', url: 'https://example.invalid' }],
      source: 'test',
    };
    const w = await runCitizenserveScrape(mk(DEFAULT_ADDRESS), walton);
    check('no-Code tenant does not claim ok', w.ok === false);
    check('no-Code tenant says nothing was checked', w.notes.some((n) => /checked nothing here/i.test(n)));
    check('no-Code tenant names what it does offer', w.notes.some((n) => /Development/i.test(n)));

    console.log('\n--- no address must refuse, not search ---');
    const noAddr = await runCitizenserveScrape(mk(null), alachua);
    check('missing address does not claim ok', noAddr.ok === false);
    check('missing address says nothing was checked', noAddr.notes.some((n) => /nothing was checked/i.test(n)));

    const address = process.argv[2] ?? DEFAULT_ADDRESS;
    console.log(`\n--- LIVE Alachua County: "${address}" ---`);
    const t0 = Date.now();
    const r = await runCitizenserveScrape(mk(address), alachua);
    console.log(`      (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

    check('live scrape reports ok', r.ok === true);
    check('case found', r.violations.length > 0, `(${r.violations.length})`);
    check(
      'the case carries its inspector narrative',
      r.violations.some((v) => (v.details ?? '').length > 20),
    );
    check('the case carries an opened date', r.violations.some((v) => !!v.openedDate));
    check(
      'unincorporated caveat is stated',
      r.notes.some((n) => /unincorporated/i.test(n)),
    );
    check(
      'no fine or lien amount is invented',
      !JSON.stringify(r.violations).match(/\$\s*[\d,]+/),
    );

    console.log('\n--- LIVE: an address with no cases must read as zero, not as broken ---');
    const empty = await runCitizenserveScrape(mk('99999 NOWHERE RD'), alachua);
    check('a clean address still reports ok', empty.ok === true);
    check('a clean address returns no cases', empty.violations.length === 0);
    check(
      'a clean address still carries the unincorporated caveat',
      empty.notes.some((n) => /unincorporated/i.test(n)),
    );

    console.log('\n  cases:');
    for (const v of r.violations.slice(0, 5)) {
      console.log(`    ${v.caseNumber ?? '(no file#)'} | ${v.status} | ${v.openedDate ?? '-'} | ${(v.description ?? '').slice(0, 60)}`);
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
