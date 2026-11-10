// citizenserve: the parts that are pure functions over text and tables.
//
// Split out of citizenserve.ts so the repo-root tests can import them without
// dragging playwright into the Next.js build's TypeScript program. See "Why the
// adapters are split into *-parse.ts" in worker/README.md.
//
// Nothing in this file may import playwright, or anything that does.

import type { PortalLink } from '../types.js';

/** One row of a citizenserve Code Administration search result. */
export interface CitizenserveCase {
  fileNumber: string | null;
  address: string | null;
  type: string | null;
  status: string | null;
  openDate: string | null;
  closeDate: string | null;
  description: string | null;
}

/**
 * The file types a tenant exposes on its public search page.
 *
 * This is per-tenant configuration and it is the single most important fact
 * about this platform. Every Florida citizenserve tenant answers on the same
 * host with the same search page, but what that page offers differs completely:
 * Alachua County exposes Permit, License, Development AND Code; Walton County
 * exposes Development only; Eatonville exposes nothing at all. So "the agency
 * is on citizenserve" tells you nothing about whether its code cases are
 * public, and an adapter that assumes Code exists will report a property clean
 * because it searched a module the county never turned on.
 */
export type FileType = 'Permit' | 'License' | 'Development' | 'Code';

const FILE_TYPES: FileType[] = ['Permit', 'License', 'Development', 'Code'];

/** Read the file types out of a search page's HTML. */
export function fileTypesFrom(html: string): FileType[] {
  const found = new Set<FileType>();
  for (const t of FILE_TYPES) {
    if (new RegExp(`<option[^>]*value="${t}"`, 'i').test(html)) found.add(t);
  }
  return FILE_TYPES.filter((t) => found.has(t));
}

export const hasCode = (types: FileType[]): boolean => types.includes('Code');

/**
 * Map a result table's rows onto cases, and say how many rows were lost.
 *
 * The grid is File#, Address, Type, Status, Open Date, Close Date, Description.
 *
 * THE ROW FILTER USED TO BE A FALSE-ZERO PATH. It kept a row only when the
 * ADDRESS cell was populated, because File# is blank on several live Alachua
 * rows. But address can be blank too, and then a row like
 *
 *   ["CE-123", "", "Unsafe structure", "Open", "01/01/2026", "", "..."]
 *
 * was silently discarded: a real open case with a case number, a type, a
 * status, a date and a narrative. The grid WAS populated, so the empty-grid
 * guard never ran, the search still reported as executed, and the email
 * printed "Code-enforcement cases (0): none found" over an open dangerous
 * building case.
 *
 * Two changes. A row now survives on ANY identifying field, not one chosen
 * field. And rows that carry content but cannot be interpreted at all are
 * COUNTED and returned, so the caller can refuse rather than publish a
 * silently shortened list. Dropping rows and then reporting the survivor
 * count as the truth is the same mistake as reconciling a permit count
 * against rows that are about to be filtered out; getting it twice in two
 * adapters is why this now fails closed instead of filtering quietly.
 */
export function parseCaseRows(rows: string[][]): {
  cases: CitizenserveCase[];
  /** Rows with text in them that produced no identifiable case. */
  unreadable: number;
} {
  const cases: CitizenserveCase[] = [];
  let unreadable = 0;
  for (const r of rows) {
    const c: CitizenserveCase = {
      fileNumber: cellOf(r, 0),
      address: cellOf(r, 1),
      type: cellOf(r, 2),
      status: cellOf(r, 3),
      openDate: cellOf(r, 4),
      closeDate: cellOf(r, 5),
      description: cellOf(r, 6),
    };
    // Identifying content: anything that names the case or the property. A
    // row with only a status or only a date identifies nothing.
    if (c.fileNumber || c.address) {
      cases.push(c);
      continue;
    }
    // The row had text, so the grid was not empty, but nothing in it names a
    // case. That is a parse failure on a populated row, not an absence.
    if (r.some((x) => (x ?? '').trim())) unreadable++;
  }
  return { cases, unreadable };
}

/** What to tell a reader when a populated grid could not be fully read. */
export function unreadableRowsNote(unreadable: number, agencyName: string): string {
  return `${agencyName}'s portal returned ${unreadable} result row${
    unreadable === 1 ? '' : 's'
  } that could not be read, so this list is incomplete and nothing here is a clear result. Open the portal link below and check the property directly.`;
}

