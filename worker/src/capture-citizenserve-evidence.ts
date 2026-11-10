// Capture the frozen portal evidence Codex asked for.
//
// Round 1 was blocked on evidence, correctly: the submission carried smoke-test
// SOURCE but no captured per-tenant forms, so the searchability, shard-health
// and provenance claims could not be checked from the frozen bundle.
//
// The first version of this script was WRONG and is worth recording as a
// warning. It read `select option` across the whole page, which swept in the
// nav dropdown's javascript: links; it called selectOption on the first
// `select`, which is that nav menu rather than the file-type control; and it
// counted every text input on the page, including the hidden login and
// registration modals that exist on every citizenserve page. It therefore
// reported Titusville as searchable, which is the opposite of what a human
// sees, and several working tenants as not. A probe that reports a sloppy read
// as a finding is the very defect this review cycle keeps catching, so it was
// thrown away rather than shipped.
//
// This version calls the adapter's own selection step and applies its own
// test, so what is captured is what the adapter will really do:
// #filetype must offer a Code option, and #address must become VISIBLE after
// choosing it. #address exists in the DOM from the start and stays hidden
// until the page's getSearchFieldsOnFileType() runs, so presence proves
// nothing and visibility is the discriminator.
import { chromium, type Page } from 'playwright';
import { writeFileSync } from 'node:fs';
import { CITY_JURISDICTIONS, JURISDICTIONS, type CitizenserveJurisdiction } from './scrapers/jurisdictions.js';
import { runCitizenserveScrape } from './scrapers/citizenserve.js';
import { DEFAULT_SHARD, searchUrlOn } from './scrapers/citizenserve-parse.js';

/** Built the same way the registry builds them, so the capture tests the real path. */
const csLinksForEvidence = (id: number) => [
  { label: 'Code case search (citizenserve portal)', url: searchUrlOn(DEFAULT_SHARD, id) },
];
import type { ScraperCtx } from './scrapers/types.js';

const OUT = process.argv[2]!;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SHARDS = ['www', 'www2', 'www3', 'www4', 'www5', 'www6', 'www7', 'www8'];

// A real street in each jurisdiction, because the only honest test of
// searchability is a search. "The fields rendered" is not the test: Titusville
// renders #address and #parcelNumber and then refuses the search.
const TENANTS: Array<{ label: string; id: number; kind: 'county' | 'city'; street: string; claim: string }> = [
  { label: 'Casselberry',      id: 221, kind: 'city',   street: 'SEMORAN BLVD',    claim: 'ROUTED city' },
  { label: 'Seminole (city)',  id: 441, kind: 'city',   street: 'SEMINOLE BLVD',   claim: 'ROUTED city' },
  { label: 'West Park',        id: 261, kind: 'city',   street: 'SW 56 AVE',       claim: 'ROUTED city' },
  { label: 'Montverde',        id: 401, kind: 'city',   street: 'MONTVERDE DR',    claim: 'ROUTED city' },
  { label: 'Bradenton Beach',  id: 237, kind: 'city',   street: 'GULF DR',         claim: 'ROUTED city' },
  { label: 'Key Colony Beach', id: 326, kind: 'city',   street: 'OCEAN DR',        claim: 'ROUTED city' },
  { label: 'Titusville',       id: 403, kind: 'city',   street: 'S WASHINGTON AVE', claim: 'REFUSED: wants additional criteria beyond an address' },
  { label: 'Eatonville',       id: 391, kind: 'city',   street: 'KENNEDY BLVD',    claim: 'REFUSED: search offers nothing' },
  { label: 'Alachua County',   id: 318, kind: 'county', street: '100 SW 122ND ST', claim: 'ROUTED county (unincorporated only)' },
  { label: 'Sumter County',    id: 445, kind: 'county', street: 'CR 466',          claim: 'ROUTED county (unincorporated only)' },
  { label: 'Franklin County',  id: 389, kind: 'county', street: 'HIGHWAY 98',      claim: 'ROUTED county (unincorporated only)' },
];

