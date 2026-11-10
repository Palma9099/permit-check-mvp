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
      if (!GRID_HEADERS.every((k) => h.includes(k))) return null;
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
    if (!GRID_HEADERS.every((w) => low.includes(w))) continue;
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
    return { headers: cells, rows: body };
  }
  return null;
}
