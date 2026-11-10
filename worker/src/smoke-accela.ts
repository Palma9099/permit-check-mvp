// Live smoke for the Accela adapter.
//
//   npx tsx src/smoke-accela.ts
//
// Tampa is the probe because its records were read by hand first, so there is
// a known-good answer to measure against rather than only "it did not throw".
import { chromium } from 'playwright';
import { runAccelaScrape, streetNameOf, streetNumberOf } from './scrapers/accela.js';
import { JURISDICTIONS, CITY_JURISDICTIONS, ACCELA_CITY_POPULATION, resolveJurisdiction, type AccelaJurisdiction } from './scrapers/jurisdictions.js';
import { codeRecordTypes, hasCodeTypes, parseResultCount, partialListNote } from './scrapers/accela-parse.js';
import type { ScraperCtx } from './scrapers/types.js';
import { appendFileSync, writeFileSync } from 'node:fs';

// Optional transcript path. Written from inside the program rather than
// captured from stdout: an EnerGov verification run was backgrounded mid-run
// and lost its first eight lines with the pipe, which cost a review round and
// nearly shipped two cities on evidence that did not exist.
const OUT = process.argv[2];
if (OUT) writeFileSync(OUT, `# Accela adapter verification, started ${new Date().toISOString()}\n`);
const say = (line: string) => {
  if (OUT) appendFileSync(OUT, line + '\n');
  console.log(line);
};

let fails = 0;
let checks = 0;
const ck = (n: string, c: boolean, d = '') => {
  checks++;
  say(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`);
  if (!c) fails++;
};

async function main() {
  say('--- offline ---');
  ck('the 8 Accela cities total 897,135', ACCELA_CITY_POPULATION === 897135, String(ACCELA_CITY_POPULATION));
  ck('Tampa routes from its municipality', resolveJurisdiction('hillsborough', 'TAMPA')?.platform === 'accela');
  ck('Longboat Key routes from BOTH its counties',
     !!CITY_JURISDICTIONS['manatee:LONGBOAT KEY'] && !!CITY_JURISDICTIONS['sarasota:LONGBOAT KEY']);
  ck('Broward keeps its own Posse adapter, not a generic Accela one',
     JURISDICTIONS['broward']?.platform === 'broward-bcs');
  ck('Palm Beach keeps ePZB', JURISDICTIONS['palm-beach']?.platform === 'pbc-epzb');
  ck('an unreadable type list is unknown, not empty', hasCodeTypes(null) === null);
  ck('an empty type list is a real no', hasCodeTypes([]) === false);
  ck('code types are picked out of a mixed list',
     codeRecordTypes(['Building Permit', 'Code Case', 'Roofing']).length === 1);

  say('\n--- the capped count, which is this portal\'s hard part ---');
  const capped = parseResultCount('100+ Record results matching your search Showing 1-10 of 100+');
  ck('a cap is read as a cap, not a total', capped.capped === true && capped.total === null, `shown=${capped.shown}`);
  ck('a capped list always warns', !!partialListNote(10, capped, 'City of Tampa'));
  const exact = parseResultCount('Showing 1-3 of 3');
  ck('an exact total is read exactly', exact.total === 3 && exact.capped === false);
  ck('a complete exact list does not warn', partialListNote(3, exact, 'X') === null);
  ck('an incomplete exact list warns', !!partialListNote(10, parseResultCount('Showing 1-10 of 42'), 'X'));

  say('\n--- address parsing ---');
  ck('street name drops number, direction and type', streetNameOf('1234 N FLORIDA AVE') === 'FLORIDA');
  ck('street number is taken', streetNumberOf('1234 N FLORIDA AVE') === '1234');
  ck('a bare street still parses', streetNameOf('FLORIDA AVE') === 'FLORIDA');

  say('\n--- LIVE Tampa ---');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  try {
    const j = resolveJurisdiction('hillsborough', 'TAMPA') as AccelaJurisdiction;
    const ctx: ScraperCtx = { page, address: 'N FLORIDA AVE', folio: null, lat: null, lng: null, municipality: 'TAMPA', log: (m) => console.log('      ' + m) };
    const r = await runAccelaScrape(ctx, j);
    ck('live scrape reports ok', r.ok === true);
    ck('records come back', r.violations.length > 0, `(${r.violations.length})`);
    ck('a record carries its number', r.violations.some((v) => /^[A-Z]{2,4}-\d{2}-\d+/.test(v.caseNumber ?? '')));
    ck('an open record is flagged open', r.violations.some((v) => /still open/i.test(v.lastAction ?? '')));
    ck('the capped list is disclosed', r.notes.some((n) => /NOT the property's full history|do not read this list as complete/i.test(n)));
    ck('citywide, not unincorporated', r.notes.some((n) => /whole city/i.test(n)));
    ck('no fine amount is invented', !JSON.stringify(r.violations).match(/\$\s*[\d,]+/));
    ck('the amount caveat is stated', r.notes.some((n) => /not the amount of any fine or lien/i.test(n)));
    say('\n  first records:');
    for (const v of r.violations.slice(0, 4)) {
      say(`    ${v.caseNumber} | ${v.status} | ${(v.description ?? '').slice(0, 54)}`);
    }
    say('\n  notes:');
    for (const n of r.notes) say(`    - ${n.slice(0, 150)}`);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  // Print the count beside the verdict so a truncated transcript is visibly
  // truncated rather than silently so.
  say(`\nchecks run: ${checks}  failed: ${fails}`);
  say(`${fails === 0 ? 'ALL CHECKS PASSED' : `${fails} CHECK(S) FAILED`}`);
  if (OUT) appendFileSync(OUT, `# complete, ${new Date().toISOString()}\n`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
