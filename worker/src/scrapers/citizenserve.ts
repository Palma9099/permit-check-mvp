// citizenserve platform flow.
//
// citizenserve is the one Florida permitting platform with an open registry:
// every tenant lives at the same URL with an integer installationID, so the
// whole state's tenant list was enumerable by sweeping ids (39 Florida tenants
// between id 97 and 650). One flow plus that id covers all of them.
//
//   search page  https://www4.citizenserve.com/Portal/PortalController
//                  ?Action=showSearchPage&ctzPagePrefix=Portal_&installationID=<N>
//
// Flow: open the search page, set File Type to Code, which fires the page's own
// getSearchFieldsOnFileType() and renders the criteria fields (address,
// parcelNumber, type, status, description); fill the address; submit, which
// calls validateAndSearch(); read the results grid.
//
// Three things decide whether this adapter is honest.
//
// 1. THE CODE MODULE IS PER-TENANT. Being on citizenserve says nothing about
//    whether code cases are public. Surveyed live 2026-11-09 across the 17
//    confirmed Florida tenants: 10 expose Code, 7 do not. Walton County offers
//    Development only; Cocoa and Southwest Ranches offer Permit only;
//    Eatonville's search offers nothing at all. Searching a module a county
//    never enabled and reporting "no cases" would be a lie, so the adapter
//    refuses up front for those tenants.
//
// 2. "No records found" IS IN A <script> TAG. citizenserve ships that literal
//    string inside a script element on every results page, so page text
//    contains it even when the grid is full - a one-record Alachua search reads
//    as "No records found" and then prints the record. Never test the text;
//    count parsed rows. See describeOutcome in citizenserve-parse.ts.
//
// 3. A COUNTY TENANT COVERS UNINCORPORATED AREA ONLY, the same trap that cuts
//    Broward to 16,888. Alachua County's portal does not hold Gainesville's
//    cases. City tenants cover their whole city.
//
// Also: the host shards. www4 redirects to www6 and others; always follow
// redirects and never hardcode the shard.

import type { ScrapeResult, ScrapedViolation } from '../types.js';
import type { ScraperCtx } from './types.js';
import type { CitizenserveJurisdiction } from './jurisdictions.js';
import { readTables, debugDump } from './util.js';
import {
  fileTypesFrom,
  hasCode,
  parseCaseRows,
  coverageNote,
  noCodeModuleNote,
  describeOutcome,
  type CitizenserveCase,
} from './citizenserve-parse.js';

export {
  fileTypesFrom,
  hasCode,
  parseCaseRows,
  coverageNote,
  noCodeModuleNote,
  describeOutcome,
  type CitizenserveCase,
};

/**
 * citizenserve serves every tenant from several interchangeable shards, and
 * they are NOT equally healthy. Measured 2026-11-09 for installationID 318:
 *
 *   www, www2, www3, www5, www6, www8   200, ~140 KB, full search page
 *   www4                                 connection timeout
 *   www7                                 200 but a 2.6 KB stub, no search form
 *
 * The portal's own links point at www4 and rely on a redirect, so pinning it -
 * as the first version of this adapter did - makes one sick shard look like
 * the whole county going dark. Try them in turn and accept the first that
 * actually renders the search form. A 200 serving a stub is worse than a
 * failure, because it looks like success, so the health check tests for the
 * form rather than the status code.
 */
// Measured again on 2026-11-10, and the picture had INVERTED in one day:
//
//   2026-11-09   healthy: www, www2, www3, www5, www6, www8   stub: www7   down: www4
//   2026-11-10   healthy: www, www2, www3, www4, www5         stub: www6, www7, www8
//
// So a shard's health is not a fact worth hardcoding a preference on, and
// excluding www7 by name was wrong-headed: www8 serves the same 2.6 KB stub
// today and may be fine tomorrow. Every shard is listed, in a fixed order for
// reproducibility, and the live health check decides. The check is what has to
// be right, not the ordering.
const SHARDS = ['www', 'www2', 'www3', 'www4', 'www5', 'www6', 'www7', 'www8'];

const searchUrlOn = (shard: string, id: number) =>
  `https://${shard}.citizenserve.com/Portal/PortalController?Action=showSearchPage&ctzPagePrefix=Portal_&installationID=${id}`;

/** The link we hand a human, on a shard observed healthy. */
export const publicSearchUrl = (id: number) => searchUrlOn(SHARDS[0], id);

/**
 * Open the tenant's search page on whichever shard answers. Returns the shard
 * used, or null when every one of them failed - which is a failed read, never
 * an empty result.
 */
