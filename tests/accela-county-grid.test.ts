// Hillsborough County's Enforcement grid was unreadable to the adapter while
// the portal was answering normally with "100+ Record results matching your
// search". 1,008,349 unincorporated residents read as "no readable result".
//
// The fixture is the real grid, captured from the live portal as STRUCTURED
// CELLS (tests/fixtures/hcfl-enforcement-grid.json), not flattened text, so
// the parser can be replayed against it with no browser and no network.
//
// What the capture showed, and what no amount of reading the page would have:
//
//   headers  the table's first <tr> is the "Showing 1-10 of 100+" banner
//   rows[1]  the REAL column names, with a blank first AND last cell
//   rows[2+] the data, and the ADDRESS sits in that trailing blank-headed
//            column
//
// So the grid has an address, it just never labels it. `gridFromRows` already
// handles the banner offset by scanning for the row whose cells ARE the
// headers. The single thing that rejected it was requiring the literal word
// "address" to identify a grid.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  gridFromRows,
  parseRecords,
  gridHasAddressColumn,
  addressColumnMissingNote,
  GRID_IDENTIFYING_HEADERS,
  GRID_HEADERS,
} from '../worker/src/scrapers/accela-parse.js';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/hcfl-enforcement-grid.json', import.meta.url), 'utf8'),
) as { headers: string[]; rows: string[][]; source: string };

describe('the real Hillsborough Enforcement grid', () => {
  it('is identified at all', () => {
    const grid = gridFromRows(fixture.rows);
    // Before the fix this was null, and null is what produced "no readable
    // result" for a county whose portal was answering.
    expect(grid).not.toBeNull();
    expect(grid!.rows.length).toBeGreaterThan(0);
  });

  it('yields the records the portal actually showed', () => {
    const grid = gridFromRows(fixture.rows)!;
    const out: any = parseRecords(grid.headers, grid.rows);
    const records = Array.isArray(out) ? out : out.records;

    expect(records.length).toBeGreaterThanOrEqual(10);
    const numbers = records.map((r: any) => r.recordNumber);
    // Real cases read off the live portal, including an OPEN one.
    expect(numbers).toContain('HC-GEN-26-000865');
    expect(numbers).toContain('HC-WE-26-004855');
    expect(records.find((r: any) => r.recordNumber === 'HC-GEN-26-000865').status).toBe('Open');
  });

  it('loses no populated row', () => {
    // A row that carries text but yields no record is a parse failure on a
    // populated grid, not an absence of records. That is how a property with
    // open cases reads as clean.
    const grid = gridFromRows(fixture.rows)!;
    const out: any = parseRecords(grid.headers, grid.rows);
    const records = Array.isArray(out) ? out : out.records;
    const populated = grid.rows.filter((r) => r.some((c) => c && c.trim())).length;
    expect(records.length).toBe(populated);
  });
});

describe('identification stays strict without the address word', () => {
  it('still requires record number, record type and status', () => {
    expect(GRID_IDENTIFYING_HEADERS).toEqual(['record number', 'record type', 'status']);
    // Address is still wanted, just not used to identify the grid.
    expect(GRID_HEADERS).toContain('address');
  });

  it('rejects the search form, whose labels carry colons', () => {
    const form = [
      ['Record Number:', 'Record Type:', 'Status:'],
      ['', '', ''],
    ];
    expect(gridFromRows(form)).toBeNull();
  });

  it('rejects a document-sized furniture row', () => {
    const furniture = [Array.from({ length: 40 }, (_, i) =>
      ['record number', 'record type', 'status'][i] ?? `col${i}`)];
    expect(gridFromRows(furniture)).toBeNull();
  });

  it('rejects a table that names none of them', () => {
    expect(gridFromRows([['Date', 'Description'], ['1', '2']])).toBeNull();
  });
});

describe('a grid with no address column says so', () => {
  it('detects the missing column on the real fixture', () => {
    const grid = gridFromRows(fixture.rows)!;
    expect(gridHasAddressColumn(grid.headers)).toBe(false);
  });

  it('detects a present one', () => {
    expect(gridHasAddressColumn(['Record Number', 'Address', 'Status'])).toBe(true);
  });

  it('warns that the records cannot be narrowed to the property', () => {
    const note = addressColumnMissingNote('Hillsborough County');
    expect(note).toContain('Hillsborough County');
    expect(note).toContain('cannot be narrowed to this property');
    // It must not imply the list is about the subject parcel.
    expect(note).toContain('searched street');
  });
});
