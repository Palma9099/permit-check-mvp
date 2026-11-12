// Accela Citizen Access: the parts that are pure functions over text.
//
// Split out of accela.ts so the repo-root tests can import them without
// dragging playwright into the Next.js build's TypeScript program. See "Why
// the adapters are split into *-parse.ts" in worker/README.md.
//
// Nothing in this file may import playwright, or anything that does.

import type { PortalLink } from '../types.js';

/**
 * An ACA tenant we know how to search.
 *
 * Accela serves hundreds of agencies from one application, so only the agency
 * code and the module name change. Both are per-agency and BOTH have to be
 * discovered rather than guessed - a survey of 28 Florida agencies on
 * 2026-11-10 got 17 of them wrong with a single hardcoded module name.
 */
export interface AccelaTenant {
  /** ACA agency code, e.g. 'TAMPA'. Case matters in the path. */
  agency: string;
  name: string;
  /** A county agency covers unincorporated area; a city covers itself. */
  kind: 'county' | 'city';
  /**
   * The code-enforcement module's name for THIS agency.
   *
   * Observed in Florida: Enforcement, CodeEnforcement, CodeCompliance, Code,
   * Enforce. There is no default worth having, which is why this is required.
   */
  module: string;
  /** Record types confirmed on the live search page, with the date in the registry. */
  recordTypes: string[];
  /**
   * The BUILDING module's name, when this agency publishes permits too.
   *
   * Kept because the adapter this file replaced searched permits as well as
   * code, and dropping that would have been a regression. It is a separate
   * module and therefore a separate search, which is exactly why the result
   * carries a read flag per axis: one `ok` cannot speak for two searches.
   */
  buildingModule?: string;
}

export const searchUrl = (t: AccelaTenant) =>
  `https://aca-prod.accela.com/${t.agency}/Cap/CapHome.aspx?module=${t.module}&TabName=${t.module}`;

export const accelaLinks = (t: AccelaTenant, extra: PortalLink[] = []): PortalLink[] => [
  { label: `${t.name} code enforcement search (Accela)`, url: searchUrl(t) },
  ...extra,
];

/**
 * Record types that mean code enforcement work against a property.
 *
 * Deliberately broad. Agencies name the same thing differently - Tampa has
 * "Code Case" and "Complaint" and "Civil Case", Leon has "Code Compliance",
 * North Port has "Code Violation" - and missing a type means searching a
 * narrower slice than the reader thinks. Over-matching shows a record that
 * turns out to be irrelevant; under-matching hides one that was not.
 */
const CODE_TYPE =
  /code|violation|complaint|enforce|nuisance|lien|unsafe|demolition|remedial|notice to appear|civil case|abate|zoning/i;

export const codeRecordTypes = (types: string[]): string[] => types.filter((t) => CODE_TYPE.test(t));

/**
 * Does this agency publish any code-enforcement record type?
 *
 * `null` means the type list could not be read, which is NOT the same as an
 * agency with no code types and must never be treated as one. The whole
 * reason this returns a tri-state is that an empty list and an unread list
 * look identical if you let them.
 */
export function hasCodeTypes(types: string[] | null): boolean | null {
  if (types === null) return null;
  return codeRecordTypes(types).length > 0;
}

/** One row of an ACA enforcement result grid. */
export interface AccelaRecord {
  date: string | null;
  recordNumber: string | null;
  recordType: string | null;
  address: string | null;
  status: string | null;
  shortNotes: string | null;
}

const cell = (row: string[], i: number): string | null => {
  if (i < 0) return null;
  const v = (row[i] ?? '').replace(/\s+/g, ' ').trim();
  return v ? v : null;
};

/** The grid's header, used to pick it out of the page and to locate columns. */
export const GRID_HEADERS = ['record number', 'record type', 'address', 'status'];

/**
 * The columns that IDENTIFY a results grid, as opposed to the ones we want.
 *
 * `address` is not one of them. Hillsborough County's Enforcement grid labels
 * Date, Record Number, Record Type, Description, Project Name, Related
 * Records, Status and Short Notes, and carries the address in a TRAILING
 * COLUMN WHOSE HEADER CELL IS BLANK. Requiring the literal word rejected a
 * grid holding "100+ Record results matching your search", so the adapter
 * reported no readable result for a county of 1,008,349 unincorporated
 * residents while the portal was answering normally.
 *
 * Identification stays strict without it: these three must each be their own
 * cell, exactly. The search form's "Record Number:" carries a colon and does
 * not match, so form furniture is still rejected, and `gridFromRows` keeps its
 * own width guard against document-sized rows.
 *
 * Address remains REQUIRED for narrowing records to a property. A grid without
 * one is readable but unnarrowable, and the caller must say so rather than
 * imply the rows are about the subject parcel. See `addressColumnMissingNote`.
 */
