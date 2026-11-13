// A 200 response carrying NO `features` array is a malformed answer. Reading it
// as an empty list turns "the source did not answer" into "the source says
// there is nothing", which is a published claim rather than a missing one.
//
// This is the same defect class as the Broward continuation-token finding, found
// by sweeping the rest of the codebase for it. Each test below asserts BOTH
// directions, because only the pair is load-bearing:
//
//   - a malformed response must NOT produce a clean negative
//   - a genuine {"features": []} must STILL produce the legitimate empty answer
//
// Without the second half a blanket "reject everything" would pass, and the
// honest no-records answer that users depend on would be gone.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { assessFlood } from '@/lib/flood';
import { permitLayerByFolio } from '@/lib/miami-dade-raw';

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
  vi.restoreAllMocks();
});

const serveAll = (body: unknown, status = 200) => {
  globalThis.fetch = (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as any;
};

describe('FEMA flood: a malformed answer is not "minimal flood risk"', () => {
  it('fails closed when the response carries no features array', async () => {
    // Before: `data = j` accepted this, the !attrs branch was reached, and the
    // report published inSFHA:false with failureReason:null - a confident
    // "minimal mapped flood risk" that drives the 50% substantial-improvement
    // rule and the insurance note. The county fallback is served the same
    // malformed shape, so nothing can rescue it.
    serveAll({ fieldAliases: {}, geometryType: 'esriGeometryPolygon' });
    const r = await assessFlood(25.7617, -80.1918);
    expect(r.inSFHA).toBeNull();
    expect(r.zone).toBeNull();
    expect(r.failureReason).toBeTruthy();
    expect(String(r.failureReason)).toMatch(/features array/i);
    expect(r.summary).toMatch(/could not retrieve/i);
  });

  it('still reports minimal hazard for a GENUINE empty feature list', async () => {
    // The honest no-polygon answer. This is the half that makes the test above
    // mean something: an empty array really does mean no mapped polygon, and
    // that case must keep its confident answer.
    serveAll({ features: [] });
    const r = await assessFlood(25.7617, -80.1918);
    expect(r.inSFHA).toBe(false);
    expect(r.failureReason).toBeNull();
    expect(r.summary).toMatch(/no FEMA flood-hazard polygon/i);
  });

  it('still reads a real mapped zone', async () => {
    serveAll({ features: [{ attributes: { FLD_ZONE: 'AE', ZONE_SUBTY: null, SFHA_TF: 'T', STATIC_BFE: 9 } }] });
    const r = await assessFlood(25.7617, -80.1918);
    expect(r.zone).toBe('AE');
    expect(r.inSFHA).toBe(true);
    expect(r.baseFloodElevationFt).toBe(9);
    expect(r.failureReason).toBeNull();
  });
});

describe('Miami-Dade permit layer: a malformed answer is not "no permits"', () => {
  it('rejects when the response carries no features array', async () => {
    // Before: `(data?.features ?? [])` returned [], which merges to "no
    // permits". The module already throws on an arcgis error, so a response
    // that is not a feature collection at all belongs in the same place. The
    // lien provider refuses to publish permits unless BOTH the table and the
    // layer answer, so this rejection is what reaches the user.
    serveAll({ fieldAliases: {} });
    await expect(permitLayerByFolio('0141230750090')).rejects.toThrow(/features array/i);
  });

  it('still returns an empty list for a GENUINE empty feature list', async () => {
    serveAll({ features: [] });
    await expect(permitLayerByFolio('0141230750090')).resolves.toEqual([]);
  });

  it('still maps a real permit row', async () => {
    serveAll({
      features: [{ attributes: { PROCNUM: 'B2019001', TYPE: 'BLDG', DESC1: 'Reroof', BPSTATUS: 'F', ISSUDATE: '20190104' } }],
    });
    const rows = await permitLayerByFolio('0141230750090');
    expect(rows.length).toBe(1);
  });
});

describe('Miami-Dade adapter: a failed permit LAYER lookup says so', () => {
  it('records a user-visible note, as the sibling table path already did', async () => {
    // The table path pushed a "NOT confirmed" note on failure and the layer
    // path only logged, so a failed layer lookup still read as "no permits"
    // with nothing saying otherwise. The layer holds the OLDER GIS permit
    // record, which is how an old expired permit would go unmentioned.
    vi.doMock('@/lib/miami-dade-raw', async () => {
      const actual: any = await vi.importActual('@/lib/miami-dade-raw');
      return {
        ...actual,
        paByAddress: async () => ({ folio: '0141230750090', candidates: [] }),
        paByFolio: async () => ({}),
        permitsByFolio: async () => [],
        permitLayerByFolio: async () => { throw new Error('permit layer: response had no features array'); },
        neighborPermits: async () => ({ total: 0, byAddress: [] }),
        codeEnforcement: async () => ({ open: [], closedPast5: [], failed: [] }),
        inspectionsByAddress: async () => 0,
        folioAtPoint: async () => null,
      };
    });
    const { miamiDadeAdapter } = await import('@/lib/counties/miami-dade-adapter');
    const res: any = await miamiDadeAdapter.run({
      address: '123 Test St', zip: '33101', lat: 25.76, lng: -80.19, typedAddress: '123 Test St',
    } as any);
    const notes: string[] = res?.notes ?? [];
    expect(notes.join(' ')).toMatch(/permit LAYER lookup failed/i);
    expect(notes.join(' ')).toMatch(/NOT confirmed/i);
  });
});
