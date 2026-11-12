// Codex R3-02: on a tenant whose grid publishes no address column, the adapter
// emitted two instructions that cannot both be followed.
//
//   "Each row is prefixed with the address it is filed against - compare it
//    to <subject> before relying on that row."
//   "...these records cannot be narrowed to this property."
//
// On Hillsborough every recordAddress is null, so no prefix is ever emitted
// and the comparison the first note promises is impossible.
//
// The R3 tests missed this because they asserted the note HELPER in isolation
// and never the adapter's combined result. This one drives the real
// `runAccelaScrape` against the frozen Hillsborough grid through a stubbed
// page, and asserts the records AND the complete ordered notes.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runAccelaScrape } from '../worker/src/scrapers/accela.js';
import { JURISDICTIONS } from '../worker/src/scrapers/jurisdictions.js';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/hcfl-enforcement-grid.json', import.meta.url), 'utf8'),
) as { rows: string[][] };

/**
 * The least page that lets the real adapter run. `evaluate` is the one call
 * that carries data: it returns the frozen grid rows, so the parser under test
 * is the shipped parser working on the shipped shape.
 */
function stubPage(rows: string[][]) {
  const el = {
    count: async () => 1,
    first: () => el,
    isVisible: async () => true,
    fill: async () => {},
    click: async () => {},
    selectOption: async () => {},
    innerText: async () => '100+ Record results matching your search',
    textContent: async () => '100+ Record results matching your search',
    getAttribute: async () => null,
    all: async () => [el],
    nth: () => el,
  };
  return {
    goto: async () => {},
    fill: async () => {},
    click: async () => {},
    waitForSelector: async () => el,
    waitForNavigation: async () => {},
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    waitForFunction: async () => true,
    $$eval: async () => [],
    $eval: async () => null,
    $$: async () => [el],
    waitForResponse: async () => ({}),
    inputValue: async () => 'MAIN',
    innerText: async () => '100+ Record results matching your search Showing 1-10 of 100+',
    evaluate: async () => rows,
    locator: () => el,
    $: async () => el,
    setDefaultTimeout: () => {},
    on: () => {},
    url: () => 'https://aca-prod.accela.com/HCFL/Cap/CapHome.aspx?module=Enforcement',
  } as any;
}

/**
 * Codex R4-01: the published field is `recordAddress`, not `address`. My
 * earlier assertion used `v.address`, which is always undefined on a
 * violation, so `every(v => !v.address)` passed whatever the adapter
 * returned. A test that cannot fail is worse than no test, and it is what let
 * the mixed-grid defect through.
 */
const addressesOf = (r: any) => r.violations.map((v: any) => v.recordAddress ?? null);

/** Clone the fixture and reshape its address column. */
function rowsWith(opts: { label?: boolean; blankRows?: number[] }) {
  const rows = JSON.parse(JSON.stringify(fixture.rows)) as string[][];
  if (opts.label) rows[1][9] = 'Address';
  for (const i of opts.blankRows ?? []) rows[i][9] = '';
  return rows;
}

async function runWith(rows: string[][]) {
  const j: any = (JURISDICTIONS as any).hillsborough;
  return runAccelaScrape(
    {
      page: stubPage(rows),
      address: '10801 MAIN ST',
      folio: null,
      lat: null,
      lng: null,
      municipality: null,
      log: () => {},
    } as any,
    j,
  );
}

async function runHillsborough() {
  const j: any = (JURISDICTIONS as any).hillsborough;
  return runAccelaScrape(
    {
      page: stubPage(fixture.rows),
      address: '10801 MAIN ST',
      folio: null,
      lat: null,
      lng: null,
      municipality: null,
      log: (m: string) => { if (process.env.DBG) console.log("  >", m); },
    } as any,
    j,
  );
}

