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
  addressParts,
  streetNumberOf,
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
describe('B3 and R2-B2: no record is attributed to a property it does not name', () => {
  it('agrees when every component agrees', () => {
    expect(addressesAgree('1234 N FLORIDA AVE', '1234 N FLORIDA AVE')).toBe(true);
  });

  it('normalises long forms, so AVENUE equals AVE and NORTH equals N', () => {
    expect(addressesAgree('1234 NORTH FLORIDA AVENUE', '1234 N FLORIDA AVE')).toBe(true);
  });

  it('CODEX B3 TRIGGER: a neighbour at a different number does not agree', () => {
    expect(addressesAgree('9999 FLORIDA AVE', '1234 FLORIDA AVE')).toBe(false);
  });

  // Round 2. The first version compared only number and the STRIPPED name,
  // and streetNameOf deliberately removes the direction and the street type,
  // so opposite sides of a city agreed. Codex reproduced the first of these
  // through the production adapter, getting matchedAddress 1234 S FLORIDA AVE
  // for a request about 1234 N FLORIDA AVE.
  it('CODEX R2 TRIGGER: opposite directions do NOT agree', () => {
    expect(addressesAgree('1234 S FLORIDA AVE', '1234 N FLORIDA AVE')).toBe(false);
    expect(addressesAgree('1234 E MAIN ST', '1234 W MAIN ST')).toBe(false);
    expect(addressesAgree('1234 NE 1 ST', '1234 SW 1 ST')).toBe(false);
  });

  it('different street TYPES do not agree', () => {
    // Florida Ave and Florida St are different roads in plenty of FL cities.
    expect(addressesAgree('1234 FLORIDA ST', '1234 FLORIDA AVE')).toBe(false);
  });

  it('a missing component is ambiguity, not a wildcard', () => {
    // "1234 FLORIDA AVE" does not say which of N or S, so it confirms neither.
    expect(addressesAgree('1234 FLORIDA AVE', '1234 N FLORIDA AVE')).toBe(false);
    expect(addressesAgree('1234 N FLORIDA AVE', '1234 FLORIDA AVE')).toBe(false);
  });

  it('reads a trailing direction too', () => {
    expect(addressesAgree('1234 FLORIDA AVE NW', '1234 FLORIDA AVE NW')).toBe(true);
    expect(addressesAgree('1234 FLORIDA AVE NW', '1234 FLORIDA AVE SE')).toBe(false);
  });

  it('a different street at the same number does not agree', () => {
    expect(addressesAgree('1234 MAIN ST', '1234 FLORIDA ST')).toBe(false);
  });

  it('declines rather than guesses when either address is unusable', () => {
    expect(addressesAgree(null, '1234 N FLORIDA AVE')).toBe(false);
    expect(addressesAgree('FLORIDA AVE', '1234 N FLORIDA AVE')).toBe(false);
    expect(addressesAgree('1234 N FLORIDA AVE', null)).toBe(false);
  });

  it('a unit number is never read as the street number or type', () => {
    expect(addressesAgree('1234 N FLORIDA AVE APT 9999', '1234 N FLORIDA AVE')).toBe(true);
    expect(addressesAgree('9999 N FLORIDA AVE APT 1234', '1234 N FLORIDA AVE')).toBe(false);
  });

  // Round 3. addressParts matched /^(\d+)[A-Z]?\s/ and captured only the
  // digits, so the suffix letter was matched and then thrown away. Codex
  // reproduced it through the production adapter: a request for 1234A came
  // back with matchedAddress 1234B. A half-address is a different property,
  // often a different unit of a duplex, and its case belongs to its owner.
  it('CODEX R3 TRIGGER: 1234A and 1234B are different properties', () => {
    expect(addressesAgree('1234B N FLORIDA AVE', '1234A N FLORIDA AVE')).toBe(false);
    expect(addressParts('1234A N FLORIDA AVE').number).toBe('1234A');
    expect(addressParts('1234B N FLORIDA AVE').number).toBe('1234B');
  });

  it('matches a suffixed number to itself, case-insensitively', () => {
    expect(addressesAgree('1234a N FLORIDA AVE', '1234A N FLORIDA AVE')).toBe(true);
  });

  it('a bare number does not confirm a suffixed one, or the reverse', () => {
    // Same ambiguity rule as the direction: 1234 does not say which of
    // 1234A or 1234B, so it confirms neither.
    expect(addressesAgree('1234 N FLORIDA AVE', '1234A N FLORIDA AVE')).toBe(false);
    expect(addressesAgree('1234A N FLORIDA AVE', '1234 N FLORIDA AVE')).toBe(false);
  });

  it('streetNumberOf stays digits-only, because it feeds a numeric form field', () => {
    // Deliberately different from addressParts: Accela's Street No. control
    // rejects a letter. Narrowing the SEARCH cannot widen a MATCH, because
    // the suffix-sensitive comparison lives in addressParts.
    expect(streetNumberOf('1234A N FLORIDA AVE')).toBe('1234');
    expect(streetNumberOf('1234 N FLORIDA AVE')).toBe('1234');
  });

  it('splits an address into the parts that decide a match', () => {
    expect(addressParts('1234 N FLORIDA AVE')).toEqual({
      number: '1234', direction: 'N', name: 'FLORIDA', type: 'AVE',
    });
    expect(addressParts('10049 N Florida Ave T 33612').number).toBe('10049');
  });
});
