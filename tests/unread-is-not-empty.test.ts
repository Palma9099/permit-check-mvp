// A failed read must never produce the same value as an empty read.
//
// Codex's round-1 review of the adapter work found six separate paths that all
// broke this one rule, and the rule is the whole product: "nothing open" is the
// single answer this report must never get wrong. Each test below reproduces
// one of those findings with the trigger it named.
//
//   F-01  unknown municipality cleared a county-only search  (code-authority.test.ts)
//   F-02  a permit layer answering vouched for a code layer that did not
//   F-03  Miami-Dade marked a total code-source failure as checked
//   F-04  the email printed unread sources as zero and dropped every caveat
//   F-05  Palm Beach accepted a missing grid beside a positive record count
//   F-06  EnerGov read {Success:true,Result:{}} as a confirmed zero
//
// What they share: a `catch` or a `?:` that turns "we could not read this"
// into `[]`, after which nothing downstream can tell the difference.

import { afterEach, describe, expect, it } from 'vitest';
import { fetchMunicipalPermits } from '@/lib/counties/municipal-permits';
import {
  installArcgisStub,
  mdPaRecord,
  MD_ARCGIS,
  MD_PA,
  MD_PERMIT_LAYER,
  type ArcgisStub,
} from './arcgis-stub';
import { miamiDadeAdapter } from '@/lib/counties/miami-dade-adapter';
import { codeVerdict, verdictTone } from '@/lib/code-authority';
import { parseSearchResponse, countOf } from '../worker/src/scrapers/energov-parse.js';
import { readMatchesReport, shortfallNote } from '../worker/src/scrapers/pbc-parse.js';
import { buildEmail } from '../worker/src/report.js';
import type { ScrapeResult } from '../worker/src/types.js';

// ---------------------------------------------------------------------------
// F-06: EnerGov schema loss failed open.
// ---------------------------------------------------------------------------
describe('F-06: an unrecognised EnerGov response is not zero cases', () => {
  it('refuses {Success:true, Result:{}}', () => {
    // Codex's exact trigger. Result is truthy, so the old guard passed it, and
    // `Array.isArray(r.EntityResults) ? ... : []` then produced a confident
    // empty case list with ok:true.
    const p = parseSearchResponse({ Success: true, Result: {} });
    expect(p.ok).toBe(false);
    expect(p.cases).toEqual([]);
  });

  it('refuses a Result whose EntityResults is not an array', () => {
    expect(parseSearchResponse({ Success: true, Result: { EntityResults: null, CodeCasesFound: 0 } }).ok).toBe(false);
    expect(parseSearchResponse({ Success: true, Result: { EntityResults: {}, CodeCasesFound: 0 } }).ok).toBe(false);
  });

  it('refuses a missing count, because a missing count is not a zero', () => {
    const p = parseSearchResponse({ Success: true, Result: { EntityResults: [] } });
    expect(p.ok).toBe(false);
  });

  it('still accepts a real confirmed zero', () => {
    const p = parseSearchResponse({
      Success: true,
      Result: { EntityResults: [], CodeCasesFound: 0, PermitsFound: 0, TotalFound: 0 },
    });
    expect(p.ok).toBe(true);
    expect(p.cases).toEqual([]);
    expect(p.counts.codeCases).toBe(0);
  });

  it('refuses a count that contradicts the rows it sent', () => {
    // Fewer reported than delivered is incoherent; do not clear on it.
    const p = parseSearchResponse({
      Success: true,
      Result: {
        EntityResults: [
          { CaseNumber: 'A', ModuleName: 5 },
          { CaseNumber: 'B', ModuleName: 5 },
        ],
        CodeCasesFound: 1,
      },
    });
    expect(p.ok).toBe(false);
  });

  it('accepts more reported than delivered, which is just paging', () => {
    const p = parseSearchResponse({
      Success: true,
      Result: { EntityResults: [{ CaseNumber: 'A', ModuleName: 5 }], CodeCasesFound: 500 },
    });
    expect(p.ok).toBe(true);
    expect(p.counts.codeCases).toBe(500);
  });

  it('separates a missing count from a reported zero', () => {
    expect(countOf(undefined)).toBeNull();
    expect(countOf(null)).toBeNull();
    expect(countOf('')).toBeNull();
    expect(countOf('nope')).toBeNull();
    expect(countOf(-1)).toBeNull();
    expect(countOf(1.5)).toBeNull();
    expect(countOf(0)).toBe(0);
    expect(countOf('21537')).toBe(21537);
  });
});