export const GRID_IDENTIFYING_HEADERS = ['record number', 'status'];

/**
 * Why only two.
 *
 * Every relaxation here has come from a real tenant, never from a guess:
 *
 *   Hillsborough  Date | Record Number | Record Type | Description |
 *                 Project Name | Related Records | Status | Short Notes
 *   Pasco         Date | Record Number | Record Type | Module |
 *                 Project Name | Address | Status
 *   Lee           Record Number | Address | Description | Status | Action |
 *                 Related Records
 *
 * Hillsborough has no Address, which R4 handled. Lee has no RECORD TYPE, the
 * mirror image, and the two headers common to all three are the two left.
 *
 * Identification is still not loose, and `gridFromRows` carries the rest of
 * the guard: each must be its OWN cell matched exactly, so the search form's
 * "Record Number:" and "Status:" do not match; a row wider than 24 cells is
 * rejected as furniture; and body rows must match the header row's width.
 * Those cases are tested rather than asserted.
 */

/** True when a grid was identified but carries no usable address column. */
export function gridHasAddressColumn(headers: string[]): boolean {
  return headers.some((h) => h.toLowerCase().replace(/\s+/g, ' ').trim() === 'address');
}

/**
 * Disclosure for a grid with no address column.
 *
 * Without an address there is no way to tell which rows belong to the subject
 * parcel, so the list is street-wide at best. Saying nothing would let a
 * reader treat a neighbour's case as this property's, which is the same class
 * of error as reporting an unsearched authority as clear.
 */
export function rowsMissingAddressNote(
  tenantName: string,
  missing: number,
  total: number,
): string {
  return `${missing} of the ${total} ${tenantName} records above carry no address, so those rows cannot be checked against this property. Confirm each one on the portal before relying on it.`;
}

/**
 * Disclosure for a grid with no address column.
 *
 * Codex R4-01: a LABELLED address column can still have blank cells, and a
 * mixed grid is its own shape. `some(address)` promised every row an address
 * while one was null. The column-level note below covers a tenant that
 * publishes no column at all; `rowsMissingAddressNote` covers the rows.
 */
export function addressColumnMissingNote(tenantName: string): string {
  return `${tenantName}'s record list does not publish an address column, so these records cannot be narrowed to this property. Treat them as records for the searched street, not for this address, and confirm each one on the portal before relying on it.`;
}

/**
 * Pick the real results grid out of an ACA page.
 *
 * THIS IS THE BROWARD PICKGRID BUG, RECURRING IN NEW CODE. ACA nests the
 * whole page inside an outer table, so a substring match on the header text
 * matches that outer table too - its first row's text contains "record
 * number" because the real grid is somewhere inside it. The first version of
 * this adapter did exactly that on Tampa and came back with 69 "rows" that
 * were the search form, a "Create a New Collection" modal and the paging
 * links, 40 of which carried text and none of which were records. The
 * adapter then correctly refused, so no false clear - but Tampa was
 * unreadable, which is its own failure.
 *
 * The fix is the one that worked on Broward:
 *   - header cells must match EXACTLY, not by substring
 *   - the data rows must be the same width as the header
 *   - among candidates, prefer the one with the most record-shaped rows
 */
export function pickGrid(
  tables: Array<{ headers: string[]; rows: string[][] }>,
): { headers: string[]; rows: string[][] } | null {
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').trim();
  const RECORD_ID = /^[A-Z]{2,5}-\d{2,4}-\d+$/i;

  const scored = tables
    .map((t) => {
      const h = t.headers.map(norm);
      // Exact cell equality, so "record number" matches the column and not a
      // page that merely mentions it.
      if (!GRID_IDENTIFYING_HEADERS.every((k) => h.includes(k))) return null;
      const rows = t.rows.filter((r) => r.length === t.headers.length);
      if (rows.length === 0) return null;
      const idRows = rows.filter((r) => r.some((c) => RECORD_ID.test((c ?? '').trim()))).length;
      return { headers: t.headers, rows, idRows };
    })
    .filter((x): x is { headers: string[]; rows: string[][]; idRows: number } => x !== null)
    .sort((a, b) => b.idRows - a.idRows);

  return scored[0] ? { headers: scored[0].headers, rows: scored[0].rows } : null;
}

