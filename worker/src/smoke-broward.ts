// Live smoke test for the Broward County BCS (Posse) adapter.
//
//   npx tsx src/smoke-broward.ts [12-digit folio] [lat] [lng]
//
// Hits the real county portal and the county's ArcGIS municipality layer, so it
// needs network. The point is to prove the selectors and the deep links still
// match the live pages; the pure parsers are covered offline in
// tests/broward-adapter.test.ts.

import { chromium } from 'playwright';
import { runBrowardScrape, parcelKeyFor } from './scrapers/broward.js';
import { JURISDICTIONS, type BrowardJurisdiction } from './scrapers/jurisdictions.js';
import type { ScraperCtx } from './scrapers/types.js';

// 1455 SW 49 TER, Broadview Park: unincorporated (BMSD), ten code cases back to
// 2010 including one Lien Recorded with a CR number, plus a 2006 permit.
const DEFAULT_FOLIO = '504113111610';
const DEFAULT_LAT = 26.103246537564626;
const DEFAULT_LNG = -80.21484455406123;

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures++;
}

async function main() {
  console.log('--- offline checks ---');
  check('12 digits route to the Parcel ID field', parcelKeyFor('504113111610')?.kind === 'parcelId');
  check('10 digits route to the Folio field, dashed', parcelKeyFor('0113111610')?.value === '0113-11-1610');
  check('a Palm Beach PCN is refused', parcelKeyFor('00414310000004180') === null);

  const j = JURISDICTIONS['broward'] as BrowardJurisdiction;
  check('registry is on broward-bcs', j.platform === 'broward-bcs', `(got ${j.platform})`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const mk = (folio: string | null, lat?: number, lng?: number): ScraperCtx => ({
    page,
    address: null,
    folio,
    lat: lat ?? null,
    lng: lng ?? null,
    log: (m) => console.log(`      ${m}`),
  });

  try {
    console.log('\n--- bad folio must ask for one, not search ---');
    const bad = await runBrowardScrape(mk('00414310000004180'), j);
    check('bad folio does not claim ok', bad.ok === false);
    check('bad folio asks for a Broward folio', bad.notes.some((n) => /not a Broward parcel number/i.test(n)));

    const folio = process.argv[2] ?? DEFAULT_FOLIO;
    const lat = Number(process.argv[3] ?? DEFAULT_LAT);
    const lng = Number(process.argv[4] ?? DEFAULT_LNG);

    console.log(`\n--- LIVE unincorporated: ${folio} ---`);
    const t0 = Date.now();
    const r = await runBrowardScrape(mk(folio, lat, lng), j);
    console.log(`      (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

    check('live scrape reports ok', r.ok === true);
    check('code cases found', r.violations.length > 0, `(${r.violations.length})`);
    check('permits read', r.permits.length > 0, `(${r.permits.length})`);
    check(
      'the recorded lien carries its CR number',
      r.violations.some((v) => /Broward Official Records CR \d+/.test(v.lastAction ?? '')),
    );
    check('at least one case carries the cited section', r.violations.some((v) => (v.codes?.length ?? 0) > 0));
    check('at least one case carries an opened date', r.violations.some((v) => !!v.openedDate));
    check(
      'authority resolved to the county, not a postal city',
      r.notes.some((n) => /unincorporated Broward \(BMSD\)/i.test(n)),
    );
    check(
      'no "mmm dd, yyyy" placeholder leaked through as a date',
      !r.permits.some((p) => /m{2,3}\s*d{1,2}/i.test(p.issuedDate ?? '')),
    );

    console.log('\n--- LIVE city parcel: the county is NOT the authority ---');
    // Fort Lauderdale City Hall's point, with the same folio: the parcel search
    // still runs, but the note must say the city is the code authority.
    const city = await runBrowardScrape(mk(folio, 26.1224, -80.1434), j);
    check(
      'a city parcel is told the county is not the authority',
      city.notes.some((n) => /is the code authority for this parcel, not Broward County/i.test(n)),
    );
    check('the city is named', city.notes.some((n) => /FORT LAUDERDALE/i.test(n)));

    console.log('\n--- LIVE unknown point: must not imply clean ---');
    const unknown = await runBrowardScrape(mk(folio), j);
    check(
      'an unresolved authority is reported as unchecked, not clear',
      unknown.notes.some((n) => /unchecked rather than clear/i.test(n)),
    );

    console.log('\n  permits:');
    for (const p of r.permits.slice(0, 5)) {
      console.log(`    ${p.permitNumber} | ${p.status} | ${p.issuedDate ?? '-'} | ${p.description}`);
    }
    console.log('\n  code cases:');
    for (const v of r.violations.slice(0, 6)) {
      console.log(`    ${v.caseNumber} | ${v.status} | ${v.openedDate ?? '-'} | ${(v.description ?? '').slice(0, 55)}`);
      if (v.lastAction) console.log(`        ${v.lastAction}`);
      for (const c of v.codes ?? []) console.log(`        ${c}`);
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
