// Live smoke test for the Palm Beach ePZB adapter.
//
//   npx tsx src/smoke-pbc.ts [PCN]
//
// Hits the real county portal, so it needs network and it is slow on purpose.
// Nothing here is a unit test: the point is to prove the selectors still match
// the live pages. The offline cases (PCN parsing, the municipal refusal) run
// first and cost nothing.

import { chromium } from 'playwright';
import { runPbcScrape, normalizePcn, isUnincorporatedPcn } from './scrapers/pbc.js';
import { JURISDICTIONS, type PbcJurisdiction } from './scrapers/jurisdictions.js';
import type { ScraperCtx } from './scrapers/types.js';

// A parcel in unincorporated Loxahatchee with a known Fine-status code case
// (C-2023-07120016) and a long permit history including a renewal.
const DEFAULT_PCN = '00-41-43-10-00-000-4180';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures++;
}

async function main() {
  console.log('--- offline checks ---');
  check('17 digits normalize to dashed', normalizePcn('00414310000004180') === DEFAULT_PCN);
  check('already-dashed PCN survives', normalizePcn(DEFAULT_PCN) === DEFAULT_PCN);
  check('12-digit Broward folio rejected', normalizePcn('504113111610') === null);
  check('empty folio rejected', normalizePcn(null) === null);
  check('00-prefix is unincorporated', isUnincorporatedPcn(DEFAULT_PCN));
  check('06-prefix is municipal', !isUnincorporatedPcn('06-42-47-30-01-000-0010'));

  const j = JURISDICTIONS['palm-beach'] as PbcJurisdiction;
  check('registry is on pbc-epzb', j.platform === 'pbc-epzb', `(got ${j.platform})`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const mk = (folio: string | null): ScraperCtx => ({
    page,
    address: null,
    folio,
    log: (m) => console.log(`      ${m}`),
  });

  try {
    console.log('\n--- municipal PCN must refuse, not report empty ---');
    const muni = await runPbcScrape(mk('06-42-47-30-01-000-0010'), j);
    check('municipal PCN does not claim ok', muni.ok === false);
    check(
      'municipal PCN explains it is not clean',
      muni.notes.some((n) => /NOT the same as the property being clear/i.test(n)),
    );

    console.log('\n--- bad folio must ask for a PCN ---');
    const bad = await runPbcScrape(mk('504113111610'), j);
    check('bad folio does not claim ok', bad.ok === false);
    check('bad folio asks for a PCN', bad.notes.some((n) => /parcel control number|is not a Palm Beach/i.test(n)));

    const pcn = process.argv[2] ?? DEFAULT_PCN;
    console.log(`\n--- LIVE: ${pcn} ---`);
    const t0 = Date.now();
    const r = await runPbcScrape(mk(pcn), j);
    console.log(`      (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

    check('live scrape reports ok', r.ok === true);
    check('code cases found', r.violations.length > 0, `(${r.violations.length})`);
    // The county's building app refuses automated sessions. Either it let us in
    // and we read permits, or it did not and we said so in plain words - what we
    // must never do is return an empty permit list that reads as "all clear".
    const permitsGated = r.notes.some((n) => /Open permits were NOT checked/i.test(n));
    check(
      'permits either read or explicitly reported as unchecked',
      r.permits.length > 0 || permitsGated,
      permitsGated ? '(gated, reported)' : `(${r.permits.length} rows)`,
    );
    check(
      'never reports zero permits silently',
      !(r.permits.length === 0 && !permitsGated && !r.notes.some((n) => /Permit search/i.test(n))),
    );
    check(
      'at least one case carries cited code sections',
      r.violations.some((v) => (v.codes?.length ?? 0) > 0),
    );
    check(
      'at least one case carries the inspector narrative',
      r.violations.some((v) => !!v.details),
    );
    check('at least one case carries an opened date', r.violations.some((v) => !!v.openedDate));
    check(
      'free-tier caveat is stated',
      r.notes.some((n) => /does not publish the amount/i.test(n)),
    );
    check('no fabricated dollar figure', !r.violations.some((v) => /\$\s*[\d,]+/.test(v.details ?? '')));

    console.log('\n  permits:');
    for (const p of r.permits.slice(0, 6)) {
      console.log(`    ${p.permitNumber} | ${p.status} | ${p.balance ?? ''} | ${p.type}`);
    }
    console.log('\n  code cases:');
    for (const v of r.violations.slice(0, 6)) {
      console.log(`    ${v.caseNumber} | ${v.status} | ${(v.description ?? '').slice(0, 70)}`);
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