/**
 * Map a result grid onto records, and count the rows that were lost.
 *
 * Same contract as the citizenserve parser, for the same reason: a row that
 * carries text but yields no identifiable record is a PARSE FAILURE on a
 * populated grid, not an absence of records. Dropping those quietly and
 * publishing the survivor count is how a property with open cases reads as
 * clean, and it is the defect this project has now found in two separate
 * adapters.
 */
export function parseRecords(
  headers: string[],
  rows: string[][],
): { records: AccelaRecord[]; unreadable: number } {
  const h = headers.map((x) => x.toLowerCase().replace(/\s+/g, ' ').trim());
  const idx = (...keys: string[]) => h.findIndex((x) => keys.some((k) => x.includes(k)));
  const iDate = idx('date');
  const iNo = idx('record number');
  const iType = idx('record type');
  const iAddr = idx('address');
  const iStatus = idx('status');
  const iNotes = idx('short notes', 'notes');

  const records: AccelaRecord[] = [];
  let unreadable = 0;
  for (const r of rows) {
    const rec: AccelaRecord = {
      date: cell(r, iDate),
      recordNumber: cell(r, iNo),
      recordType: cell(r, iType),
      address: cell(r, iAddr),
      status: cell(r, iStatus),
      shortNotes: cell(r, iNotes),
    };
    // Identifying content: anything that names the record or the property.
    if (rec.recordNumber || rec.address) {
      records.push(rec);
      continue;
    }
    if (r.some((x) => (x ?? '').trim())) unreadable++;
  }
  return { records, unreadable };
}

/**
 * What ACA says about how many records it found.
 *
 * This portal is HARDER than the others on this point, not easier. EnerGov
 * reports an exact count that can be reconciled against the rows read; ACA
 * reports "100+ Record results matching your search" and "Showing 1-10 of
 * 100+". A cap is not a count: past a hundred the portal will not say how
 * many records exist, so there is nothing to reconcile and the only honest
 * move is to say the list is partial.
 */
export interface AccelaResultCount {
  /** Rows the portal says it is showing, e.g. 10 from "Showing 1-10 of 100+". */
  shown: number | null;
  /** Exact total when the portal gives one. */
  total: number | null;
  /** True when the portal reported a cap ("100+") rather than a number. */
  capped: boolean;
}

export function parseResultCount(bodyText: string): AccelaResultCount {
  // "Showing 1-10 of 100+" or "Showing 1-3 of 3"
  const showing = bodyText.match(/Showing\s+\d+\s*-\s*(\d+)\s+of\s+([\d,]+)(\+?)/i);
  if (showing) {
    const shown = Number(showing[1]);
    const total = Number(showing[2].replace(/,/g, ''));
    return {
      shown: Number.isFinite(shown) ? shown : null,
      total: showing[3] === '+' ? null : Number.isFinite(total) ? total : null,
      capped: showing[3] === '+',
    };
  }
  // "100+ Record results matching your search"
  const capped = bodyText.match(/([\d,]+)\+\s+Record results/i);
  if (capped) return { shown: null, total: null, capped: true };
  const exact = bodyText.match(/([\d,]+)\s+Record results/i);
  if (exact) {
    const n = Number(exact[1].replace(/,/g, ''));
    return { shown: null, total: Number.isFinite(n) ? n : null, capped: false };
  }
  return { shown: null, total: null, capped: false };
}

/** Did the portal render a result region at all, or refuse the search? */
export function searchRejected(bodyText: string): boolean {
  return /enter at least one search criteria|please enter|too many records|no records found matching/i.test(
    bodyText,
  );
}

/**
 * Tell the reader when the list they are looking at is not the whole history.
 *
 * Returns null only when the portal gave an exact total and we read all of it.
 * Anything else gets a sentence, because on this platform "we showed you ten"
 * is the normal case and a reader who assumes ten is all there is has been
 * misled by silence.
 */
export function partialListNote(
  read: number,
  count: AccelaResultCount,
  name: string,
): string | null {
  if (count.capped) {
    return `${name}'s portal caps what it will report: it says there are more than ${
      count.shown ?? read
    } matching records without saying how many, and ${read} were read here. This is NOT the property's full history - open the portal link below and search it directly.`;
  }
  if (count.total !== null && count.total > read) {
    return `${name}'s portal reports ${count.total} matching records and returns them a page at a time; ${read} were read here. Open the portal link below to see the rest - do not read this list as complete.`;
  }
  return null;
}