/** The file types #filetype offers, or null when the list never populated. */
async function fileTypes(page: Page): Promise<string[] | null> {
  const ok = await page
    .waitForFunction(() => {
      const el = document.querySelector('#filetype') as HTMLSelectElement | null;
      return !!el && el.options.length > 0;
    }, { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) return null;   // a failed read, NOT an empty list
  return page.$$eval('#filetype option', (o) =>
    o.map((x) => (x as HTMLOptionElement).value).filter((v) => v && v !== '-999'));
}

async function main() {
  const lines: string[] = [];
  const say = (s: string) => { lines.push(s); console.log(s); };

  say(`# citizenserve frozen evidence, captured ${new Date().toISOString()}`);
  say('');
  say('## 1. Shard health, measured now');
  say('A 200 is not health here: a sick shard serves a ~2.6 KB stub with HTTP 200');
  say('and no search form, which looks like success. Size plus form is the test.');
  say('');
  for (const sh of SHARDS) {
    const url = `https://${sh}.citizenserve.com/Portal/PortalController?Action=showSearchPage&ctzPagePrefix=Portal_&installationID=318`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual' });
      const body = await res.text();
      const form = /id="filetype"/i.test(body);
      say(`  ${sh.padEnd(6)} HTTP ${res.status}  ${String(body.length).padStart(7)} bytes  #filetype=${form ? 'yes' : 'NO '}  -> ${form && body.length > 50000 ? 'healthy' : 'stub/unusable'}`);
    } catch (e: any) {
      say(`  ${sh.padEnd(6)} network error: ${String(e?.message ?? e).slice(0, 50)}`);
    }
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(40000);

  say('');
  say('## 2. Per-tenant: does a real address search actually RUN?');
  say('This runs the production adapter against a real street in each');
  say('jurisdiction. Rendering criteria fields is NOT the test: Titusville');
  say('renders #address and #parcelNumber, accepts a street, and then returns');
  say('"Please enter additional search criteria" - it wants more than an');
  say('address, which is all this product has.');
  say('');

  for (const t of TENANTS) {
    const j: CitizenserveJurisdiction = {
      platform: 'citizenserve',
      county: 'evidence',
      name: t.label,
      agency: { installationID: t.id, name: t.label, kind: t.kind, fileTypes: ['Code'] },
      // The REGISTRY's own link builder, not a hand-written www3 URL. Codex
      // noted that substituting our own link here meant the capture never
      // exercised the registry -> adapter -> email path where the dead-shard
      // defect lived. Evidence that routes around the defect is not evidence.
      portalLinks: csLinksForEvidence(t.id),
      source: 'evidence capture',
    };
    let out = '';
    try {
      const r = await runCitizenserveScrape(
        { page, address: t.street, folio: null, lat: null, lng: null, municipality: null, log: () => {} },
        j,
      );
      out = `ok=${r.ok} cases=${r.violations.length} permitsChecked=${r.permitsChecked} violationsChecked=${r.violationsChecked}`;
      say(`  id=${String(t.id).padStart(3)} ${t.label.padEnd(18)} "${t.street}"`);
      say(`${''.padEnd(26)} ${out}  -> ${r.ok ? 'SEARCH RAN' : 'REFUSED (not clear, not searched)'}`);
      for (const n of r.notes) say(`${''.padEnd(26)} note: ${n.slice(0, 150)}`);
      // The link a reader is handed is the whole value of a refusal, so record it.
      for (const l of r.portalLinks) say(`${''.padEnd(26)} link: ${l.url}`);
    } catch (e: any) {
      say(`  id=${String(t.id).padStart(3)} ${t.label.padEnd(18)} ERROR ${String(e?.message ?? e).slice(0, 70)}`);
    }
    say(`${''.padEnd(26)} claim: ${t.claim}`);
    say('');
  }

  say('## 3. Routing table, printed by the frozen module itself');
  for (const [key, j] of Object.entries(CITY_JURISDICTIONS)) {
    if (j.platform !== 'citizenserve') continue;
    const cj = j as CitizenserveJurisdiction;
    say(`  ${key.padEnd(32)} -> id=${cj.agency.installationID} ${cj.name}`);
  }
  say('');
  say('  county-level (unincorporated area only):');
  for (const [key, j] of Object.entries(JURISDICTIONS)) {
    if (j.platform !== 'citizenserve') continue;
    const cj = j as CitizenserveJurisdiction;
    say(`  ${key.padEnd(32)} -> id=${cj.agency.installationID} ${cj.name}`);
  }

  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  writeFileSync(OUT, lines.join('\n') + '\n');
  console.log(`\nwritten: ${OUT}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
