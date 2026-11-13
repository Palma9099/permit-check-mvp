// Miami-Dade's deep scan was a generic BROWSER scrape of a permit portal with
// no code search configured at all, so the largest unincorporated population
// in Florida read as a failed portal. The county publishes its code cases as
// ArcGIS open data, which the instant report has read all along.
//
// These exercise the four per-layer mappers against REAL captured rows. Each
// layer disagrees with the others on nearly every field name, which is why
// each gets its own mapper rather than one "try these names" pass: a generic
// pass silently drops whatever it fails to guess.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mapCodeCompliance, mapBuildingViolation, mapEnergovCase } from '../worker/src/scrapers/miami-dade.js';

const fx = JSON.parse(
  readFileSync(new URL('./fixtures/miami-dade-code-layers.json', import.meta.url), 'utf8'),
) as { folios: Record<string, Record<string, any[]>> };

const rows = (folio: string, layer: string) => fx.folios[folio][layer] ?? [];

describe('code compliance rows, which carry the lien columns', () => {
  const open = rows('3021270110691', 'CodeComplianceViolation_Open_View');

  it('the fixture actually holds open compliance rows', () => {
    // Guard against a fixture that silently stops exercising this mapper.
    expect(open.length).toBeGreaterThan(0);
  });

  it('reads the case, its status and when it opened', () => {
    const v = mapCodeCompliance(open[0], 'Open')!;
    expect(v.caseNumber).toBeTruthy();
    expect(v.status).toBeTruthy();
    expect(v.openedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('publishes a recorded lien when the row carries one', () => {
    // A recorded lien attaches to the property and follows it to the next
    // owner, so book and page are the most consequential fields on the row.
    // These columns are space-padded: an empty one is '     ', which is
    // TRUTHY in JS. An earlier version of this test treated that as a lien and
    // then failed on the adapter correctly publishing none.
    const filled = (v: unknown) => String(v ?? '').trim().length > 0;
    const withLien = Object.values(fx.folios)
      .flatMap((layers) => [
        ...(layers['CodeComplianceViolation_Open_View'] ?? []),
        ...(layers['CodeComplianceViolation_ClosedPast5Years_View'] ?? []),
      ])
      .find((a) => filled(a.LN_RECBOOK) && filled(a.LN_RECPAGE));

    if (!withLien) {
      // No lien row in this capture: assert the shape instead of pretending.
      const v = mapCodeCompliance(
        { CASE_NUM: 'X', LN_RECBOOK: '1234 ', LN_RECPAGE: ' 56', LN_RECDATE: '01/15/2020' },
        'Open',
      )!;
      expect(v.details).toContain('book 1234');
      expect(v.details).toContain('page 56');
      // LN_RECDATE is a STRING field, so a real date must survive verbatim.
      expect(v.details).toContain('01/15/2020');
      return;
    }
    const v = mapCodeCompliance(withLien, 'Open')!;
    expect(v.details).toContain('Lien recorded');
    expect(v.details).toContain(String(withLien.LN_RECBOOK).trim());
  });

  it('says nothing about a lien when the row has none', () => {
    expect(mapCodeCompliance({ CASE_NUM: 'Y', STAT_DESC: 'Open' }, 'Open')!.details).toBeNull();
  });

  it('treats space-padded empty lien columns as no lien', () => {
    // '     ' is truthy. Publishing "Lien recorded at book , page " would be
    // an invented encumbrance on someone's property.
    const v = mapCodeCompliance(
      { CASE_NUM: 'Z', LN_RECBOOK: '     ', LN_RECPAGE: '    ', LN_RECDATE: '          ' },
      'Open',
    )!;
    expect(v.details).toBeNull();
  });

  it('drops a row with no case number rather than publishing a blank', () => {
    expect(mapCodeCompliance({ STAT_DESC: 'Open' }, 'Open')).toBeNull();
  });
});

describe('building violations, where the status is not a column', () => {
  const bv = rows('3040210340010', 'Open_Building_Violations');

  it('the fixture holds a building violation row', () => {
    expect(bv.length).toBeGreaterThan(0);
  });

  it('describes the VIOLATION, not a party name', () => {
    // VIOL_NAME holds a party name ("AMERICAN LARA DREAM LLC") or a
    // placeholder ("REFERENCE ONLY"). An earlier draft preferred it and put a
    // company's name where the reader looks for what was cited.
    const v = mapBuildingViolation(bv[0])!;
    expect(v.description).toBe(String(bv[0].CASE_TYPE).trim());
    expect(v.description).not.toBe(String(bv[0].VIOL_NAME ?? '').trim());
  });

  it('never publishes VIOL_NAME in any field', () => {
    const name = String(bv[0].VIOL_NAME ?? '').trim();
    if (!name) return;
    const v = mapBuildingViolation(bv[0])!;
    expect(JSON.stringify(v)).not.toContain(name);
  });

  it('reads the status from the data, not from the layer name', () => {
    expect(mapBuildingViolation({ CASE_NUM: 'A', CLOSED_DATE: null })!.status).toBe('Open');
    expect(mapBuildingViolation({ CASE_NUM: 'A', CLOSED_DATE: 1700000000000 })!.status).toBe('Closed');
  });
});

describe('EnerGov cases', () => {
  const eg = rows('3022060300001', 'EnergovCodeCasePublicView');

  it('the fixture holds an EnerGov row', () => {
    expect(eg.length).toBeGreaterThan(0);
  });

  it('reads its own field names, which differ from the other layers', () => {
    const v = mapEnergovCase(eg[0])!;
    expect(v.caseNumber).toBe(String(eg[0].CASENUMBER).trim());
    expect(v.status).toBe(String(eg[0].STATUS).trim());
  });

  it('drops a row with no case number', () => {
    expect(mapEnergovCase({ STATUS: 'Open' })).toBeNull();
  });
});

describe('dates', () => {
  it('turns ArcGIS epoch milliseconds into a date', () => {
    expect(mapEnergovCase({ CASENUMBER: 'C', OPENEDDATE: 1700000000000 })!.openedDate)
      .toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('treats 0 and nonsense as no date, not 1970', () => {
    expect(mapEnergovCase({ CASENUMBER: 'C', OPENEDDATE: 0 })!.openedDate).toBeNull();
    expect(mapEnergovCase({ CASENUMBER: 'C', OPENEDDATE: 'x' })!.openedDate).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Codex R8. Two P1 false zeros and a merge that discarded recorded liens, all
// reproduced here with its own cases before being fixed.
// ---------------------------------------------------------------------------

import { mergeByIdentity } from '../worker/src/scrapers/miami-dade.js';

describe('a merge that cannot lose evidence', () => {
  it("keeps the second row's description AND its lien", () => {
    // Codex's reproduction: same case, same status, different descriptions,
    // book and page only on the second. The old key collapsed these to one
    // record carrying neither.
    const out = mergeByIdentity([
      { source: 'L', v: { caseNumber: 'A', status: 'Open', openedDate: null, closedDate: null, description: 'Overgrowth', lastAction: null, details: null } as any },
      { source: 'L', v: { caseNumber: 'A', status: 'Open', openedDate: null, closedDate: null, description: 'Unsafe structure', lastAction: null, details: 'Lien recorded at book 1234, page 56' } as any },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].description).toContain('Overgrowth');
    expect(out[0].description).toContain('Unsafe structure');
    expect(out[0].details).toContain('book 1234');
  });

  it('never merges across layers, which are not shown to share a namespace', () => {
    const out = mergeByIdentity([
      { source: 'LayerOne', v: { caseNumber: 'A', status: 'Open' } as any },
      { source: 'LayerTwo', v: { caseNumber: 'A', status: 'Open' } as any },
    ]);
    expect(out).toHaveLength(2);
  });

  it('fills a gap from a later row rather than dropping it', () => {
    const out = mergeByIdentity([
      { source: 'L', v: { caseNumber: 'B', status: 'Open', details: null } as any },
      { source: 'L', v: { caseNumber: 'B', status: null, details: 'Lien recorded at book 9, page 9' } as any },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('Open');
    expect(out[0].details).toContain('book 9');
  });

  it('does not duplicate an identical value', () => {
    const out = mergeByIdentity([
      { source: 'L', v: { caseNumber: 'C', status: 'Open' } as any },
      { source: 'L', v: { caseNumber: 'C', status: 'Open' } as any },
    ]);
    expect(out[0].status).toBe('Open');
  });

  it('keeps the order rows arrived in', () => {
    const out = mergeByIdentity([
      { source: 'L', v: { caseNumber: 'X' } as any },
      { source: 'L', v: { caseNumber: 'Y' } as any },
    ]);
    expect(out.map((r) => r.caseNumber)).toEqual(['X', 'Y']);
  });
});