/** What to say when an agency does not publish code records at all. */
export function noCodeTypesNote(t: AccelaTenant): string {
  return `${t.name} runs Accela but its public portal offers no code-enforcement record type on the ${t.module} search, so nothing was checked here. That is not the same as the property being clear - contact ${t.name} directly for code case history.`;
}

/** What an empty result means, given who this agency is. */
export function coverageNote(t: AccelaTenant, nothingFound: boolean): string {
  if (t.kind === 'county') {
    const bare = t.name.replace(/\s+County$/i, '');
    return `${t.name}'s portal covers code enforcement in unincorporated ${bare} County. If this address sits inside a city, that city is the code authority and ${
      nothingFound
        ? 'finding nothing here says nothing about the property'
        : 'these county records are only part of the picture'
    }.`;
  }
  return `${t.name} runs its own code enforcement, so this search covers the whole city.`;
}

/** A status meaning the matter is still live against the property. */
export function isOpen(status: string | null): boolean {
  const s = (status ?? '').toLowerCase();
  if (!s) return false;
  if (/closed|complete|void|withdrawn|cancel|resolved|complied|unfounded|no violation/.test(s)) return false;
  return true;
}

/** A status meaning money is attached to the property. */
export function isEncumbering(status: string | null): boolean {
  return /lien|fine|judgment|special magistrate|assessment/i.test(status ?? '');
}

/**
 * Find the results grid inside ACA's flattened row list.
 *
 * ACA does not give its results their own <table>. The search form, a
 * "Create a New Collection" modal, the paging links and the result rows all
 * live inside one outer table, so a table-level reader sees a single table
 * whose first row holds 226 cells of page furniture. Two table-level attempts
 * failed on that: a substring header match produced 69 rows of chrome, and an
 * exact match found no table at all. Both were wrong because the premise was.
 *
 * This works on rows instead. Find the row whose own cells ARE the column
 * headers, then take the rows after it at the same width. It is a pure
 * function over text so it is testable without a browser.
 */
export function gridFromRows(
  rows: string[][],
): { headers: string[]; rows: string[][] } | null {
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i];
    const low = cells.map((c) => c.toLowerCase());
    if (!GRID_IDENTIFYING_HEADERS.every((w) => low.includes(w))) continue;
    // Furniture rows are enormous because they contain the whole document; a
    // real header row is a handful of short cells.
    if (cells.length > 24) continue;
    const width = cells.length;
    const body: string[][] = [];
    for (let j = i + 1; j < rows.length; j++) {
      const r = rows[j];
      if (r.length !== width) {
        // A different width means we have walked past the end of the grid
        // into the paging row or the next section. STOP rather than skip:
        // skipping would splice unrelated rows into the list further down.
        if (body.length) break;
        continue;
      }
      if (r.some((x) => x)) body.push(r);
    }
    // A header row with no body rows at its width is not a grid. Returning one
    // lets the caller skip the explicit-empty-state check and report "searched,
    // found nothing" when the portal never said so, which is the one thing this
    // product must never get wrong. `pickGrid` already refuses this; this
    // function did not. Keep scanning: a later row may be the real header.
    if (!body.length) continue;
    return { headers: cells, rows: body };
  }
  return null;
}

/**
 * Does the portal itself state that it found nothing?
 *
 * B1, Codex Accela round 1: the first version tested the page text against
 * /no records found|0 Record results/i, and "10 Record results matching your
 * search" CONTAINS "0 Record results". So 10, 20, 100 - any positive count
 * ending in zero - read as an explicit empty state. Paired with an unreadable
 * grid that returned a successful zero, and the email then printed "No
 * code-enforcement cases found in the portal for this property" over a
 * hundred records.
 *
 * A count is now read as a NUMBER, via parseResultCount, and a genuine zero
 * is the only zero. The phrase match is anchored so it cannot be satisfied by
 * a digit sitting in front of it.
 */
