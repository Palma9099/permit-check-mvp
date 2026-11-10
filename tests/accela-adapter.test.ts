// Accela Citizen Access adapter.
//
// Three P1 blockers from Codex round 1, all reproduced here with the triggers
// it named. They are the same defect class the rest of this repo has spent the
// day on - a failed read presented as a finding - and the third is the worst
// version of it anywhere in the product: publishing a DIFFERENT property's
// case as if it were this one's.

import { describe, expect, it } from 'vitest';
import {
  portalSaysNoRecords,
  extractionMatchesPage,
  extractionShortfallNote,
  parseResultCount,
  partialListNote,
  gridFromRows,
  parseRecords,
  codeRecordTypes,
  hasCodeTypes,
  isOpen,
  isEncumbering,
  searchUrl,
  type AccelaTenant,
  type AccelaResultCount,
  addressesAgree,
} from '../worker/src/scrapers/accela-parse.js';

const TAMPA: AccelaTenant = {
  agency: 'TAMPA',
  name: 'City of Tampa',
  kind: 'city',
  module: 'Enforcement',
  recordTypes: ['Code Case', 'Complaint', 'Civil Case'],
};

// ---------------------------------------------------------------------------
// B1: a positive count ending in zero read as an explicit empty state.
//
// The first version tested /no records found|0 Record results/i against the
// page text, and "10 Record results matching your search" CONTAINS
// "0 Record results". So 10, 20 and 100 all read as "the portal found
// nothing", and paired with an unreadable grid that produced a successful
// zero the email printed "No code-enforcement cases found in the portal for
// this property" over a hundred records.
// ---------------------------------------------------------------------------
describe('B1: a count ending in zero is not an empty state', () => {
  for (const n of [10, 20, 100, 1000, 30]) {
    it(`${n} Record results is NOT an empty state`, () => {
      expect(portalSaysNoRecords(`${n} Record results matching your search`)).toBe(false);
    });
  }

  it('a real zero still reads as zero, so clean parcels stay readable', () => {
    expect(portalSaysNoRecords('0 Record results matching your search')).toBe(true);
    expect(portalSaysNoRecords('No records found')).toBe(true);
  });

  it('a capped count is never an empty state', () => {
    expect(portalSaysNoRecords('100+ Record results matching your search')).toBe(false);
    expect(portalSaysNoRecords('Showing 1-10 of 100+')).toBe(false);
  });

  it('a page showing rows is never an empty state', () => {
    expect(portalSaysNoRecords('Showing 1-3 of 3')).toBe(false);
  });

  it('says nothing when the portal says nothing', () => {
    expect(portalSaysNoRecords('Search for Records')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B2: a header-only grid accepted as a successful zero-case read.
//
// gridFromRows returns a grid even with no body rows, `unreadable` is 0 for
// an empty array, and the count was only consulted for the partial-list note
// - so a page carrying the four header cells and "Showing 1-3 of 3" came back
// ok with zero cases.
// ---------------------------------------------------------------------------
describe('B2: the page\'s own row claim is checked, not just reported', () => {
  const shown = (n: number, total: number): AccelaResultCount =>
    parseResultCount(`Showing 1-${n} of ${total}`);

  it('refuses when the page advertises more rows than were extracted', () => {
    expect(extractionMatchesPage(0, shown(3, 3))).toBe(false);
    expect(extractionMatchesPage(2, shown(10, 100))).toBe(false);
  });

  it('accepts when the extraction matches the page', () => {
    expect(extractionMatchesPage(3, shown(3, 3))).toBe(true);
    expect(extractionMatchesPage(10, shown(10, 100))).toBe(true);
  });

  it('uses `shown` even when the TOTAL is capped, because the cap hides history not rows', () => {
    const capped = parseResultCount('Showing 1-10 of 100+');
    expect(capped.capped).toBe(true);
    expect(capped.total).toBeNull();
    expect(capped.shown).toBe(10);
    expect(extractionMatchesPage(10, capped)).toBe(true);
    expect(extractionMatchesPage(4, capped)).toBe(false);
  });

  it('returns null when the portal said nothing about this page', () => {
    // Some agencies print no count for a small result; that is not a failure.
    expect(extractionMatchesPage(2, parseResultCount('Search for Records'))).toBeNull();
  });

  it('a header-only grid really does come back with no rows', () => {
    const rows = [
      ['Date', 'Record Number', 'Record Type', 'Address', 'Status'],
    ];
    const g = gridFromRows(rows);
    expect(g).not.toBeNull();
    expect(g!.rows).toEqual([]);
    // Which is exactly why the caller may not treat it as a confirmed zero.
  });

  it('names the shortfall for the reader', () => {
    const n = extractionShortfallNote(0, 3, 'City of Tampa');
    expect(n).toMatch(/showing 3 records/i);
    expect(n).toMatch(/only 0 could be read/i);
    expect(n).toMatch(/nothing here is a clear result/i);
  });
});

// ---------------------------------------------------------------------------
// The row-level grid reader. ACA puts the search form, a modal, the paging
// links and the records all inside one outer table, so a table-level reader
// sees a single table whose first row holds 226 cells of page furniture.
// ---------------------------------------------------------------------------
describe('the grid is found by its header ROW, not by its table', () => {
  const HEADERS = ['Date', 'Record Number', 'Record Type', 'Address', 'Expiration Date', 'Created By', 'Status', 'Action', 'Short Notes'];
  const ROW = ['11/05/2026', 'CMP-26-0015410', 'Complaint', '10049 N Florida Ave', '', 'AR', 'Open', '', 'note'];

  it('finds the grid past rows of page furniture', () => {
    const furniture = ['', 'Create a New Collection'];
    const g = gridFromRows([furniture, ['*Name:'], HEADERS, ROW]);
    expect(g!.headers).toEqual(HEADERS);
    expect(g!.rows).toEqual([ROW]);
  });

  it('ignores a monstrous furniture row that happens to contain the header words', () => {
    // The real outer table's first row had 226 cells including every label on
    // the page. A substring match picked it and produced 69 rows of chrome.
    const monster = new Array(226).fill('x');
    monster[40] = 'Record Number';
    monster[41] = 'Record Type';
    monster[42] = 'Address';
    monster[43] = 'Status';
    const g = gridFromRows([monster, HEADERS, ROW]);
    expect(g!.headers).toEqual(HEADERS);
  });

  it('stops at the paging row rather than splicing it in', () => {
    const paging = ['< Prev12345... Next >'];
    const g = gridFromRows([HEADERS, ROW, paging, ['unrelated', 'later', 'section']]);
    expect(g!.rows).toEqual([ROW]);
  });

  it('returns null when no header row is present, which is a failed read', () => {
    expect(gridFromRows([['some', 'other', 'table']])).toBeNull();
  });
});

describe('records, and the rows that identify nothing', () => {
  const HEADERS = ['Date', 'Record Number', 'Record Type', 'Address', 'Status', 'Short Notes'];

  it('maps a record and flags an open one', () => {
    const r = parseRecords(HEADERS, [['11/05/2026', 'CMP-26-0015410', 'Complaint', '10049 N Florida Ave', 'Open', 'x']]);
    expect(r.unreadable).toBe(0);
    expect(r.records[0]).toMatchObject({ recordNumber: 'CMP-26-0015410', status: 'Open' });
    expect(isOpen('Open')).toBe(true);
    expect(isOpen('Investigation In-Progress')).toBe(true);
    expect(isOpen('Closed')).toBe(false);
    expect(isOpen('Unfounded')).toBe(false);
  });

  it('counts a populated row that identifies nothing instead of dropping it', () => {
    const r = parseRecords(HEADERS, [['11/05/2026', '', '', '', 'Open', '']]);
    expect(r.records).toEqual([]);
    expect(r.unreadable).toBe(1);
  });

  it('survives on either identifying field', () => {
    expect(parseRecords(HEADERS, [['', 'CMP-1', '', '', '', '']]).records).toHaveLength(1);
    expect(parseRecords(HEADERS, [['', '', '', '1 MAIN ST', '', '']]).records).toHaveLength(1);
  });

  it('flags money attached to the property', () => {
    expect(isEncumbering('Lien')).toBe(true);
    expect(isEncumbering('Special Magistrate')).toBe(true);
    expect(isEncumbering('Open')).toBe(false);
  });
});

describe('the cap, which is this platform\'s hard part', () => {
  it('reads a cap as a cap and always warns', () => {
    const c = parseResultCount('100+ Record results matching your search Showing 1-10 of 100+');
    expect(c.capped).toBe(true);
    expect(c.total).toBeNull();
    const note = partialListNote(10, c, 'City of Tampa');
    expect(note).toMatch(/caps what it will report/i);
    expect(note).toMatch(/NOT the property's full history/);
  });

  it('warns on an exact total we did not fully read', () => {
    expect(partialListNote(10, parseResultCount('Showing 1-10 of 42'), 'X')).toMatch(/42 matching records/);
  });

  it('stays quiet only when an exact total was fully read', () => {
    expect(partialListNote(3, parseResultCount('Showing 1-3 of 3'), 'X')).toBeNull();
  });
});

describe('per-agency configuration is never defaulted', () => {
  it('an unreadable type list is unknown, not absent', () => {
    expect(hasCodeTypes(null)).toBeNull();
    expect(hasCodeTypes([])).toBe(false);
    expect(hasCodeTypes(['Building Permit'])).toBe(false);
    expect(hasCodeTypes(['Code Case'])).toBe(true);
  });

  it('picks code types out of a mixed list', () => {
    expect(codeRecordTypes(['Building Permit', 'Code Case', 'Complaint', 'Roofing'])).toEqual(['Code Case', 'Complaint']);
  });

  it('builds the search URL from the agency AND its own module name', () => {
    expect(searchUrl(TAMPA)).toBe(
      'https://aca-prod.accela.com/TAMPA/Cap/CapHome.aspx?module=Enforcement&TabName=Enforcement',
    );
    // Lee County is CodeEnforcement, not Enforcement. One guess was wrong for
    // 17 of 28 agencies, so there is no default.
    expect(searchUrl({ ...TAMPA, agency: 'LEECO', module: 'CodeEnforcement' })).toContain('module=CodeEnforcement');
  });
});

// ---------------------------------------------------------------------------
// B3, and the thing sitting underneath it.
//
// Codex's trigger: the parcel control exists but rejects page.fill, so the
// fill failure was caught, searchedBy was set anyway, the address fallback was
// skipped, and whatever default grid the page held was published as THIS
// property's records - with matchedAddress overwritten by the unrelated
// address. Publishing a different property's case is the worst failure in this
// product and a `.catch(() => {})` allowed it.
//
// Fixing the fill exposed a second problem that had been hidden by the first:
// a STREET search returns the whole street, and the adapter was still adopting
// records[0].address as the matched address. So a request about
// 1234 N FLORIDA AVE reported 9999 FLORIDA AVE as its address.
// ---------------------------------------------------------------------------
describe('B3: no record is attributed to a property it does not name', () => {
  it('agrees only when number AND street name match', () => {
    expect(addressesAgree('1234 N FLORIDA AVE', '1234 N FLORIDA AVE')).toBe(true);
    expect(addressesAgree('1234 FLORIDA AVE', '1234 N FLORIDA AVE')).toBe(true);
  });

  it('CODEX TRIGGER: a neighbour on the same street does not agree', () => {
    expect(addressesAgree('9999 FLORIDA AVE', '1234 N FLORIDA AVE')).toBe(false);
  });

  it('a different street at the same number does not agree', () => {
    expect(addressesAgree('1234 MAIN ST', '1234 N FLORIDA AVE')).toBe(false);
  });

  it('declines rather than guesses when either address is unusable', () => {
    // Conservative on purpose: treating a neighbour's case as this property's
    // is a worse error than declining to confirm a match.
    expect(addressesAgree(null, '1234 N FLORIDA AVE')).toBe(false);
    expect(addressesAgree('FLORIDA AVE', '1234 N FLORIDA AVE')).toBe(false);
    expect(addressesAgree('1234 N FLORIDA AVE', null)).toBe(false);
  });

  it('is not fooled by a number appearing inside a unit', () => {
    expect(addressesAgree('1234 FLORIDA AVE APT 9999', '1234 N FLORIDA AVE')).toBe(true);
    expect(addressesAgree('9999 FLORIDA AVE APT 1234', '1234 N FLORIDA AVE')).toBe(false);
  });
});
