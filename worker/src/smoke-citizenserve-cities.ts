// Live probe: do the seven newly routed citizenserve CITY tenants answer, and
// does each route from its municipality the way the worker will ask?
import { chromium } from 'playwright';
import { runCitizenserveScrape } from './scrapers/citizenserve.js';
import { CITY_JURISDICTIONS, resolveJurisdiction, CITIZENSERVE_CITY_POPULATION, type CitizenserveJurisdiction } from './scrapers/jurisdictions.js';
import type { ScraperCtx } from './scrapers/types.js';

// Titusville is deliberately absent: it offers the Code file type and no way
// to search it, so it lives in CITIZENSERVE_NO_CODE and is asserted separately
// below.
const CASES: Array<[string, string, string]> = [
  ['seminole', 'CASSELBERRY', 'SEMORAN BLVD'],
  ['pinellas', 'SEMINOLE', 'SEMINOLE BLVD'],
  ['broward', 'WEST PARK', 'SW 56 AVE'],
  ['lake', 'MONTVERDE', 'MONTVERDE DR'],
  ['manatee', 'BRADENTON BEACH', 'GULF DR'],
  ['monroe', 'KEY COLONY BEACH', 'OCEAN DR'],
];

let fails = 0;
const ck = (n: string, c: boolean, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`); if (!c) fails++; };

async function main() {
  console.log(`routed city population: ${CITIZENSERVE_CITY_POPULATION.toLocaleString()}`);
  ck('every routed city resolves', CASES.every(([c, m]) => !!CITY_JURISDICTIONS[`${c}:${m}`]));
  ck('City of Seminole routes via PINELLAS, not Seminole County',
     resolveJurisdiction('pinellas', 'SEMINOLE')?.platform === 'citizenserve');
  ck('a Seminole COUNTY address does not get the city tenant',
     resolveJurisdiction('seminole', null)?.platform !== 'citizenserve');
  ck('Titusville is NOT routed, because its Code search has no criteria fields',
     !CITY_JURISDICTIONS['brevard:TITUSVILLE']);
  ck('the routed population is the six we can read, not the seven listed',
     CITIZENSERVE_CITY_POPULATION === 66641, String(CITIZENSERVE_CITY_POPULATION));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  try {
    for (const [county, muni, probe] of CASES) {
      const j = CITY_JURISDICTIONS[`${county}:${muni}`] as CitizenserveJurisdiction;
      const ctx: ScraperCtx = { page, address: probe, folio: null, lat: null, lng: null, municipality: muni, log: () => {} };
      const r = await runCitizenserveScrape(ctx, j);
      const cityNote = r.notes.some((n) => /whole city/i.test(n));
      ck(`${j.name} answers`, r.ok === true, `cases=${r.violations.length}`);
      ck(`${j.name} says citywide, not unincorporated`, cityNote && !r.notes.some((n) => /unincorporated/i.test(n)));
      ck(`${j.name} never claims to have read permits`, r.permitsChecked === false);
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : `${fails} CHECK(S) FAILED`}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