export function portalSaysNoRecords(bodyText: string): boolean {
  const count = parseResultCount(bodyText);
  // An explicit positive count, capped or not, is never an empty state.
  if (count.capped) return false;
  if (count.total !== null && count.total > 0) return false;
  if (count.shown !== null && count.shown > 0) return false;
  if (count.total === 0) return true;
  // No count at all: fall back to the portal's own wording, with the digit
  // boundary that was missing.
  //
  // Nassau County says "Notice: Your search returned no results. Please modify
  // your search criteria and try again." That is the portal stating plainly
  // that it found nothing, and neither pattern below matched it, so a working
  // portal with a genuine zero was reported as unreadable. Captured in
  // tests/fixtures/nassau-enforcement-empty.json.
  //
  // Each phrase stays specific. "no results" alone would match prose about
  // results elsewhere on a page; "returned no results" is the portal's own
  // sentence about the search just run.
  return (
    /(^|[^\d])0\s+Record results/i.test(bodyText) ||
    /no records found/i.test(bodyText) ||
    /your search returned no results/i.test(bodyText) ||
    /search returned no results/i.test(bodyText)
  );
}

/**
 * Did we extract as many rows as the portal says this page is showing?
 *
 * B2, same review: a page carrying the four header cells and no body rows was
 * accepted as a successful zero-case read, even with "Showing 1-3 of 3" on
 * it. The count was only consulted for the partial-list note, never for
 * whether the extraction had worked.
 *
 * `shown` is the current page's own claim and is trustworthy even when the
 * TOTAL is capped at "100+", which is what makes it usable here: the cap hides
 * how much history exists, not how many rows are on the page in front of us.
 *
 * Returns null when the portal said nothing about this page, which is not a
 * failure - some agencies print no count for a small result.
 */
export function extractionMatchesPage(read: number, count: AccelaResultCount): boolean | null {
  if (count.shown === null) return null;
  return read >= count.shown;
}

/** What to say when the page advertised more rows than we could extract. */
export function extractionShortfallNote(read: number, shown: number, name: string): string {
  return `${name}'s portal says it is showing ${shown} record${
    shown === 1 ? '' : 's'
  } on this page but only ${read} could be read, so the extraction is incomplete and nothing here is a clear result. Open the portal link below and check the property directly.`;
}

// addressesAgree / addressParts / AddressParts USED TO LIVE HERE.
//
// They decided whether a portal record's address named the requested
// property. Five review rounds found five ways for that decision to be wrong
// - a failed fill, N vs S, 1234A vs 1234B, APT A vs APT B, and finally a unit
// lost to a comma plus a building number shadowing an apartment - each fix
// leaving the next gap load-bearing.
//
// They are deleted, not kept unused, because the adapter no longer confirms a
// matched address on any path and dead code with passing tests is an
// invitation to wire it back in. The reader is given every record's own
// address instead and compares it themselves. See the long comment at the
// matchedAddress decision in accela.ts.

/** "1234 N FLORIDA AVE" -> "1234". */
export function streetNumberOf(address: string | null): string | null {
  // Digits only here, deliberately and for a different reason than
  // addressParts: this value goes into Accela's numeric Street No. field,
  // which rejects a letter. The SUFFIX-SENSITIVE comparison lives in
  // addressParts, so narrowing the search here cannot widen a match there.
  const m = (address ?? '').trim().match(/^(\d+)[A-Z]?(?=\s|$)/i);
  return m ? m[1] : null;
}

/**
 * The record types this agency offers, or null when the list cannot be read.
 *
 * WAIT FOR THE OPTIONS, not just the select. The EnerGov adapter had exactly
 * this bug: the element attaches before it is filled, an early read returns
 * an empty list, and an empty list is indistinguishable from "no types". That
 * one nearly discarded seven cities and 675,709 people.
 */

/** "1234 N FLORIDA AVE" -> "FLORIDA". ACA wants the name without number or type. */
export function streetNameOf(address: string | null): string | null {
  const a = (address ?? '').split(',')[0].trim();
  if (!a) return null;
  const words = a
    .replace(/^\d+[A-Z]?\s+/i, '')
    .replace(/\s+(apt|unit|ste|suite|#)\s*\S+$/i, '')
    .trim()
    .split(/\s+/);
  const DIR = /^(n|s|e|w|ne|nw|se|sw|north|south|east|west)$/i;
  const TYPE =
    /^(aly|ave|avenue|blvd|boulevard|br|cir|circle|cswy|ct|court|ctr|dr|drive|expy|fwy|hill|hwy|highway|land|ln|lane|loop|mall|pkwy|parkway|pl|place|plz|pt|rd|road|rnch|sq|st|street|ter|terrace|trail|trl|vis|vly|way)$/i;
  const core = words.filter((w) => !DIR.test(w) && !TYPE.test(w));
  const name = (core.length ? core : words).join(' ').trim();
  return name || null;
}
