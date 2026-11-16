// A capped read is not the whole list, in the three places the last round
// disclosed and did not fix.
//
// PR #29 closed this for the Miami-Dade permit paths and the statewide parcel
// roll. Three siblings were named as still open, each needing its own decision
// about what its callers claim, because the refusal has to match the claim:
//
//   lien-providers/city-sources.ts  THROWS. Its own header already required it
//                                   ("MUST throw when its source does not
//                                   answer"), and a lien search that misses an
//                                   open case is the whole failure mode.
//   counties/municipal-permits.ts   REPORTS UNRELIABLE. It already separates
//                                   "did not answer" from "genuinely empty"
//                                   through LayerRead.ok, and the report turns
//                                   ok:false into a note saying the source was
//                                   not searched. A partial answer belongs in
//                                   that same channel, with wording that says
//                                   which of the two happened.
//   counties/county-property.ts     REPORTS UNKNOWN (null). Null there falls
//                                   back to the statewide roll, which already
//                                   fails closed, and then to an honest "could
//                                   not resolve a parcel" line.
//
// Every test asserts BOTH directions. Without the second half, "refuse
// everything" would pass and the product's real answers would be gone.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { queryLayer } from '@/lib/arcgis';
import { getCitySource } from '@/lib/lien-providers/city-sources';
import { fetchMunicipalPermits } from '@/lib/counties/municipal-permits';
import { fetchCountyProperty } from '@/lib/counties/county-property';

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
  vi.restoreAllMocks();
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** Answer every URL with the same body. */
const serveAll = (body: unknown) => {
  globalThis.fetch = (async () => json(body)) as any;
};

/** Answer by URL substring; the first match wins, default is a complete empty. */
const serveBy = (routes: Array<[string, unknown]>, fallback: unknown = { features: [] }) => {
  globalThis.fetch = (async (u: any) => {
    const url = String(u);
    for (const [needle, body] of routes) if (url.includes(needle)) return json(body);
    return json(fallback);
  }) as any;
};

const TRUNCATED = { features: [], exceededTransferLimit: true };
const row = (attrs: any) => ({ attributes: attrs });

