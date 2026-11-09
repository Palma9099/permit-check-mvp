// citizenserve: the parts that are pure functions over text and tables.
//
// Split out of citizenserve.ts so the repo-root tests can import them without
// dragging playwright into the Next.js build's TypeScript program. See "Why the
// adapters are split into *-parse.ts" in worker/README.md.
//
// Nothing in this file may import playwright, or anything that does.

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
 * Map a result table's rows onto cases.
 *
 * The grid is File#, Address, Type, Status, Open Date, Close Date, Description.
 * The File# cell is blank on some rows in live data (Alachua has several), so a
 * row is kept when it carries an address, not when it carries a file number.
 */
export function parseCaseRows(rows: string[][]): CitizenserveCase[] {
  return rows
    .map((r) => ({
      fileNumber: cellOf(r, 0),
      address: cellOf(r, 1),
      type: cellOf(r, 2),
      status: cellOf(r, 3),
      openDate: cellOf(r, 4),
      closeDate: cellOf(r, 5),
      description: cellOf(r, 6),
    }))
    .filter((c) => c.address);
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