function cellOf(row: string[], i: number): string | null {
  const v = (row[i] ?? '').replace(/\s+/g, ' ').trim();
  return v ? v : null;
}

/**
 * Whether a search actually executed.
 *
 * DO NOT test the page text for "No records found". citizenserve ships that
 * exact string inside a <script> element on the results page, so
 * `body.innerText` contains it even when the grid is full - a one-record
 * Alachua search reads as "No records found" followed by the record. Anything
 * keying on that string reports a property clean while looking straight at its
 * open case. Count the parsed rows instead; this helper exists to make the rule
 * explicit and testable.
 */
export function describeOutcome(ranSearch: boolean, cases: CitizenserveCase[]): {
  ok: boolean;
  note: string | null;
} {
  if (!ranSearch) {
    return {
      ok: false,
      note: 'The county portal did not run our search this time - use the portal link below to confirm.',
    };
  }
  if (cases.length === 0) {
    return { ok: true, note: null };
  }
  return { ok: true, note: null };
}

/** A citizenserve agency we know how to search. */
export interface CitizenserveAgency {
  installationID: number;
  name: string;
  /** A county agency covers unincorporated area only; a city covers itself. */
  kind: 'county' | 'city';
  /** File types confirmed on the live search page, 2026-11-09. */
  fileTypes: FileType[];
}

/**
 * What an empty result means for this agency.
 *
 * A county citizenserve tenant is the code authority for its UNINCORPORATED
 * area, the same trap that cuts Broward to 16,888 and Palm Beach to 649,776.
 * A city tenant covers the whole city, so an empty result there is meaningful.
 */
export function coverageNote(agency: CitizenserveAgency, nothingFound: boolean): string {
  if (agency.kind === 'county') {
    return `${agency.name}'s portal covers code cases in unincorporated ${agency.name.replace(/ County$/, '')} County. If this address sits inside a city, that city is the code authority and ${
      nothingFound ? 'finding nothing here says nothing about the property' : 'these county records are only part of the picture'
    } - the city's own records still need checking.`;
  }
  return `${agency.name} runs its own code enforcement, so this search covers the whole city.`;
}

/** The note for a tenant that does not publish code cases at all. */
export function noCodeModuleNote(agency: CitizenserveAgency): string {
  const has = agency.fileTypes.length ? agency.fileTypes.join(', ') : 'nothing';
  return `${agency.name} is on citizenserve but does not publish code enforcement cases on its public portal - its search offers ${has}. We checked nothing here, which is not the same as the property being clear. Contact the agency directly for code case history.`;
}

/**
 * The shards citizenserve serves every tenant from, in a fixed order.
 *
 * Lives here, not in the adapter, because the registry builds portal links and
 * must not hardcode a shard of its own. Health is not a property worth pinning:
 * measured a day apart, the healthy set INVERTED.
 *
 *   2026-11-09  healthy www www2 www3 www5 www6 www8   stub www7   down www4
 *   2026-11-10  healthy www www2 www3 www4 www5        stub www6 www7 www8
 *
 * `www` is the only one healthy in both readings, so it is the default for a
 * link built before any shard has been tried. It is a starting point, not a
 * promise: the adapter replaces these links with the shard it actually opened.
 */
export const CITIZENSERVE_SHARDS = ['www', 'www2', 'www3', 'www4', 'www5', 'www6', 'www7', 'www8'];

export const DEFAULT_SHARD = CITIZENSERVE_SHARDS[0];

export const searchUrlOn = (shard: string, id: number) =>
  `https://${shard}.citizenserve.com/Portal/PortalController?Action=showSearchPage&ctzPagePrefix=Portal_&installationID=${id}`;

/**
 * Point a tenant's portal links at the shard that actually answered.
 *
 * The links we hand a reader are the whole value of an honest refusal: when
 * the adapter cannot read a property's code cases it says so and tells them to
 * check the portal themselves. A link to a dead shard makes that advice
 * worthless, and the registry had every link pinned to www6 - a 2,591-byte
 * stub with no search form on the day this was found, while www through www5
 * served the real page.
 *
 * So the adapter rewrites them to the shard it opened. When nothing opened,
 * the links keep the default and the caller says nothing was reachable.
 */
export function relinkToShard(links: PortalLink[], shard: string, id: number): PortalLink[] {
  const want = searchUrlOn(shard, id);
  return links.map((l) =>
    /\.citizenserve\.com\/Portal\/PortalController/i.test(l.url) ? { ...l, url: want } : l,
  );
}