describe('a grid with no address column', () => {
  it('returns the records the portal showed', async () => {
    const r: any = await runHillsborough();
    expect(r.violations.length).toBeGreaterThanOrEqual(10);
    expect(r.violations.map((v: any) => v.caseNumber)).toContain('HC-GEN-26-000865');
  });

  it('publishes no row address, because there is none to publish', async () => {
    const r: any = await runHillsborough();
    // Asserted on the REAL published field. The earlier version used
    // `v.address`, which does not exist on a violation, so it passed
    // vacuously (Codex R4-01).
    const addrs = addressesOf(r);
    expect(addrs).toHaveLength(10);
    expect(addrs.every((a: string | null) => a === null)).toBe(true);
  });

  it('never promises an address prefix it cannot deliver', async () => {
    const r: any = await runHillsborough();
    const notes = r.notes.join('\n');
    expect(notes).not.toContain('Each row is prefixed with the address');
    expect(notes).not.toContain('compare it to');
  });

  it('says the limitation BEFORE anything that depends on it', async () => {
    const r: any = await runHillsborough();
    const missing = r.notes.findIndex((n: string) => /cannot be narrowed to this property/.test(n));
    const street = r.notes.findIndex((n: string) => /STREET NAME, not by parcel/.test(n));
    expect(missing).toBeGreaterThanOrEqual(0);
    expect(street).toBeGreaterThanOrEqual(0);
    // Order matters: it decides whether the reader has anything to compare.
    expect(missing).toBeLessThan(street);
  });

  it('still tells the reader what to do instead', async () => {
    const r: any = await runHillsborough();
    const street = r.notes.find((n: string) => /STREET NAME, not by parcel/.test(n))!;
    expect(street).toContain('does not publish an address for these rows');
    expect(street).toContain('Confirm each one on the portal');
  });
});

describe('a LABELLED address column with blank cells', () => {
  // Codex R4-01's reproduction: label the column, blank one row, leave the
  // other nine. `some(address)` called this "every row is prefixed".
  it('publishes the addresses that exist', async () => {
    const r: any = await runWith(rowsWith({ label: true, blankRows: [2] }));
    const addrs = addressesOf(r);
    expect(addrs[0]).toBeNull();
    expect(addrs.filter((a: string | null) => a).length).toBe(9);
  });

  it('never promises an address for every row', async () => {
    const r: any = await runWith(rowsWith({ label: true, blankRows: [2] }));
    const notes = r.notes.join('\n');
    expect(notes).not.toContain('Each row is prefixed with the address');
  });

  it('says how many rows cannot be checked, and says it first', async () => {
    const r: any = await runWith(rowsWith({ label: true, blankRows: [2] }));
    const missing = r.notes.findIndex((n: string) => /1 of the 10 .*carry no address/.test(n));
    const street = r.notes.findIndex((n: string) => /STREET NAME, not by parcel/.test(n));
    expect(missing).toBeGreaterThanOrEqual(0);
    expect(street).toBeGreaterThanOrEqual(0);
    expect(missing).toBeLessThan(street);
  });

  it('tells the reader which rows CAN be compared', async () => {
    const r: any = await runWith(rowsWith({ label: true, blankRows: [2] }));
    const street = r.notes.find((n: string) => /STREET NAME, not by parcel/.test(n))!;
    expect(street).toContain('9 of the 10 rows are prefixed');
    expect(street).toContain('The other 1 carry no address');
  });

  it('a labelled column with EVERY cell blank still warns', async () => {
    const all = Array.from({ length: 12 }, (_, i) => i + 2);
    const r: any = await runWith(rowsWith({ label: true, blankRows: all }));
    expect(addressesOf(r).every((a: string | null) => a === null)).toBe(true);
    const notes = r.notes.join('\n');
    expect(notes).not.toContain('Each row is prefixed with the address');
    expect(notes).toMatch(/carry no address|does not publish an address/);
  });

  it('a fully addressed column keeps the original comparison guidance', async () => {
    const r: any = await runWith(rowsWith({ label: true }));
    expect(addressesOf(r).every((a: string | null) => a)).toBe(true);
    const street = r.notes.find((n: string) => /STREET NAME, not by parcel/.test(n))!;
    expect(street).toContain('Each row is prefixed with the address');
  });
});
