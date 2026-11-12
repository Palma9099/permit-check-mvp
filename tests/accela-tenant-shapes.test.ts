// Three Accela tenants, three different grid shapes, and the two tenants that
// did not recover from the R3 fix turned out to have two unrelated causes.
//
//   Hillsborough  Record Type + Status, NO Address        (fixed in R3/R4)
//   Lee           Address + Status, NO RECORD TYPE        (this file)
//   Nassau        not broken at all: the portal said it found nothing, in
//                 wording the adapter did not recognise  (this file)
//
// Every fixture here is a real capture from the live portal, not a shape I
// invented, because the whole reason these were missed is that I reasoned
// about what the pages ought to look like instead of reading them.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  gridFromRows,
  parseRecords,
  portalSaysNoRecords,
  GRID_IDENTIFYING_HEADERS,
} from '../worker/src/scrapers/accela-parse.js';

const load = (f: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));

const lee = load('leeco-codeenforcement-grid.json') as { rows: string[][] };
const nassau = load('nassau-enforcement-empty.json') as { bodyText: string };
const hcfl = load('hcfl-enforcement-grid.json') as { rows: string[][] };

describe('Lee County: a grid with no Record Type column', () => {
  it('is identified', () => {
    // Before this change the identifying set required 'record type' and this
    // returned null, so a portal showing four cases read as unreadable.
    const grid = gridFromRows(lee.rows);
    expect(grid).not.toBeNull();
    expect(grid!.rows.length).toBeGreaterThan(0);
  });

  it('yields the cases the portal showed', () => {
    const grid = gridFromRows(lee.rows)!;
    const out: any = parseRecords(grid.headers, grid.rows);
    const records = Array.isArray(out) ? out : out.records;
    const numbers = records.map((r: any) => r.recordNumber);
    // Asserted against THIS fixture. An earlier draft asserted a record seen
    // in a different live run, which is not what this capture contains.
    expect(numbers).toContain('HEX2026-02218');
    expect(numbers).toContain('VIO2026-07703');
    expect(numbers).toContain('CPL2026-04615');
    expect(records.length).toBe(4);
  });

  it('keeps the addresses Lee does publish', () => {
    const grid = gridFromRows(lee.rows)!;
    const out: any = parseRecords(grid.headers, grid.rows);
    const records = Array.isArray(out) ? out : out.records;
    // Lee is the opposite of Hillsborough: it HAS an address column.
    expect(records.some((r: any) => r.address && /PALM/i.test(r.address))).toBe(true);
  });

  it('loses no populated row', () => {
    const grid = gridFromRows(lee.rows)!;
    const out: any = parseRecords(grid.headers, grid.rows);
    const records = Array.isArray(out) ? out : out.records;
    const populated = grid.rows.filter((r) => r.some((c) => c && c.trim())).length;
    expect(records.length).toBe(populated);
  });

  it('did not break Hillsborough, which has the opposite shape', () => {
    const grid = gridFromRows(hcfl.rows);
    expect(grid).not.toBeNull();
    const out: any = parseRecords(grid!.headers, grid!.rows);
    const records = Array.isArray(out) ? out : out.records;
    expect(records.map((r: any) => r.recordNumber)).toContain('HC-GEN-26-000865');
  });
});

describe('two headers still reject everything that is not a grid', () => {
  it('uses exactly record number and status', () => {
    expect(GRID_IDENTIFYING_HEADERS).toEqual(['record number', 'status']);
  });

  it('rejects the search form, whose labels carry colons', () => {
    expect(gridFromRows([['Record Number:', 'Status:'], ['', '']])).toBeNull();
  });

  it('rejects a document-sized furniture row', () => {
    const furniture = [Array.from({ length: 40 }, (_, i) =>
      ['record number', 'status'][i] ?? `col${i}`)];
    expect(gridFromRows(furniture)).toBeNull();
  });

  it('rejects a table that names neither', () => {
    expect(gridFromRows([['Date', 'Description'], ['1', '2']])).toBeNull();
  });

  it('rejects a table naming only one of them', () => {
    expect(gridFromRows([['Record Number', 'Description'], ['A-1', 'x']])).toBeNull();
    expect(gridFromRows([['Status', 'Description'], ['Open', 'x']])).toBeNull();
  });

  it('rejects a header row with no body rows at its width', () => {
    expect(gridFromRows([['Record Number', 'Status'], ['only-one-cell']])).toBeNull();
  });
});

describe('Nassau County: the portal said it found nothing', () => {
  it('is recognised as an explicit zero, not an unreadable page', () => {
    // "Notice: Your search returned no results. Please modify your search
    // criteria and try again." Before this, a working portal with a real zero
    // was reported as a failed read.
    expect(portalSaysNoRecords(nassau.bodyText)).toBe(true);
  });

  it('still treats a populated page as populated', () => {
    expect(portalSaysNoRecords('100+ Record results matching your search')).toBe(false);
    expect(portalSaysNoRecords('Showing 1-10 of 42')).toBe(false);
  });

  it('keeps the wordings it already knew', () => {
    expect(portalSaysNoRecords('0 Record results')).toBe(true);
    expect(portalSaysNoRecords('No records found')).toBe(true);
  });

  it('does not fire on the digit-boundary trap', () => {
    // "10 Record results" contains "0 Record results".
    expect(portalSaysNoRecords('10 Record results matching your search')).toBe(false);
  });

  it('does not fire on prose that merely mentions results', () => {
    expect(portalSaysNoRecords('Search results are displayed below. 3 Record results')).toBe(false);
    expect(portalSaysNoRecords('Use the search above to see results.')).toBe(false);
  });
});
