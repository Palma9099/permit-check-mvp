// Do the newly routed EnerGov cities resolve and answer?
//
// Routing first, offline: a city must reach its own tenant from the
// municipality the property appraiser reports, and an unwired city must still
// fall back to its county rather than being guessed at.
//
// Then live: run the production adapter against a real street in a sample of
// them. The full 22-city verification lives in the review evidence; this keeps
// a fast check in the repo.
import { chromium } from 'playwright';
import { runEnergovScrape } from './scrapers/energov.js';
import {
  CITY_JURISDICTIONS,
  ENERGOV_EXPANSION_POPULATION,
  resolveJurisdiction,
  type EnergovJurisdiction,
} from './scrapers/jurisdictions.js';
import { hasCodeModule } from './scrapers/energov-parse.js';
import type { ScraperCtx } from './scrapers/types.js';

let fails = 0;
const ck = (n: string, c: boolean, d = '') => {
  console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  ' + d : ''}`);
  if (!c) fails++;
};

// county, municipality, a real street there
const ROUTED: Array<[string, string, string]> = [
  ['broward', 'PEMBROKE PINES', 'PINES BLVD'],
  ['palm-beach', 'WEST PALM BEACH', 'CLEMATIS ST'],
  ['miami-dade', 'MIAMI GARDENS', 'NW 183 ST'],
  ['volusia', 'DELTONA', 'PROVIDENCE BLVD'],
  ['st-lucie', 'FORT PIERCE', 'ORANGE AVE'],
  ['pinellas', 'SOUTH PASADENA', 'PASADENA AVE'],
];

// Routed on two runs, then a third read its module list and reported no code
// module. Unstable is not usable, so it came out; see jurisdictions.ts.
const UNSTABLE: Array<[string, string]> = [['seminole', 'WINTER SPRINGS']];

async function main() {
  console.log(`EnerGov expansion population: ${ENERGOV_EXPANSION_POPULATION.toLocaleString()}`);
  ck('the expansion total is the 18 cities that hold up across runs', ENERGOV_EXPANSION_POPULATION === 1105177,
     String(ENERGOV_EXPANSION_POPULATION));

  console.log('\n--- routing, offline ---');
  for (const [county, muni] of ROUTED) {
    const j = resolveJurisdiction(county, muni) as EnergovJurisdiction | undefined;
    ck(`${muni} routes to its own EnerGov tenant`, j?.platform === 'energov');
    ck(`${muni} exposes Code Case`, !!j && hasCodeModule(j.tenant.modules));
    ck(`${muni} carries a property appraiser link`,
       !!j?.portalLinks.some((l) => /Property Appraiser/i.test(l.label)));
  }

  // The four tenants left out on purpose: a host that answers is not coverage,
  // and neither is a host that answers differently each time it is asked.
  for (const [county, muni] of [
    // Sanibel: two verification runs fourteen minutes apart disagreed, one
    // reading module 5 as absent and one reading the tenant as usable. An
    // unstable answer is not a usable one, so it stays out until runs agree.
    ...UNSTABLE,
    ['lee', 'SANIBEL'],
    ['collier', 'MARCO ISLAND'], // portal unreadable on the verification run
    ['duval', 'NEPTUNE BEACH'],
    ['jackson', 'MARIANNA'],
  ] as const) {
    ck(`${muni} is NOT routed (host answered, coverage did not)`,
       !CITY_JURISDICTIONS[`${county}:${muni}`]);
  }

  ck('an unwired city still falls back to its county',
     resolveJurisdiction('broward', 'SOME UNWIRED TOWN')?.platform !== 'energov');

  console.log('\n--- live ---');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  try {
    for (const [county, muni, street] of ROUTED) {
      const j = resolveJurisdiction(county, muni) as EnergovJurisdiction;
      const ctx: ScraperCtx = { page, address: street, folio: null, lat: null, lng: null, municipality: muni, log: () => {} };
      const r = await runEnergovScrape(ctx, j);
      ck(`${j.name} answers`, r.ok === true, `cases=${r.violations.length}`);
      ck(`${j.name} says citywide, not unincorporated`,
         !r.notes.some((n) => /unincorporated/i.test(n)));
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