// ---------------------------------------------------------------------------
// The shared contract. queryLayer returns a bare array, so it throws the
// response envelope away and no caller through it could see rows held back.
// ---------------------------------------------------------------------------
describe('queryLayer: completeness is required unless the caller says otherwise', () => {
  it('refuses a truncated answer by default, even with rows in it', async () => {
    serveAll({ features: [row({ A: '1' })], exceededTransferLimit: true });
    await expect(queryLayer('https://x/0', { label: 't' })).rejects.toThrow(/partial result/i);
  });

  it('refuses a truncated EMPTY answer by default', async () => {
    serveAll(TRUNCATED);
    await expect(queryLayer('https://x/0', { label: 't' })).rejects.toThrow(/empty partial/i);
  });

  it('refuses on the geojson-nested flag', async () => {
    serveAll({ features: [row({ A: '1' })], properties: { exceededTransferLimit: true } });
    await expect(queryLayer('https://x/0', { label: 't' })).rejects.toThrow(/properties\.exceededTransferLimit/);
  });

  it('refuses on a continuation token', async () => {
    serveAll({ features: [row({ A: '1' })], resultPaginationToken: 'tok' });
    await expect(queryLayer('https://x/0', { label: 't' })).rejects.toThrow(/resultPaginationToken/);
  });

  // The other direction: real answers must still come back.
  it('returns the rows of a complete answer', async () => {
    serveAll({ features: [row({ A: '1' }), row({ A: '2' })], exceededTransferLimit: false });
    await expect(queryLayer('https://x/0', { label: 't' })).resolves.toHaveLength(2);
  });

  it('returns an honest empty for a complete empty answer', async () => {
    serveAll({ features: [] });
    await expect(queryLayer('https://x/0', { label: 't' })).resolves.toEqual([]);
  });

  it('allows a sample read to see rows held back behind the one it wanted', async () => {
    serveAll({ features: [row({ A: '1' })], exceededTransferLimit: true });
    const rows = await queryLayer('https://x/0', { label: 't', resultRecordCount: 1, completeness: 'sample' });
    expect(rows).toHaveLength(1);
  });

  it('still refuses a truncated EMPTY answer on a sample read', async () => {
    // The dangerous case: an empty answer is the one a caller turns into
    // "nothing is there", and a truncated empty response does not show that.
    serveAll(TRUNCATED);
    await expect(
      queryLayer('https://x/0', { label: 't', resultRecordCount: 1, completeness: 'sample' }),
    ).rejects.toThrow(/empty partial/i);
  });

  it('lets a sample read return an honest empty when the answer was complete', async () => {
    serveAll({ features: [] });
    await expect(
      queryLayer('https://x/0', { label: 't', resultRecordCount: 1, completeness: 'sample' }),
    ).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// city-sources.ts: a lien search over-reports and never misses, so a server
// that kept rows back fails the read.
// ---------------------------------------------------------------------------
describe('city lien sources: a capped list is not the open-case list', () => {
  const FTL_PARCEL_ROW = { features: [row({ FOLIO: '494235010010', PARCELID: '4235010010' })] };
  const ftl = () => getCitySource('broward', 'FORT LAUDERDALE')!;

  it('Fort Lauderdale code cases refuse a truncated answer', async () => {
    serveBy([['/Accela/Accela/MapServer/2', FTL_PARCEL_ROW],
             ['/CodeCaseTracker/', { features: [row({ CASENUM: 'C-1' })], exceededTransferLimit: true }]]);
    await expect(ftl().codeCases!('494235010010')).rejects.toThrow(/partial result/i);
  });

  it('Fort Lauderdale permits refuse a truncated answer', async () => {
    serveBy([['/Accela/Accela/MapServer/2', FTL_PARCEL_ROW],
             ['/BuildingPermitTracker/', { features: [row({ PERMITID: 'P-1' })], resultPaginationToken: 'tok' }]]);
    await expect(ftl().permits!('494235010010')).rejects.toThrow(/partial result/i);
  });

  it('a truncated EMPTY parcel lookup refuses instead of reporting no cases', async () => {
    // `if (!pid) return []` turned a failed parcel lookup into an empty CASE
    // list, which the provider reads as clear. This is that path.
    serveBy([['/Accela/Accela/MapServer/2', TRUNCATED]]);
    await expect(ftl().codeCases!('494235010010')).rejects.toThrow(/empty partial/i);
  });

  it('Hollywood permits refuse a truncated answer', async () => {
    serveBy([['maps.hollywoodfl.org', { features: [row({ RECORD_ID: 'R-1' })], exceededTransferLimit: true }]]);
    await expect(getCitySource('broward', 'HOLLYWOOD')!.permits!('514210010010')).rejects.toThrow(/partial result/i);
  });

  it('City of Miami permits refuse a truncated answer', async () => {
    serveBy([['Building_Permits_Since_2014', { features: [row({ PermitNumber: 'B-1' })], exceededTransferLimit: true }]]);
    await expect(getCitySource('miami-dade', 'MIAMI')!.permits!('0141230750090')).rejects.toThrow(/partial result/i);
  });

  // The other direction: complete answers still produce the lines.
  it('still reports a real open case from a complete answer', async () => {
    serveBy([['/Accela/Accela/MapServer/2', FTL_PARCEL_ROW],
             ['/CodeCaseTracker/', { features: [row({ CASENUM: 'C-9', CASETYPE: 'UNSAFE STRUCTURE' })] }]]);
    const lines = await ftl().codeCases!('494235010010');
    expect(lines).toHaveLength(1);
    expect(lines[0].title).toMatch(/C-9/);
  });

  it('still reports a real confirmed zero from a complete empty answer', async () => {
    serveBy([['/Accela/Accela/MapServer/2', FTL_PARCEL_ROW],
             ['/CodeCaseTracker/', { features: [] }]]);
    await expect(ftl().codeCases!('494235010010')).resolves.toEqual([]);
  });

  it('still returns an empty case list when the parcel genuinely is not in the city', async () => {
    serveBy([['/Accela/Accela/MapServer/2', { features: [] }]]);
    await expect(ftl().codeCases!('494235010010')).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// municipal-permits.ts: ok:false is the existing channel for "cannot certify
// a zero off this". A partial answer belongs in it, with accurate wording.
// ---------------------------------------------------------------------------
describe('municipal permits: a cut-short layer cannot certify a zero', () => {
  const ftlPermitRow = row({ PERMITNUMBER: 'P-1', PERMITTYPE: 'ROOF' });
  const ftlCodeRow = row({ CASENUMBER: 'C-1', CASETYPE: 'LOT CLEARING', CASESTATUS: 'Open' });

  it('does not mark the code axis searched when the code layer was cut short', async () => {
    serveBy([['MapServer/27', { features: [ftlPermitRow] }],
             ['MapServer/30', { features: [ftlCodeRow], exceededTransferLimit: true }]]);
    const r = await fetchMunicipalPermits({ countyKey: 'broward', lat: 26.12, lng: -80.14 });
    expect(r.codeCasesRead).toBe(false);
    expect(r.notes.join(' ')).toMatch(/returned only part of its records/i);
    expect(r.notes.join(' ')).toMatch(/NOT fully searched/i);
  });

  it('still shows the rows a cut-short layer did return', async () => {
    // Refusing to certify a zero is not a reason to throw real records away.
    serveBy([['MapServer/27', { features: [ftlPermitRow], exceededTransferLimit: true }],
             ['MapServer/30', { features: [] }]]);
    const r = await fetchMunicipalPermits({ countyKey: 'broward', lat: 26.12, lng: -80.14 });
    expect(r.permits).toHaveLength(1);
    expect(r.notes.join(' ')).toMatch(/not the whole set/i);
  });

  it('words a cut-short read differently from a dead one', async () => {
    serveBy([['MapServer/27', { features: [] }],
             ['MapServer/30', { error: { code: 400 } }]]);
    const r = await fetchMunicipalPermits({ countyKey: 'broward', lat: 26.12, lng: -80.14 });
    expect(r.notes.join(' ')).toMatch(/did not answer on this run/i);
    expect(r.notes.join(' ')).not.toMatch(/returned only part/i);
  });

  it('DOES mark the code axis searched when both layers answered completely', async () => {
    serveBy([['MapServer/27', { features: [ftlPermitRow] }],
             ['MapServer/30', { features: [ftlCodeRow] }]]);
    const r = await fetchMunicipalPermits({ countyKey: 'broward', lat: 26.12, lng: -80.14 });
    expect(r.codeCasesRead).toBe(true);
    expect(r.notes.join(' ')).not.toMatch(/returned only part|did not answer/i);
  });

  it('measures the Socrata cap by asking for one row more than it keeps', async () => {
    // Socrata publishes no truncation flag, so completeness is measured. 31
    // rows back for a cap of 30 proves rows exist beyond it; only 30 are kept.
    const rows = Array.from({ length: 31 }, (_, i) => ({ permit_number: `O-${i}` }));
    globalThis.fetch = (async (u: any) => {
      expect(String(u)).toContain('%24limit=31');
      return new Response(JSON.stringify(rows), { status: 200 });
    }) as any;
    const r = await fetchMunicipalPermits({ countyKey: 'orange', lat: 28.54, lng: -81.38 });
    expect(r.permits).toHaveLength(30);
    expect(r.notes.join(' ')).toMatch(/not the whole set/i);
  });

  it('treats a Socrata answer inside the cap as complete', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ permit_number: `O-${i}` }));
    globalThis.fetch = (async () => new Response(JSON.stringify(rows), { status: 200 })) as any;
    const r = await fetchMunicipalPermits({ countyKey: 'orange', lat: 28.54, lng: -81.38 });
    expect(r.permits).toHaveLength(4);
    expect(r.notes.join(' ')).not.toMatch(/not the whole set/i);
  });
});

// ---------------------------------------------------------------------------
// county-property.ts: the same shape as the statewide roll, so the same answer.
// ---------------------------------------------------------------------------
describe('fast county parcel path: a cut-short answer is not "no building data"', () => {
  const house = row({
    FOLIO: '494235010010', OWNER_NAME_1: 'SMITH JOHN',
    ACTUAL_YEAR_BUILT: 1965, BLDG_ADJ_SQ_FOOTAGE: 1400,
  });
  const vacant = row({ FOLIO: '494235010011', OWNER_NAME_1: 'VACANT OWNER' });

  /** Serve the point query and the widened envelope separately. */
  const byGeometry = (point: unknown, envelope: unknown) => {
    globalThis.fetch = (async (u: any) => {
      const url = String(u);
      return json(url.includes('esriGeometryEnvelope') ? envelope : point);
    }) as any;
  };

  it('reports unknown when a truncated answer holds no building parcel', async () => {
    byGeometry({ features: [vacant], exceededTransferLimit: true }, { features: [] });
    await expect(fetchCountyProperty('fl-broward', 26.12, -80.14)).resolves.toBeNull();
  });

  it('reports unknown when the point was complete but the envelope was cut short', async () => {
    byGeometry({ features: [vacant], exceededTransferLimit: false },
               { features: [], exceededTransferLimit: true });
    await expect(fetchCountyProperty('fl-broward', 26.12, -80.14)).resolves.toBeNull();
  });

  it('reports unknown on a continuation token in the envelope', async () => {
    byGeometry({ features: [vacant] }, { features: [], resultPaginationToken: 'tok' });
    await expect(fetchCountyProperty('fl-broward', 26.12, -80.14)).resolves.toBeNull();
  });

  // The other direction, three ways.
  it('keeps a building parcel a truncated answer DID resolve', async () => {
    byGeometry({ features: [house], exceededTransferLimit: true }, { features: [] });
    const p = await fetchCountyProperty('fl-broward', 26.12, -80.14);
    expect(p?.owner).toBe('SMITH JOHN');
    expect(p?.yearBuilt).toBe(1965);
  });

  it('keeps the building parcel a truncated envelope found', async () => {
    byGeometry({ features: [vacant], exceededTransferLimit: false },
               { features: [house], exceededTransferLimit: true });
    const p = await fetchCountyProperty('fl-broward', 26.12, -80.14);
    expect(p?.owner).toBe('SMITH JOHN');
  });

  it('still returns a vacant parcel when both answers were complete', async () => {
    byGeometry({ features: [vacant] }, { features: [] });
    const p = await fetchCountyProperty('fl-broward', 26.12, -80.14);
    expect(p?.owner).toBe('VACANT OWNER');
    expect(p?.yearBuilt).toBeNull();
  });
});
