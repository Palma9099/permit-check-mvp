// Broward BCS (Posse): the parts that are pure functions over text and tables.
//
// Split out of broward.ts so the repo-root tests can import them WITHOUT
// dragging playwright into the Next.js build's TypeScript program. See "Why the
// adapters are split into *-parse.ts" in worker/README.md.
//
// Nothing in this file may import playwright, or anything that does.

/** Posse case and permit numbers both read YY-NNNN. */
export const CASE_NO = /^\d\d-\d{3,5}$/;
export const PERMIT_NO = /^\d\d-\d{3,6}$/;

/** The portal prints this literal string where a date is absent. It is not a date. */
const DATE_PLACEHOLDER = /^m{2,3}\s*d{1,2},?\s*y{2,4}$/i;

// --- parcel key -------------------------------------------------------------

export type ParcelKey =
  | { kind: 'parcelId'; value: string }
  | { kind: 'folio'; value: string };

/**
 * Work out which of the BCS search fields a given parcel key belongs in.
 *
 * The app stores Broward folios as 12 compact digits (see compactBrowardFolio
 * in src/lib/lien-providers/broward.ts), and that is exactly what the portal's
 * "Parcel ID" field wants - 504113111610. The portal's separate "Folio Number"
 * field wants the shorter dashed form, 0113-11-1610. The two encodings differ
 * by more than punctuation, so rather than convert between them we send each to
 * the field it belongs to and refuse anything that is neither.
 */
