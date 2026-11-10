// Accela Citizen Access code-enforcement flow.
//
// One flow, many agencies: ACA serves hundreds of jurisdictions from the same
// ASP.NET application, so only the agency code and the module name change.
//
//   search page  aca-prod.accela.com/<AGENCY>/Cap/CapHome.aspx?module=<M>&TabName=<M>
//
// Confirmed public with no login and no App ID. Tampa's own portal says so:
// "many functions can be used without a log-in, just type the address you are
// looking for above." A survey of 28 Florida agencies is in
// docs/accela-fl-agencies-2026-11-08.md.
//
// WHY THE MODULE NAME IS CONFIGURATION, NOT A CONSTANT. It is per-agency, and
// one hardcoded `module=Enforcement` was wrong for 17 of those 28. Florida
// alone uses Enforcement, CodeEnforcement, CodeCompliance, Code and Enforce.
// Worse, an agency's landing page does not list every module it serves: Fort
// Lauderdale links only Permits/Planning/TAM and still answers
// module=Enforcement with 19 record types. So the module lives in the
// registry, established per agency by a live check, and is never defaulted.
//
// WHY THE RECORD TYPES ARE RE-READ EVERY RUN. The type list is also
// per-agency configuration. Assuming a code type exists means submitting a
// search that matches nothing and reporting a clean property, which is the
// failure module 5 produced on EnerGov and file types produced on
// citizenserve. The list is read live and an unreadable list is treated as
// unknown, never as absent.
//
// WHY THIS PORTAL'S PAGING IS THE HARD PART. ACA reports "100+ Record results
// matching your search" and "Showing 1-10 of 100+". A cap is not a count:
// past a hundred it will not say how many records exist, so there is nothing
// to reconcile a row count against. Every partial list therefore carries a
// sentence saying so, because on this platform a partial list is the normal
// case and silence would read as completeness.

import type { ScrapeResult, ScrapedViolation } from '../types.js';
import type { ScraperCtx } from './types.js';
import type { AccelaJurisdiction } from './jurisdictions.js';
import { readTables, debugDump } from './util.js';
import {
  GRID_HEADERS,
  streetNameOf,
  streetNumberOf,
  extractionMatchesPage,
  extractionShortfallNote,
  portalSaysNoRecords,
  gridFromRows,
  pickGrid,
  accelaLinks,
  codeRecordTypes,
  coverageNote,
  hasCodeTypes,
  isEncumbering,
  isOpen,
  noCodeTypesNote,
  parseRecords,
  parseResultCount,
  partialListNote,
  searchRejected,
  searchUrl,
  type AccelaRecord,
  type AccelaResultCount,
  type AccelaTenant,
} from './accela-parse.js';

export {
  GRID_HEADERS,
  streetNameOf,
  streetNumberOf,
  extractionMatchesPage,
  extractionShortfallNote,
  portalSaysNoRecords,
  gridFromRows,
  pickGrid,
  accelaLinks,
  codeRecordTypes,
  coverageNote,
  hasCodeTypes,
  isEncumbering,
  isOpen,
  noCodeTypesNote,
  parseRecords,
  parseResultCount,
  partialListNote,
  searchRejected,
  searchUrl,
  type AccelaRecord,
  type AccelaResultCount,
  type AccelaTenant,
};

// Stable ASP.NET control ids. These are Accela's own control tree, which is
// what makes one adapter reach every agency, but each is still checked for
// presence rather than assumed.
const F = {
  recordType: 'select[id$="ddlGSPermitType"]',
  // Tampa's street-number field is txtGSNumber_ChildControl0, NOT txtGSStreetNo.
  // The adapter this file replaced looked only for the latter, so it probably
  // never filled the number on Tampa and degraded to reading nothing. Try
  // both shapes and take whichever the page actually has.
  streetNo: ['input[id$="txtGSNumber_ChildControl0"]', 'input[id$="txtGSStreetNo"]'],
  streetName: 'input[id$="txtGSStreetName"]',
  parcelNo: 'input[id$="txtGSParcelNo"]',
  submit: 'input[id$="btnNewSearch"], a[id$="btnNewSearch"]',
};

/** Fill one field, reporting whether the value actually went in. */
async function fillOrFail(ctx: ScraperCtx, sel: string, value: string): Promise<boolean> {
  try {
    await ctx.page.fill(sel, value, { timeout: 10000 });
    // Read it back: a control can accept a fill and discard the value.
    const got = await ctx.page.inputValue(sel).catch(() => '');
    return got.trim() === value.trim();
  } catch {
    return false;
  }
}

