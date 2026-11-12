// On-demand code-case lookup for the Risk Map app (Homestead Finder repo, riskmap/app.py).
//
//   npx tsx src/riskmap-cases.ts "<address>" [MUNICIPALITY]
//
// Prints ONE JSON object to stdout and nothing else there. Runs the same EnerGov adapter the
// deep-scan worker uses, against the city's own portal, for one address. Code cases only: the
// adapter does not search the permit module yet, and the JSON says so explicitly rather than
// reporting an empty permit list as "no permits".
import { chromium } from 'playwright';
import { runEnergovScrape } from './scrapers/energov.js';
import { CITY_JURISDICTIONS, type EnergovJurisdiction } from './scrapers/jurisdictions.js';
import type { ScraperCtx } from './scrapers/types.js';

async function main() {
  const address = process.argv[2];
  const municipality = (process.argv[3] ?? 'HIALEAH').toUpperCase();
  const out = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n');
  if (!address) return out({ ok: false, error: 'address required' });
  const j = CITY_JURISDICTIONS[`miami-dade:${municipality}`] as EnergovJurisdiction | undefined;
  if (!j || j.platform !== 'energov') return out({ ok: false, error: `no EnerGov adapter for ${municipality}` });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      viewport: { width: 1366, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const log: string[] = [];
    const ctx: ScraperCtx = { page, address, folio: null, lat: null, lng: null, municipality, log: (m) => log.push(m) };
    const t0 = Date.now();
    const r = await runEnergovScrape(ctx, j);
    out({
      ok: r.ok,
      source: r.source,
      municipality,
      address,
      violations: r.violations,
      violationsChecked: r.violationsChecked ?? r.ok,
      permitsChecked: false,
      permitsNote: 'EnerGov permit module not searched by this adapter yet; code cases only.',
      notes: r.notes,
      portalLinks: r.portalLinks,
      log,
      secs: Math.round((Date.now() - t0) / 100) / 10,
    });
  } catch (e: any) {
    out({ ok: false, error: String(e?.message ?? e).slice(0, 300) });
  } finally {
    await browser.close();
  }
}
main();