// ---------------------------------------------------------------------------
// F-05: Palm Beach printed zero beside the portal's own positive count.
// ---------------------------------------------------------------------------
describe('F-05: a positive record count with no rows read is a refusal', () => {
  it('refuses when the portal reports more than we parsed', () => {
    // Codex's trigger: PCN 00-41-43-10-00-000-4180, "Total Records: 1", grid
    // selectors no longer match, so zero rows parsed.
    expect(readMatchesReport(0, 1)).toBe(false);
    expect(readMatchesReport(3, 7)).toBe(false);
  });

  it('accepts a genuine zero the portal itself reported', () => {
    expect(readMatchesReport(0, 0)).toBe(true);
  });

  it('accepts reading at least what was reported', () => {
    expect(readMatchesReport(1, 1)).toBe(true);
    expect(readMatchesReport(9, 7)).toBe(true);
  });

  it('does not refuse when the portal printed no number at all', () => {
    // The label without a number still proves the search executed. Refusing
    // here would make every clean Palm Beach parcel unreadable.
    expect(readMatchesReport(0, null)).toBe(true);
    expect(readMatchesReport(4, null)).toBe(true);
  });

  it('explains a shortfall in words a reader can act on', () => {
    const n = shortfallNote(0, 7, 'code compliance cases');
    expect(n).toMatch(/reported 7/);
    expect(n).toMatch(/incomplete/i);
    expect(n).toMatch(/nothing here should be read as a clear result/i);
  });
});

// ---------------------------------------------------------------------------
// F-04: the delivered email. The worst of the six, because it is the surface
// the customer actually reads.
// ---------------------------------------------------------------------------
const base = (over: Partial<ScrapeResult> = {}): ScrapeResult => ({
  ok: true,
  county: 'miami-dade',
  matchedAddress: '135 W 60 ST',
  folio: '0421310020800',
  permits: [],
  violations: [],
  notes: [],
  portalLinks: [{ label: 'portal', url: 'https://example.gov/search' }],
  source: 'test',
  ...over,
});

describe('F-04: the email never prints an unread source as zero', () => {
  it('does not say "none found" in TEXT when the read failed', () => {
    const { text } = buildEmail(
      base({
        ok: false,
        notes: ['City of Hialeah runs EnerGov but does not publish code cases on its public portal.'],
      }),
      '135 W 60 ST',
    );
    expect(text).not.toMatch(/none found/);
    expect(text).toMatch(/NOT searched/);
    expect(text).toMatch(/WE COULD NOT FULLY READ/);
  });

  it('carries every note into the plain text, not just the HTML', () => {
    // The text alternative used to drop result.notes entirely, so an authority
    // caveat reached only half the audience.
    const note = 'City of Miami Beach reports 21537 matching code cases but returns them a page at a time.';
    const { text, html } = buildEmail(base({ notes: [note] }), '1 WASHINGTON AVE');
    expect(text).toContain(note);
    expect(html).toContain('page at a time');
  });

  it('keeps a truncation disclosure beside the single case it printed', () => {
    // Codex trigger B: one of 20 cases read, 19 silently missing from the text.
    const { text } = buildEmail(
      base({
        violations: [{ caseNumber: 'C-1', status: 'Open', openedDate: null, closedDate: null, description: 'x', lastAction: null }],
        notes: ['The portal reports 20 matching code cases but returns them a page at a time; 1 was read here.'],
      }),
      'x',
    );
    expect(text).toMatch(/Code-enforcement cases \(1\)/);
    expect(text).toMatch(/20 matching code cases/);
  });

  it('labels a code-only adapter\'s untouched permit side as unsearched', () => {
    // EnerGov searches module 5 only. "No permits found" was a claim about a
    // search that never ran.
    const { text, html } = buildEmail(
      base({ permitsChecked: false, violationsChecked: true }),
      'x',
    );
    expect(text).toMatch(/Permits \(not searched\)/);
    expect(text).not.toMatch(/Permits \(0\)/);
    expect(html).toMatch(/permit history was NOT searched/i);
  });

  it('still reports a real confirmed zero as none found', () => {
    const { text } = buildEmail(base({ permitsChecked: true, violationsChecked: true }), 'x');
    expect(text).toMatch(/Permits \(0\)/);
    expect(text).toMatch(/none found/);
    expect(text).not.toMatch(/NOT searched/);
  });

  it('defaults to the overall ok flag when an adapter sets no axis flags', () => {
    // Every adapter written before these flags existed must behave as before.
    const okResult = buildEmail(base(), 'x');
    expect(okResult.text).toMatch(/none found/);
    const failed = buildEmail(base({ ok: false }), 'x');
    expect(failed.text).toMatch(/NOT searched/);
  });
});