/** Fill the first selector that exists. Returns false when none do. */
async function fillFirstOf(ctx: ScraperCtx, sels: string[], value: string): Promise<boolean> {
  for (const sel of sels) {
    if (await ctx.page.locator(sel).count()) {
      await ctx.page.fill(sel, value, { timeout: 10000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

/**
 * Find the results grid by locating its header ROW inside ACA's flattened
 * table, then taking the following rows of the same width.
 *
 * Returns null when the header row is not present, which is a failed read and
 * never an empty result.
 */
async function readAcaGrid(
  page: ScraperCtx['page'],
  log: (m: string) => void,
): Promise<{ headers: string[]; rows: string[][] } | null> {
  // NO named or const-arrow helpers inside page.evaluate.
  //
  // tsx/esbuild compiles with keepNames, which wraps such functions in a
  // __name() helper that does not exist in the browser, so the evaluate
  // throws "ReferenceError: __name is not defined". The first version of this
  // function had a `const norm = ...` inside, and its own `.catch(() => null)`
  // swallowed that error and reported "no results grid" - turning a bug in my
  // code into a claim about Tampa's portal. Same failure-as-finding class this
  // project keeps catching, this time hidden in the error handling.
  //
  // So the evaluate returns RAW cell text and nothing else, and every decision
  // is made in Node where the logic is testable. The catch now logs, because a
  // silent catch is how the first one hid.
  let raw: string[][] | null = null;
  try {
    raw = (await page.evaluate(() =>
      Array.from(document.querySelectorAll('tr')).map((tr) =>
        Array.from(tr.querySelectorAll('th,td')).map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim()),
      ),
    )) as string[][];
  } catch (e: any) {
    log(`accela: could not read the page's rows (${String(e?.message ?? e).slice(0, 80)})`);
    return null;
  }
  return gridFromRows(raw);
}

/** The search page for one of this agency's modules. */
const moduleUrl = (t: AccelaTenant, module: string) =>
  `https://aca-prod.accela.com/${t.agency}/Cap/CapHome.aspx?module=${module}&TabName=${module}`;

async function liveRecordTypes(ctx: ScraperCtx): Promise<string[] | null> {
  const ok = await ctx.page
    .waitForFunction(
      (sel: string) => {
        const el = document.querySelector(sel) as HTMLSelectElement | null;
        return !!el && el.options.length > 0;
      },
      F.recordType,
      { timeout: 20000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    ctx.log('accela: the record-type list never populated - treating as unknown, not empty');
    return null;
  }
  const labels = await ctx.page
    .$$eval(`${F.recordType} option`, (opts) =>
      opts.map((o) => (o.textContent ?? '').trim()).filter((t) => t && !t.startsWith('--')),
    )
    .catch(() => null);
  if (!labels || labels.length === 0) return null;
  return labels as string[];
}

/** Run one search and read the grid. Refuses rather than inventing a zero. */
async function runSearch(
  ctx: ScraperCtx,
  t: AccelaTenant,
  module: string,
): Promise<{
  ran: boolean;
  records: AccelaRecord[];
  count: AccelaResultCount;
  unreadable?: number;
  rejected?: boolean;
  shortfall?: { read: number; shown: number };
  /** Which criterion actually went into the form. */
  searchedBy?: 'parcel' | 'street';
}> {
  const { page, log } = ctx;
  const empty = { shown: null, total: null, capped: false };

  // 60s, not 45s: this portal is a heavy ASP.NET page and 45 was timing out
  // on an otherwise healthy run. A timeout here refuses safely, so the cost
  // of being impatient is a property reported unchecked for no reason.
  await page.goto(moduleUrl(t, module), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector(F.submit, { state: 'attached', timeout: 30000 });

  // Prefer the parcel number: it is the key this product actually holds, and
  // it sidesteps every disagreement between our address string and the
  // agency's own spelling of it. Fall back to the street name.
  // B3, Codex Accela round 1: A FAILED FILL MUST NOT CLAIM THE SEARCH RAN.
  //
  // The first version did `page.fill(...).catch(() => {})` and then set
  // searchedBy regardless. So when the parcel control existed but was not
  // editable, the fill rejected silently, searchedBy was set anyway, the
  // address fallback was skipped, and whatever default grid the page happened
  // to show was published as THIS property's record list - with
  // matchedAddress overwritten by the unrelated address. Codex reproduced it
  // publishing a case at 9999 FLORIDA AVE for a request about
  // 1234 N FLORIDA AVE. Publishing another property's case is worse than
  // publishing nothing, and it was the catch that made it possible.
  //
  // So every fill reports whether it worked, and a criterion that did not go
  // in is not a criterion we searched on.
  const parcel = (ctx.folio ?? '').trim();
  let searchedBy = '';
  if (parcel && (await page.locator(F.parcelNo).count())) {
    if (await fillOrFail(ctx, F.parcelNo, parcel)) {
      searchedBy = `parcel ${parcel}`;
    } else {
      log('accela: the parcel field would not accept the value - falling back to the street');
    }
  }
  if (!searchedBy) {
    const street = streetNameOf(ctx.address);
    if (!street) {
      log('accela: no usable search criteria went in - nothing to search by');
      await debugDump(page, 'accela-form', log);
      return { ran: false, records: [], count: empty };
    }
    if (!(await page.locator(F.streetName).count())) {
      log('accela: the street-name field is not on this page');
      await debugDump(page, 'accela-form', log);
      return { ran: false, records: [], count: empty };
    }
    if (!(await fillOrFail(ctx, F.streetName, street))) {
      log('accela: the street-name field would not accept the value');
      await debugDump(page, 'accela-form', log);
      return { ran: false, records: [], count: empty };
    }
    searchedBy = `street "${street}"`;
    // The number narrows the result but is not required, so a failure here is
    // logged and the search still runs on the street name alone.
    const num = streetNumberOf(ctx.address);
    if (num && !(await fillFirstOf(ctx, F.streetNo, num))) {
      log('accela: the street-number field would not accept the value - searching the street alone');
    }
  }

  // Plain WebForms posts the DOM value, so filling the field is enough here -
  // unlike Palm Beach's AngularJS shell, where a script-set value does not
  // bind and the control has to be driven as keystrokes.
  const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);
  // A submit that did not happen cannot have produced a result, so this
  // failure propagates too rather than being swallowed into a later
  // "no records" reading of whatever page we are still sitting on.
  let submitted = true;
  try {
    await page.click(F.submit, { timeout: 15000 });
  } catch (e: any) {
    submitted = false;
    log(`accela: the search button would not click (${String(e?.message ?? e).slice(0, 60)})`);
  }
  if (!submitted) {
    await debugDump(page, 'accela-submit', log);
    return { ran: false, records: [], count: empty };
  }
  await nav;
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const body = (await page.innerText('body').catch(() => '')) ?? '';
  if (searchRejected(body)) {
    log(`accela: the portal refused the search by ${searchedBy}`);
    await debugDump(page, 'accela-rejected', log);
    return { ran: false, records: [], count: empty, rejected: true };
  }

  const count = parseResultCount(body);
  // Read the grid at ROW level, not table level.
  //
  // ACA does not put its results in their own <table>. Everything - the
  // search form, a "Create a New Collection" modal, the paging links and the
  // result rows - lives inside one outer table (class ACA_CapHome), so any
  // table-level reader sees a single flattened table whose first row holds
  // 226 cells of page furniture. A substring header match picked that up and
  // produced 69 "rows", 40 of which carried text and none of which were
  // records; an exact match then found no table at all. Both were wrong
  // because the premise was wrong.
  //
  // So find the <tr> whose cells ARE the column headers, then take the rows
  // that follow it at the same width. That is what a reader sees.
  const grid = await readAcaGrid(page, log);

  if (!grid) {
    // No grid. Only the portal's own statement that it found nothing makes
    // this a zero; anything else is a read we could not complete.
    // Numeric, not textual: "10 Record results" contains "0 Record results".
    const saysNone = portalSaysNoRecords(body);
    if (saysNone) {
      log(`accela: portal reported no records for ${searchedBy}`);
      return { ran: true, records: [], count };
    }
    log(`accela: no results grid and no explicit empty state for ${searchedBy} - failed read`);
    await debugDump(page, 'accela-grid', log);
    return { ran: false, records: [], count };
  }

  const { records, unreadable } = parseRecords(grid.headers, grid.rows);
  log(
    `accela: ${records.length} record(s) for ${searchedBy}` +
      (unreadable ? `, ${unreadable} populated row(s) unreadable` : '') +
      (count.capped ? ' (portal capped its count)' : count.total !== null ? ` of ${count.total}` : ''),
  );

  // A populated grid we could only partly read is not publishable: the rows
  // we lost may be the open case.
  if (unreadable > 0) {
    await debugDump(page, 'accela-unreadable-rows', log);
    return { ran: false, records: [], count, unreadable };
  }

  // B2: the page's own claim about THIS page, checked.
  //
  // A grid carrying the four header cells and no body rows used to be
  // accepted as a successful zero-case read - even with "Showing 1-3 of 3" on
  // the page - because `unreadable` is 0 for an empty array and the count was
  // only ever consulted for the partial-list note. `shown` is trustworthy
  // even when the TOTAL is capped at "100+": the cap hides how much history
  // exists, not how many rows are in front of us.
  const matches = extractionMatchesPage(records.length, count);
  if (matches === false) {
    log(`accela: page advertises ${count.shown} row(s), extracted ${records.length} - failed read`);
    await debugDump(page, 'accela-shortfall', log);
    return { ran: false, records: [], count, shortfall: { read: records.length, shown: count.shown! } };
  }
  // Header row present, nothing extracted, and the portal did not say it
  // found nothing: that is an unreadable grid, not a clean property.
  if (records.length === 0 && !portalSaysNoRecords(body)) {
    log('accela: headers present but no rows extracted, and no explicit empty state - failed read');
    await debugDump(page, 'accela-empty-grid', log);
    return { ran: false, records: [], count };
  }
  return { ran: true, records, count, searchedBy: searchedBy.startsWith('parcel') ? 'parcel' : 'street' };
}

export async function runAccelaScrape(
  ctx: ScraperCtx,
  j: AccelaJurisdiction,
): Promise<ScrapeResult> {
  const { log } = ctx;
  const t = j.tenant;
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
    // This flow searches the code-enforcement module only. The permit side is
    // never read here, and saying so stops the email reporting "No permits
    // found" about a search that did not happen.
    permitsChecked: false,
    violationsChecked: false,
  };

  // Refuse before searching if the registry says this agency publishes none.
  if (codeRecordTypes(t.recordTypes).length === 0) {
    result.notes.push(noCodeTypesNote(t));
    return result;
  }

  if (!ctx.folio && !streetNameOf(ctx.address)) {
    result.notes.push(
      `${t.name}'s portal searches by parcel number or street name. We had neither for this property, so nothing was checked.`,
    );
    return result;
  }

  try {
    // runSearch navigates to the module it is about to search, so the page is
    // loaded ONCE per search rather than twice. The duplicate goto that used
    // to sit here was left behind when navigation moved into runSearch, and
    // it doubled every scrape's page loads against a portal that is already
    // slow enough to time out on its own.
    await ctx.page.goto(searchUrl(t), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await ctx.page.waitForSelector(F.submit, { state: 'attached', timeout: 30000 });

    // Trust the live page over the registry snapshot: an agency can switch a
    // module or a record type off between releases.
    const live = await liveRecordTypes(ctx);
    const has = hasCodeTypes(live);
    if (has === false) {
      log(`accela: ${t.name} no longer offers a code record type (live: ${live!.join(', ')})`);
      result.notes.push(noCodeTypesNote({ ...t, recordTypes: live! }));
      return result;
    }
    // has === null means the list was unreadable. Keep the registry snapshot
    // and carry on; refusing here would make an agency unreadable whenever
    // the page was slow, and the snapshot was itself established live.

    const r = await runSearch(ctx, t, t.module);
    if (!r.ran) {
      result.notes.push(
        r.shortfall
          ? extractionShortfallNote(r.shortfall.read, r.shortfall.shown, t.name)
          : r.unreadable
          ? `${t.name}'s portal returned ${r.unreadable} result row${
              r.unreadable === 1 ? '' : 's'
            } that could not be read, so this list is incomplete and nothing here is a clear result. Use the portal link below.`
          : r.rejected
            ? `${t.name}'s portal refused our search, so its code records were NOT checked. That is not the same as the property being clear. Use the portal link below.`
            : `Code enforcement search: ${t.name}'s portal did not return a readable result this run - use the portal link below to confirm.`,
      );
      return result;
    }

    result.ok = true;
    result.violationsChecked = true;
    result.violations = r.records.map(
      (rec): ScrapedViolation => ({
        caseNumber: rec.recordNumber,
        status: rec.status,
        openedDate: rec.date,
        closedDate: null,
        // The address is part of the record, not decoration. A street search
        // returns the whole street, so a row without its address cannot be
        // checked against the subject property by anyone.
        recordAddress: rec.address,
        description:
          [rec.address ? `[${rec.address}]` : null, rec.recordType, rec.shortNotes]
            .filter(Boolean)
            .join(' - ') || null,
        lastAction: isEncumbering(rec.status)
          ? `Status "${rec.status}" - money may be attached to the property`
          : isOpen(rec.status)
            ? `Status "${rec.status}" - still open`
            : null,
        details: rec.shortNotes,
      }),
    );
    // NOTHING HERE CONFIRMS A MATCHED ADDRESS. ON ANY PATH.
    //
    // Five consecutive review rounds found five ways for a record's address
    // to be matched against the requested one wrongly, each narrower than the
    // last and every one a real route to confirming someone else's property:
    //
    //   1  a failed form fill published a stranger's case outright
    //   2  N FLORIDA AVE compared equal to S FLORIDA AVE
    //   3  1234A compared equal to 1234B
    //   4  APT A compared equal to APT B
    //   5  "..., APT A" lost its unit to a comma split, and
    //      "BLDG 1 APT A" kept the building and dropped the apartment
    //
    // Round 5 took the comparison off the STREET path and left it guarding the
    // parcel path. Finding 5 arrived in the parcel path. At that point the
    // honest reading is not that the parser needs a fifth fix: it is that
    // string address equality is the wrong mechanism for deciding whether a
    // record belongs to a property, and I had been treating each failure as a
    // bug rather than as evidence about the approach.
    //
    // So matchedAddress stays exactly as the caller supplied it. Every record
    // is published carrying its OWN address (recordAddress, and prefixed into
    // the description), the search scope is disclosed, and the reader compares
    // them - which they can do, because the data is in front of them.
    //
    // What is given up is cosmetic: a tidier, portal-spelled version of an
    // address we already had. What is bought is that no parsing gap anywhere
    // in this adapter can put another property's lien under this one's
    // heading. addressesAgree and addressParts are deleted rather than left
    // unused, so nothing can quietly wire them back into this decision.

    // And if the search was by street, say so plainly. These records belong
    // to the street, not to this parcel, and a reader scanning a case list
    // under a property's heading will otherwise assume every row is theirs.
    if (r.searchedBy === 'street') {
      result.notes.push(
        `This search was by STREET NAME, not by parcel, so the records above are for the whole street and may include neighbouring properties. Each row is prefixed with the address it is filed against - compare it to ${
          ctx.address ?? 'the subject property'
        } before relying on that row.`,
      );
    }

    const partial = partialListNote(r.records.length, r.count, t.name);
    if (partial) result.notes.push(partial);
    result.notes.push(coverageNote(t, r.records.length === 0));
    result.notes.push(
      `${t.name} publishes a record's type and status but not the amount of any fine or lien. A status naming a lien means one may be recorded against the property; the figure comes from the county records or the agency directly.`,
    );

    // --- permits, a SEPARATE module and therefore a separate search ---------
    //
    // Restored from the adapter this file replaced, which searched Building as
    // well as Enforcement. Dropping it would have been a regression, but it
    // comes back on the corrected contract: that adapter set one `ok` from
    // EITHER module succeeding and carried no per-axis flag, so a readable
    // code search made the email report "No permits found" about a permit
    // search that had failed. Here the axes never vouch for each other.
    if (t.buildingModule) {
      try {
        const pr = await runSearch(ctx, t, t.buildingModule);
        if (pr.ran) {
          result.permitsChecked = true;
          result.permits = pr.records.map((rec) => ({
            permitNumber: rec.recordNumber,
            type: rec.recordType,
            status: rec.status,
            issuedDate: rec.date,
            finaledDate: null,
            // Same reason as the code side: a street search spans the street.
            description:
              [rec.address ? `[${rec.address}]` : null, rec.recordType, rec.shortNotes]
                .filter(Boolean)
                .join(' - ') || null,
            value: null,
            contractor: null,
          }));
          const pPartial = partialListNote(pr.records.length, pr.count, `${t.name} (permits)`);
          if (pPartial) result.notes.push(pPartial);
        } else {
          result.notes.push(
            `${t.name}'s permit search did not return a readable result this run, so "no permits" is NOT confirmed for this property. Use the portal link below.`,
          );
        }
      } catch (e: any) {
        log(`accela permit error: ${e?.message ?? e}`);
        result.notes.push(
          `${t.name}'s permit search could not be completed this run, so the permit side of this report is unchecked rather than clear.`,
        );
      }
    }
  } catch (e: any) {
    log(`accela error: ${e?.message ?? e}`);
    result.notes.unshift(
      `We could not read ${t.name}'s portal on this run. The link below goes to the same free search.`,
    );
  }

  return result;
}
