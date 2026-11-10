// Which of the discovered EnerGov tenants can this product actually use?
//
// A hostname answering is not coverage. Two separate traps have to be cleared,
// and both have already produced a wrong claim today:
//
//   1. Module 5 (Code Case) is per-tenant configuration. Hialeah has it on,
//      St Lucie County has it removed. Assuming it exists means searching
//      nothing and reporting a clean property.
//   2. A read of the module list that runs before Angular populates it returns
//      an EMPTY list, which looks exactly like a tenant with no modules. That
//      false negative nearly wrote off seven cities and 675,709 people.
//
// So this runs the PRODUCTION adapter, runEnergovScrape, against a real street
// in each tenant. Not a probe, not a lookalike: three reimplementations earlier
// today each reported a failed read as a finding, and the adapter is the only
// thing whose answer is worth recording.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { runEnergovScrape } from './scrapers/energov.js';
import type { EnergovJurisdiction } from './scrapers/jurisdictions.js';
import type { ScraperCtx } from './scrapers/types.js';
import type { EnergovTenant } from './scrapers/energov-parse.js';

interface Hit { name: string; pop: number; url: string }

// A street that exists in each place. Kept beside the tenant so a zero result
// is a fact about the city, not about a made-up address.
const STREETS: Record<string, string> = {
  'Hialeah city': 'W 60 ST',
  'Pembroke Pines city': 'PINES BLVD',
  'Miramar city': 'MIRAMAR PKWY',
  'West Palm Beach city': 'CLEMATIS ST',
  'Miami Gardens city': 'NW 183 ST',
  'Boca Raton city': 'GLADES RD',
  'Deltona city': 'PROVIDENCE BLVD',
  'Doral city': 'NW 53 ST',
  'Wellington village': 'FOREST HILL BLVD',
  'Palm Beach Gardens city': 'PGA BLVD',
  'Coral Gables city': 'PONCE DE LEON BLVD',
  'Fort Pierce city': 'ORANGE AVE',
  'Oakland Park city': 'OAKLAND PARK BLVD',
  'Ormond Beach city': 'GRANADA BLVD',
  'Winter Springs city': 'TUSKAWILLA RD',
  'Riviera Beach city': 'BLUE HERON BLVD',
  'New Smyrna Beach city': 'CANAL ST',
  'Maitland city': 'MAITLAND AVE',
  'Zephyrhills city': 'GALL BLVD',
  'Marco Island city': 'COLLIER BLVD',
  'North Bay Village city': 'KENNEDY CAUSEWAY',
  'Neptune Beach city': 'ATLANTIC BLVD',
  'Sanibel city': 'PERIWINKLE WAY',
  'Marianna city': 'LAFAYETTE ST',
  'Surfside town': 'HARDING AVE',
  'South Pasadena city': 'PASADENA AVE',
};

function tenantFrom(h: Hit): EnergovTenant {
  const u = new URL(h.url);
  return {
    host: u.host,
    name: h.name.replace(/ (city|town|village)$/, ''),
    kind: 'city',
    // Claim nothing here. The live read decides, and the adapter refuses when
    // module 5 is genuinely absent.
    modules: [1, 2, 3, 4, 5, 6, 10, 11],
    basePath: u.pathname.replace(/\/$/, ''),
  };
}

async function main() {
  const hits: Hit[] = JSON.parse(readFileSync(new URL('./energov_hits.json', import.meta.url), 'utf8'));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);

  const usable: Array<Hit & { cases: number; host: string; basePath: string }> = [];
  const refused: Array<Hit & { why: string }> = [];

  for (const h of hits.sort((a, b) => b.pop - a.pop)) {
    const street = STREETS[h.name];
    if (!street) { refused.push({ ...h, why: 'no probe street listed' }); continue; }
    const t = tenantFrom(h);
    const j: EnergovJurisdiction = {
      platform: 'energov', county: 'verify', name: t.name, tenant: t,
      portalLinks: [{ label: 'portal', url: h.url }], source: 'verification',
    };
    const ctx: ScraperCtx = { page, address: street, folio: null, lat: null, lng: null, municipality: null, log: () => {} };
    let r;
    try {
      r = await runEnergovScrape(ctx, j);
    } catch (e: any) {
      refused.push({ ...h, why: 'threw: ' + String(e?.message ?? e).slice(0, 50) });
      continue;
    }
    if (r.ok) {
      usable.push({ ...h, cases: r.violations.length, host: t.host, basePath: t.basePath! });
      console.log(`USABLE   ${t.name.padEnd(22)} ${String(h.pop).padStart(8)}  "${street}" -> ${r.violations.length} case(s)`);
    } else {
      const why = r.notes[0]?.slice(0, 90) ?? 'refused, no note';
      refused.push({ ...h, why });
      console.log(`REFUSED  ${t.name.padEnd(22)} ${String(h.pop).padStart(8)}  ${why}`);
    }
  }

  await context.close().catch(() => {});
  await browser.close().catch(() => {});

  const uPop = usable.reduce((n, u) => n + u.pop, 0);
  const rPop = refused.reduce((n, u) => n + u.pop, 0);
  console.log(`\nUSABLE : ${usable.length} tenants, ${uPop.toLocaleString()} people`);
  console.log(`REFUSED: ${refused.length} tenants, ${rPop.toLocaleString()} people (NOT coverage, and not clear either)`);
  console.log('\nregistry rows for the usable ones:');
  for (const u of usable) {
    console.log(`  ${u.name.replace(/ (city|town|village)$/, '')} | ${u.host} | ${u.basePath}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