// ---------------------------------------------------------------------------
// F-02: the permit layer vouching for the code layer.
//
// Codex's trigger: Fort Lauderdale's permit endpoint answers with a row while
// its code endpoint answers HTTP 200 carrying {error:{code:503}}. queryByPoint
// collapsed that error to [], the permit row set found=true, and the hardcoded
// codeCasesSupported:true then told the orchestrator the city's code records
// had been searched. Nothing read them.
// ---------------------------------------------------------------------------
describe('F-02: a city permit layer cannot certify its code layer', () => {
  const FTL_MUNI_PERMITS = 'gisdata/MapServer/27/query';
  const FTL_MUNI_CODE = 'gisdata/MapServer/30/query';
  const PERMIT_ROW = { PERMITID: 'P1', PERMITSTAT: 'Final', PERMITTYPE: 'BLD' };

  let stub: ArcgisStub | null = null;
  afterEach(() => {
    stub?.restore();
    stub = null;
  });

  it('does not mark code searched when the code layer errors inside a 200', () => {
    stub = installArcgisStub([
      { match: FTL_MUNI_PERMITS, rows: [PERMIT_ROW] },
      { match: FTL_MUNI_CODE, errorBody: { code: 503, message: 'Code source unavailable' } },
    ]);
    return fetchMunicipalPermits({ countyKey: 'broward', lat: 26.12, lng: -80.14 }).then((r) => {
      expect(r.found).toBe(true);
      expect(r.permits).toHaveLength(1);
      // The city publishes code cases...
      expect(r.codeCasesSupported).toBe(true);
      // ...but we did not read them on this run, and that is the flag the
      // orchestrator gates cityCodeChecked on.
      expect(r.codeCasesRead).toBe(false);
      expect(r.notes.join(' ')).toMatch(/did not answer/i);
      expect(r.notes.join(' ')).toMatch(/not the same as the property being clear/i);
    });
  });

  it('does not mark code searched when the code layer drops the connection', () => {
    stub = installArcgisStub([
      { match: FTL_MUNI_PERMITS, rows: [PERMIT_ROW] },
      { match: FTL_MUNI_CODE, throws: 'fetch failed' },
    ]);
    return fetchMunicipalPermits({ countyKey: 'broward', lat: 26.12, lng: -80.14 }).then((r) => {
      expect(r.codeCasesRead).toBe(false);
    });
  });

  it('does not mark code searched on a plain HTTP failure', () => {
    stub = installArcgisStub([
      { match: FTL_MUNI_PERMITS, rows: [PERMIT_ROW] },
      { match: FTL_MUNI_CODE, status: 500 },
    ]);
    return fetchMunicipalPermits({ countyKey: 'broward', lat: 26.12, lng: -80.14 }).then((r) => {
      expect(r.codeCasesRead).toBe(false);
    });
  });

  it('DOES mark code searched when the code layer answers with nothing', () => {
    // A confirmed empty code layer is a real result and must stay usable, or
    // the fix would make every clean Fort Lauderdale property unreadable.
    stub = installArcgisStub([
      { match: FTL_MUNI_PERMITS, rows: [PERMIT_ROW] },
      { match: FTL_MUNI_CODE, rows: [] },
    ]);
    return fetchMunicipalPermits({ countyKey: 'broward', lat: 26.12, lng: -80.14 }).then((r) => {
      expect(r.codeCasesRead).toBe(true);
      expect(r.notes.join(' ')).not.toMatch(/did not answer/i);
    });
  });

  it('reports a clean property even when only the code layer answered', () => {
    // Permits failing must not suppress a good code read either.
    stub = installArcgisStub([
      { match: FTL_MUNI_PERMITS, status: 503 },
      { match: FTL_MUNI_CODE, rows: [] },
    ]);
    return fetchMunicipalPermits({ countyKey: 'broward', lat: 26.12, lng: -80.14 }).then((r) => {
      expect(r.found).toBe(true);
      expect(r.codeCasesRead).toBe(true);
      expect(r.notes.join(' ')).toMatch(/"no permits" is not confirmed/i);
    });
  });
});