async function openSearchPage(ctx: ScraperCtx, id: number): Promise<string | null> {
  const { page, log } = ctx;
  for (const shard of SHARDS) {
    try {
      await page.goto(searchUrlOn(shard, id), { waitUntil: 'domcontentloaded', timeout: 25000 });
      // A shard can answer 200 with a stub that has no form, so the form is the
      // test, not the status code.
      //
      // state:'attached', NOT the default 'visible'. This page is mostly
      // script-rendered - the body is ~350 characters at domcontentloaded - so
      // #filetype is in the DOM well before it paints. Waiting for visibility
      // timed out on healthy shards and made the adapter walk the whole shard
      // list reporting every one of them dead, while curl fetched the same page
      // in under a second.
      await page.waitForSelector('#filetype', { state: 'attached', timeout: 20000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      if (shard !== SHARDS[0]) log(`citizenserve: fell back to shard ${shard}`);
      return shard;
    } catch {
      log(`citizenserve: shard ${shard} did not serve the search page, trying the next`);
    }
  }
  return null;
}

/** The results grid's header, used to pick it out of the page. */
const GRID_HEADERS = ['file#', 'address', 'type', 'status'];

/**
 * Set File Type to Code the way a person does, so the page's own onchange
 * handler runs and renders the criteria fields. Setting .value from script
 * does not fire it, and submitting without the fields lands on an empty
 * results page reading "Please enter search criteria".
 */
async function selectCodeFileType(ctx: ScraperCtx): Promise<boolean> {
  const { page, log } = ctx;
  const sel = page.locator('#filetype');
  if (!(await sel.count())) return false;

  // #address exists in the DOM from the start but stays HIDDEN until the page's
  // own getSearchFieldsOnFileType() runs, so "the element is present" is not
  // the test - it has to be visible. selectOption alone has been seen to leave
  // it hidden, so fall back to driving the control as a person does.
  const ready = async () =>
    page.locator('#address').isVisible().catch(() => false);

  try {
    await sel.selectOption('Code', { timeout: 10000 });
    await page.waitForTimeout(1200);
    if (await ready()) return true;

    log('citizenserve: selectOption left the criteria fields hidden, retrying as keystrokes');
    await sel.click({ timeout: 10000 });
    await sel.press('c');
    await sel.press('Tab');
    await page.waitForSelector('#address', { state: 'visible', timeout: 15000 });
    return true;
  } catch (e: any) {
    log(`citizenserve: code criteria fields did not render (${e?.message ?? e})`);
    return false;
  }
}

async function runSearch(
  ctx: ScraperCtx,
  address: string,
): Promise<{ ran: boolean; cases: CitizenserveCase[] }> {
  const { page, log } = ctx;

  if (!(await selectCodeFileType(ctx))) {
    await debugDump(page, 'citizenserve-search-form', log);
    return { ran: false, cases: [] };
  }

  await page.fill('#address', address, { timeout: 10000 });

  // SUBMIT runs the page's validateAndSearch(), which POSTs and navigates - but
  // not immediately. Waiting on networkidle alone returns BEFORE that
  // navigation starts, and the parse then races it ("Execution context was
  // destroyed"). Pair the click with the navigation so we are on the results
  // page before reading anything.
  const submit = page.locator('button:has-text("Submit"), input[value="SUBMIT" i]').last();
  const navigation = page
    .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => null);
  if (await submit.count()) {
    await submit.click({ timeout: 10000 }).catch(() => {});
  } else {
    await page.evaluate(() => (window as any).validateAndSearch?.());
  }
  await navigation;
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const body = (await page.innerText('body').catch(() => '')) ?? '';
  if (/Please enter search criteria/i.test(body)) {
    log('citizenserve: portal rejected the search for missing criteria');
    await debugDump(page, 'citizenserve-results', log);
    return { ran: false, cases: [] };
  }

  // Pick the grid by its header, then map rows. Never read the page text for
  // emptiness: "No records found" lives in a <script> on this page.
  const tables = await readTables(page);
  const grid = tables.find((t) => {
    const h = t.headers.map((x) => x.toLowerCase().replace(/\s+/g, ''));
    return GRID_HEADERS.every((k) => h.some((x) => x.includes(k.replace(/\s+/g, ''))));
  });
  if (!grid) {
    // Do NOT treat a missing grid as zero cases. readTables drops a table with
    // no data rows, so "no grid" covers both a genuinely clean property and a
    // layout change that broke the parse - and reporting the second as the
    // first is exactly how this product lies. An address with a known open
    // case was reported clean this way during development.
    //
    // Require POSITIVE evidence of an empty result instead. Read live against
    // Alachua on 2026-11-10, a zero-hit search renders the results table fully
    // headed, with a single completely empty row:
    //
    //   <table class="table">
    //     <thead><tr><th>File#</th><th>Address</th>...<th>Description</th></tr></thead>
    //     <tbody><tr></tr></tbody>
    //   </table>
    //
    // and the words "No records found" in a <p> OUTSIDE that table. So the
    // honest test is "the grid rendered with its real headers and carried no
    // cell-bearing rows" - that proves the result region loaded, which a
    // broken parse or a changed layout does not. The earlier check looked for
    // the text inside #resultsDiv/.results/#divResults, and none of those
    // selectors exist on this page, so it could never fire: every clean
    // property read as "could not check" and the whole tier was stuck amber.
    const empty = await resultGridIsEmpty(page);
    if (empty) {
      log('citizenserve: results grid rendered with no rows - a confirmed zero');
      return { ran: true, cases: [] };
    }
    log('citizenserve: no result grid and no confirmed empty grid - treating as a failed read');
    await debugDump(page, 'citizenserve-grid', log);
    return { ran: false, cases: [] };
  }
  const cases = parseCaseRows(grid.rows);
  log(`citizenserve: ${cases.length} code case row(s) for "${address}"`);
  return { ran: true, cases };
}

/**
 * Did the results grid render, headed and with no data rows?
 *
 * This is the one thing that may stand in for a row count, and only because it
 * is positive evidence: the table has to be there, carrying the real column
 * headers, with nothing in its body. A page that failed to render its result
 * region has no such table and gets a refusal instead.
 */
async function resultGridIsEmpty(page: ScraperCtx['page']): Promise<boolean> {
  return page
    .evaluate((needles: string[]) => {
      const tables = Array.from(document.querySelectorAll('table'));
      for (const t of tables) {
        const headers = Array.from(t.querySelectorAll('thead th, thead td')).map((h) =>
          (h.textContent || '').toLowerCase().replace(/\s+/g, ''),
        );
        if (!headers.length) continue;
        const headed = needles.every((k) => headers.some((h) => h.includes(k)));
        if (!headed) continue;
        // Any row carrying a cell with text means this is not an empty grid,
        // and the caller should have parsed it rather than asking us.
        const dataRows = Array.from(t.querySelectorAll('tbody tr')).filter((r) =>
          Array.from(r.querySelectorAll('td')).some((c) => (c.textContent || '').trim()),
        );
        return dataRows.length === 0;
      }
      return false;
    }, GRID_HEADERS.map((k) => k.replace(/\s+/g, '')))
    .catch(() => false);
}

export async function runCitizenserveScrape(
  ctx: ScraperCtx,
  j: CitizenserveJurisdiction,
): Promise<ScrapeResult> {
  const { log } = ctx;
  const result: ScrapeResult = {
    ok: false,
    county: j.county,
    matchedAddress: ctx.address,
    folio: ctx.folio,
    permits: [],
    violations: [],
    notes: [],
    portalLinks: j.portalLinks,
    source: j.source,
  };

  // Refuse before searching if this tenant never published code cases.
  if (!hasCode(j.agency.fileTypes)) {
    result.notes.push(noCodeModuleNote(j.agency));
    return result;
  }

  if (!ctx.address) {
    result.notes.push(
      `${j.agency.name}'s portal searches code cases by street address. We did not have one for this property, so nothing was checked.`,
    );
    return result;
  }

  try {
    const shard = await openSearchPage(ctx, j.agency.installationID);
    if (!shard) {
      result.notes.push(
        'We could not reach this portal on this run - every citizenserve server we tried was unavailable. Nothing was checked. Use the portal link below.',
      );
      return result;
    }

    // The tenant's exposed modules can change; re-read them from the live page
    // rather than trusting the registry snapshot.
    //
    // Read the option values straight off #filetype rather than via
    // page.content(): serialising the whole document races the portal's own
    // settling and throws "the page is navigating and changing the content",
    // which then looks like the county being unreadable.
    const live = (await ctx.page
      .$$eval('#filetype option', (opts) => opts.map((o) => (o as HTMLOptionElement).value))
      .catch(() => [] as string[])) as string[];
    const liveTypes = fileTypesFrom(live.map((v) => `<option value="${v}"`).join(''));
    if (liveTypes.length && !hasCode(liveTypes)) {
      log(`citizenserve: ${j.agency.name} no longer exposes Code (live: ${liveTypes.join(', ')})`);
      result.notes.push(noCodeModuleNote({ ...j.agency, fileTypes: liveTypes }));
      return result;
    }

    const r = await runSearch(ctx, ctx.address);
    if (!r.ran) {
      result.notes.push(
        'Code enforcement search: the portal did not run our search this run - use the portal link below to confirm.',
      );
      return result;
    }

    result.violations = r.cases.map(
      (c): ScrapedViolation => ({
        caseNumber: c.fileNumber,
        status: c.status,
        openedDate: c.openDate,
        closedDate: c.closeDate,
        description: [c.type, c.description].filter(Boolean).join(' - ') || null,
        lastAction: null,
        details: c.description,
      }),
    );
    const outcome = describeOutcome(true, r.cases);
    result.ok = outcome.ok;
    if (outcome.note) result.notes.push(outcome.note);
    if (r.cases[0]?.address) result.matchedAddress = r.cases[0].address;

    result.notes.push(coverageNote(j.agency, r.cases.length === 0));
    result.notes.push(
      'Covers code enforcement cases only. This portal does not publish permit history on the same search, and fine or lien amounts are not shown.',
    );
  } catch (e: any) {
    log(`citizenserve error: ${e?.message ?? e}`);
    result.notes.unshift(
      'We could not read this portal on this run. The link below goes straight to the same free search.',
    );
  }

  return result;
}
