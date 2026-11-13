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

// ---------------------------------------------------------------------------
// Codex F1. I excluded this module from the first round on the grounds that
// every field is nullable and every call already degrades to null. That was the
// wrong test. The aggregation built a fact out of the null and THREE consumers
// turned it into a published negative: the report card ("This address is
// outside the county evacuation zones", "Outside county sewer"), the PDF's
// "Outside county sewer" card, and a 2-point readiness penalty. A nullable
// field is not a safe field when something downstream turns the null into a
// sentence, so these drive the public entry point and assert the FACT, which is
// what every one of those consumers reads.
// ---------------------------------------------------------------------------

import { fetchMiamiDadeExtras } from '@/lib/counties/miami-dade-extras';

// Codex's reproduction shapes, reused exactly.
const PA_OK = { Building: { BuildingInfos: [] } };
const MALFORMED = { fieldAliases: {} };

const routeExtras = (parts: { evac?: unknown; sewerArea?: unknown; septic?: unknown; pa?: unknown }) => {
  globalThis.fetch = (async (u: any) => {
    const url = String(u?.url ?? u);
    const pick = url.includes('HurricaneEvacZone_gdb')
      ? parts.evac
      : url.includes('SewerServiceArea_gdb')
      ? parts.sewerArea
      : url.includes('PossiblePropertiesServedBySepticOrWell')
      ? parts.septic
      : (parts.pa ?? PA_OK);
    return new Response(JSON.stringify(pick ?? MALFORMED), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as any;
};

const extras = () => fetchMiamiDadeExtras({ folio: '0141230750090', lat: 25.76, lng: -80.19, permits: [] });

describe('Miami-Dade extras: an unavailable layer is not an absence (Codex F1)', () => {
  it('makes NO evacuation claim when that layer answered malformed, even though the appraiser answered', async () => {
    routeExtras({ evac: MALFORMED, sewerArea: MALFORMED, septic: MALFORMED, pa: PA_OK });
    const r = await extras();
    expect(r.evacuation).toBeNull();
    expect(r.sources.join(' ')).not.toMatch(/evacuation zones/i);
  });

  it('STILL says outside-every-zone when the evacuation layer genuinely answered empty', async () => {
    // The half that makes the test above mean something. A property really
    // outside every zone must keep its confident answer, because that is what
    // renders the "outside the county evacuation zones" sentence.
    routeExtras({ evac: { features: [] }, sewerArea: { features: [] }, septic: { features: [] }, pa: PA_OK });
    const r = await extras();
    expect(r.evacuation).not.toBeNull();
    expect(r.evacuation!.zone).toBeNull();
    expect(r.sources.join(' ')).toMatch(/evacuation zones/i);
  });

  it('still reads a real evacuation zone', async () => {
    routeExtras({
      evac: { features: [{ attributes: { ZONEID: 'B', CATEGORY: 3 } }] },
      sewerArea: { features: [] }, septic: { features: [] }, pa: PA_OK,
    });
    const r = await extras();
    expect(r.evacuation!.zone).toBe('B');
    expect(r.evacuation!.category).toBe(3);
  });

  it('makes NO sewer claim when the septic layer alone answered malformed', async () => {
    // Codex named this one: a working sewer-area lookup with a malformed septic
    // lookup still published "not flagged as septic or well".
    routeExtras({ evac: { features: [] }, sewerArea: { features: [{ attributes: { UTILITYNAME: 'MDWASD' } }] }, septic: MALFORMED, pa: PA_OK });
    const r = await extras();
    expect(r.sewer).toBeNull();
    expect(r.sources.join(' ')).not.toMatch(/sewer service areas/i);
  });

  it('makes NO sewer claim when the sewer-area layer alone answered malformed', async () => {
    routeExtras({ evac: { features: [] }, sewerArea: MALFORMED, septic: { features: [] }, pa: PA_OK });
    const r = await extras();
    expect(r.sewer).toBeNull();
  });

  it('STILL publishes outside-sewer when BOTH layers genuinely answered empty', async () => {
    routeExtras({ evac: { features: [] }, sewerArea: { features: [] }, septic: { features: [] }, pa: PA_OK });
    const r = await extras();
    expect(r.sewer).not.toBeNull();
    expect(r.sewer!.inServiceArea).toBe(false);
    expect(r.sewer!.septicOrWellFlag).toBe(false);
    expect(r.sewer!.summary).toMatch(/outside the county sewer/i);
  });

  it('still reads a real service area and a real septic flag', async () => {
    routeExtras({
      evac: { features: [] },
      sewerArea: { features: [{ attributes: { UTILITYNAME: 'MDWASD' } }] },
      septic: { features: [{ attributes: { FOLIO: '0141230750090' } }] },
      pa: PA_OK,
    });
    const r = await extras();
    expect(r.sewer!.inServiceArea).toBe(true);
    expect(r.sewer!.utility).toBe('MDWASD');
    expect(r.sewer!.septicOrWellFlag).toBe(true);
  });
});