// ---------------------------------------------------------------------------
// F-03: Miami-Dade marked a total code-source failure as checked.
//
// Codex's trigger: the Property Appraiser resolves the parcel, every violation
// layer fails. The adapter caught that into empty arrays plus
// failed:['all violation sources'], then emitted codeCasesChecked:true
// unconditionally. A limitation note said "not confirmed" while the tile said
// green "None open", and the tile is what a reader believes.
// ---------------------------------------------------------------------------
describe('F-03: Miami-Dade will not certify code records it could not read', () => {
  // The Property Appraiser proxy serves two Operations from one host, so each
  // needs its own route: GetAddress hands back the candidate list (the folio
  // must be 13 digits or the adapter discards it), GetPropertySearch hands back
  // the record. Both have to answer, or the adapter returns found:false and
  // the assertions below would pass without touching the code gate at all.
  const FOLIO = '0421310020800';
  const PA_RESOLVES = [
    {
      match: 'Operation=GetAddress',
      json: { MinimumPropertyInfos: [{ Strap: FOLIO, SiteAddress: '123 TEST ST' }] },
    },
    { match: MD_PA, json: mdPaRecord('UNINCORPORATED') },
  ];

  let stub: ArcgisStub | null = null;
  afterEach(() => {
    stub?.restore();
    stub = null;
  });

  const run = () =>
    miamiDadeAdapter.run({
      address: '123 TEST ST',
      zip: '33012',
      lat: 25.86,
      lng: -80.3,
      typedAddress: '123 TEST ST',
    } as any);

  it('reports codeCasesChecked false when every violation layer fails', async () => {
    stub = installArcgisStub([
      ...PA_RESOLVES,
      // Every county layer is locked behind a token: HTTP 200 with {error}.
      { match: MD_ARCGIS, errorBody: { code: 499, message: 'Token Required' } },
      { match: MD_PERMIT_LAYER, rows: [] },
    ]);
    const r = await run();
    // The parcel MUST resolve, or this test proves nothing about the code
    // gate - it would just be asserting on an empty result.
    expect(r.found).toBe(true);
    expect(r.codeCasesChecked).toBe(false);
    expect(r.codeCasesOpen).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/not confirmed/i);
  });

  it('a verdict built from that result is never green', async () => {
    stub = installArcgisStub([
      ...PA_RESOLVES,
      { match: MD_ARCGIS, errorBody: { code: 499, message: 'Token Required' } },
      { match: MD_PERMIT_LAYER, rows: [] },
    ]);
    const r = await run();
    expect(r.found).toBe(true);
    // The county is the authority here and it was NOT read, so even with a
    // known municipality the verdict must withhold 'clear'.
    const v = codeVerdict(
      {
        municipality: 'UNINCORPORATED',
        cityGoverns: false,
        cityChecked: false,
        countyChecked: r.codeCasesChecked === true,
        municipalityKnown: true,
      },
      0,
      0,
    );
    expect(v.kind).toBe('unchecked');
    expect(verdictTone(v)).not.toBe('green');
  });
});
