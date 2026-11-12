// On-demand code-case lookup for the Risk Map app (Homestead Finder repo, riskmap/app.py).
//
//   npx tsx src/riskmap-cases.ts "<address>" [MUNICIPALITY]
//
// Prints ONE JSON object to stdout and nothing else there. Runs the same EnerGov adapter the
// deep-scan worker uses, against the city's own portal, for one address (code cases), then runs
// a second search on the same page in the Permit module (2) and reads the portal's own XHR
// answer. permitsChecked is true only when that answer parsed and carried a PermitsFound count;
// anything else is reported as not checked, never as "no permits".
import { chromium, type Page } from 'playwright';
import { runEnergovScrape } from './scrapers/energov.js';
import { CITY_JURISDICTIONS, type EnergovJurisdiction } from './scrapers/jurisdictions.js';
import type { ScraperCtx } from './scrapers/types.js';

const SEARCH_API = /\/api\/energov\/search\/search\b/i;
const PERMIT_MODULE = 2;

interface PermitRow {
  number: string | null; type: string | null; status: string | null;
  applied: string | null; issued: string | null; finaled: string | null; expires: string | null;
  description: string | null; address: string | null; parcel: string | null;
}
const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const day = (v: unknown) => { const s = str(v); if (!s) return null; const m = s.match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : s; };

/** One permit-module search on the already-open search page; up to three tries like the adapter. */
async function searchPermits(page: Page, address: string, log: (m: string) => void) {
  const needle = address.replace(/\s+/g, ' ').trim().toLowerCase();
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.selectOption('#SearchModule', { value: `number:${PERMIT_MODULE}` }).catch(async () => {
      await page.selectOption('#SearchModule', String(PERMIT_MODULE)).catch(() => {});
    });
    await page.fill('#SearchKeyword', address, { timeout: 10000 });
    await page.keyboard.press('Escape').catch(() => {});
    const answer = page.waitForResponse((r) => {
      if (!SEARCH_API.test(r.url()) || r.request().method() !== 'POST') return false;
      return (r.request().postData() ?? '').toLowerCase().includes(needle);
    }, { timeout: 30000 }).catch(() => null);
    const button = page.locator('#button-Search');
    if (await button.count()) await button.click({ timeout: 10000 }).catch(() => {});
    else await page.locator('button:has-text("Search")').last().click({ timeout: 10000 }).catch(() => {});
    const res = await answer;
    if (!res) { log('permits: the portal never ran our search'); return { checked: false, permits: [], reported: null, rawKeys: [] as string[] }; }
    const raw = await res.text().catch(() => '');
    let body: any = null; try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    const r = body?.Result;
    if (!r || body?.Success !== true) { log(`permits: attempt ${attempt} answered Success:false, retrying`); await page.waitForTimeout(1500 * attempt); continue; }
    if (!Array.isArray(r.EntityResults)) { log('permits: response had no EntityResults array'); return { checked: false, permits: [], reported: null, rawKeys: [] as string[] }; }
    const reported = Number(r.PermitsFound);
    if (!Number.isFinite(reported)) { log('permits: PermitsFound missing, not trusting the answer'); return { checked: false, permits: [], reported: null, rawKeys: [] as string[] }; }
    const rows: any[] = r.EntityResults.filter((x: any) => Number(x?.ModuleName) === PERMIT_MODULE);
    const permits: PermitRow[] = rows.map((x) => ({
      number: str(x.CaseNumber), type: str(x.CaseType), status: str(x.CaseStatus),
      applied: day(x.ApplyDate), issued: day(x.IssueDate), finaled: day(x.FinalDate), expires: day(x.ExpireDate),
      description: str(x.Description), address: str(x.AddressDisplay) ?? str(x.Address?.FullAddress), parcel: str(x.MainParcel),
    }));
    log(`permits: ${permits.length} row(s) read, portal reported ${reported}`);
    return { checked: true, permits, reported, rawKeys: rows.length ? Object.keys(rows[0]) : [] };
  }
  log('permits: the portal refused the search on every attempt');
  return { checked: false, permits: [], reported: null, rawKeys: [] as string[] };
}

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
    const p = await searchPermits(page, address, (m) => log.push(m)).catch((e: any) => {
      log.push(`permits: ${String(e?.message ?? e).slice(0, 200)}`);
      return { checked: false, permits: [], reported: null as number | null, rawKeys: [] as string[] };
    });
    const truncated = p.checked && p.reported !== null && p.reported > p.permits.length;
    out({
      ok: r.ok,
      source: r.source,
      municipality,
      address,
      violations: r.violations,
      violationsChecked: r.violationsChecked ?? r.ok,
      permits: p.permits,
      permitsChecked: p.checked,
      permitsReported: p.reported,
      permitsNote: !p.checked
        ? 'EnerGov permit search did not run or did not parse; permits NOT checked.'
        : truncated
          ? `Portal reported ${p.reported} permits, first ${p.permits.length} read (one page).`
          : `EnerGov permit module searched; ${p.permits.length} permit(s) for this address.`,
      permitRawKeys: p.rawKeys,
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