export function parcelKeyFor(raw: string | null): ParcelKey | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  if (d.length === 12) return { kind: 'parcelId', value: d };
  if (d.length === 10) return { kind: 'folio', value: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` };
  return null;
}

// --- who is actually the code authority -------------------------------------

export type Authority =
  | { kind: 'county' }                      // unincorporated / BMSD: the county is it
  | { kind: 'city'; name: string }          // a municipality runs code here
  | { kind: 'unknown' };                    // we could not tell, and must say so

/** Unincorporated Broward shows up as "UNINCORPORATED" or "BMSD- <NAME>". */
export function authorityFromCityName(name: string | null | undefined): Authority {
  if (!name || !name.trim()) return { kind: 'unknown' };
  const n = name.trim();
  if (/unincorporated|^bmsd\b|\bbmsd-/i.test(n)) return { kind: 'county' };
  return { kind: 'city', name: n };
}

// --- page parsing (pure, so it is testable without a browser) ---------------

/**
 * Read a "Label: value" line out of a Posse detail page's rendered text.
 * The label must match the whole label, so "Violation" does not also match
 * "Complaint / Violation", and the value keeps any colons of its own, which
 * matters for "Section: CITATION: 39-275(6)b".
 */
export function fieldFrom(text: string, label: string): string | null {
  // Every class of whitespace here is horizontal on purpose. \s matches a
  // newline, so a pattern like `Label:\s*(.*)` silently walks past an EMPTY
  // field and captures the NEXT line - which made a case with no complaint text
  // report its "Date Established" line as the complaint. An empty field must
  // read as empty.
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[ \\t]*');
  const m = text.match(new RegExp(`^[ \\t]*${esc}[ \\t]*:[ \\t]*(.*)$`, 'im'));
  const v = m?.[1]?.replace(/[ \t]+/g, ' ').trim();
  return v ? v : null;
}

/**
 * Pick a Posse results grid.
 *
 * Two traps make the obvious approaches wrong on these pages.
 *
 * Keyword scoring loses: the page chrome is itself a <table> whose first row
 * flattens the whole document, so it matches every keyword. Worse, a substring
 * match on "case" hits the page heading "BCS Enforcement Cases" and lands on a
 * column that is not the case column at all - which silently returned the case
 * number for every field.
 *
 * So require two things a wrapper table cannot fake: the id column header must
 * match EXACTLY (not as a substring), and the header must be the same width as
 * the data rows. The real grid is 7 columns wide with 7-column rows; every
 * wrapper has a header far wider than its rows.
 */
/**
 * Index of the header that equals one of `names` exactly. Needed wherever a
 * substring would collide: the permit grid has both "Permit Number" and
 * "Permit", so colIndex(['permit']) returns the number column and every
 * description comes out as the permit number repeated.
 */
/** Local copy of util.ts's colIndex: util imports a playwright type. */
export function colIndexOf(headers: string[], keywords: string[]): number {
  const lower = headers.map((h) => h.toLowerCase());
  for (let i = 0; i < lower.length; i++) {
    if (keywords.some((k) => lower[i].includes(k))) return i;
  }
  return -1;
}

export function exactIndex(headers: string[], names: string[]): number {
  const want = names.map((n) => n.toLowerCase());
  return headers.findIndex((h) => want.includes(h.trim().toLowerCase()));
}

export function pickGrid(
  tables: { headers: string[]; rows: string[][] }[],
  idHeaders: string[],
  idPattern: RegExp,
): { headers: string[]; rows: string[][]; idIndex: number } | null {
  const want = idHeaders.map((h) => h.toLowerCase());
  let best: { headers: string[]; rows: string[][]; idIndex: number; hits: number } | null = null;

  for (const t of tables) {
    const i = t.headers.findIndex((h) => want.includes(h.trim().toLowerCase()));
    if (i < 0) continue;
    const rows = t.rows.filter((r) => r.length === t.headers.length);
    const hits = rows.filter((r) => idPattern.test((r[i] ?? '').trim())).length;
    if (!hits) continue;
    // A nested wrapper can satisfy the width test by accident, so prefer the
    // table that actually holds the most id-shaped rows, and on a tie the
    // narrowest - which is always the innermost, real grid.
    const better =
      !best || hits > best.hits || (hits === best.hits && t.headers.length < best.headers.length);
    if (better) best = { headers: t.headers, rows, idIndex: i, hits };
  }
  return best ? { headers: best.headers, rows: best.rows, idIndex: best.idIndex } : null;
}

export interface BrowardCaseDetail {
  status: string | null;
  enforcementType: string | null;
  caseType: string | null;
  complaint: string | null;
  established: string | null;
  inspector: string | null;
  folio: string | null;
  address: string | null;
  jurisdiction: string | null;
  legal: string | null;
  owner: string | null;
}

export function parseCaseDetail(text: string): BrowardCaseDetail {
  return {
    status: fieldFrom(text, 'Status'),
    enforcementType: fieldFrom(text, 'Enforcement Type'),
    caseType: fieldFrom(text, 'Case Type'),
    complaint: fieldFrom(text, 'Complaint / Violation'),
    established: fieldFrom(text, 'Date Established'),
    inspector: fieldFrom(text, 'Inspector'),
    folio: fieldFrom(text, 'Folio Number'),
    address: fieldFrom(text, 'Address'),
    jurisdiction: fieldFrom(text, 'Jurisdiction'),
    legal: fieldFrom(text, 'Legal Description'),
    owner: fieldFrom(text, 'Owner'),
  };
}

export interface BrowardActivities {
  novIssued: string | null;
  section: string | null;
  violation: string | null;
  crNumber: string | null;
  recordingDate: string | null;
}

export function parseActivities(text: string): BrowardActivities {
  return {
    novIssued: fieldFrom(text, 'NOV Issued'),
    section: fieldFrom(text, 'Section'),
    violation: fieldFrom(text, 'Violation'),
    crNumber: fieldFrom(text, 'CR Number'),
    recordingDate: fieldFrom(text, 'Recording Date'),
  };
}

/**
 * A one-line summary of the recorded lien, or null. The CR number is Broward's
 * Official Records instrument number, so this is the string that lets a person
 * pull the actual recorded document.
 */
export function lienSummary(a: BrowardActivities): string | null {
  if (!a.crNumber && !a.recordingDate) return null;
  const parts = ['Lien recorded'];
  if (a.recordingDate) parts.push(a.recordingDate);
  if (a.crNumber) parts.push(`(Broward Official Records CR ${a.crNumber})`);
  return parts.join(' ');
}

/** Drop the portal's "mmm dd, yyyy" placeholder rather than passing it off as a date. */
export function cleanDate(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  return !t || DATE_PLACEHOLDER.test(t) ? null : t;
}

/**
 * The decision to refuse a search, kept pure so it is tested in the fast suite
 * rather than only through a browser.
 */
export function folioRefusal(folio: string | null): { notes: string[] } | null {
  if (parcelKeyFor(folio)) return null;
  return {
    notes: [
      folio
        ? `"${folio}" is not a Broward parcel number. Broward folios are 12 digits (e.g. 504113111610). Look it up on the Property Appraiser link below and re-run.`
        : 'Broward County records are keyed by parcel number. Look the folio up on the Property Appraiser link below and re-run with it.',
    ],
  };
}

/**
 * What an empty - or a non-empty - county result actually means, given who the
 * code authority is. This is the sentence that stops a Broward scan reading as
 * "clean" when the county was simply never the right government to ask.
 */
export function authorityNote(authority: Authority, nothingFound: boolean): string {
  if (authority.kind === 'city') {
    return `${authority.name} is the code authority for this parcel, not Broward County. The county searched above covers unincorporated Broward, so ${nothingFound ? 'finding nothing here says nothing about the property' : 'these county records are only part of the picture'} - the city's own code and permit records still need checking.`;
  }
  if (authority.kind === 'county') {
    return 'This parcel is in unincorporated Broward (BMSD), so Broward County is the code authority and the searches above are the right ones.';
  }
  return 'We could not confirm whether this parcel sits in a city or in unincorporated Broward. Broward County code enforcement covers unincorporated areas only, and about 99% of the county lives in one of its 31 cities, so treat an empty county result as unchecked rather than clear until the city is identified.';
}
