// Codex R1 P2-1: the jurisdiction lookup used `aim`, a CAMERA point.
//
// `polygonCentroid` is an area centroid. For a concave lot - a U, an L, a flag
// lot - it can sit outside the ring entirely, in the notch. The notch is land
// the owner does not own and can belong to the next jurisdiction, so the
// report named the NEIGHBOUR's city as the parcel's code authority. Staying
// amber does not make a wrong authority attribution acceptable.
//
// Codex also showed why my R1 tests missed it: Hillsborough has no endpoint in
// `fetchParcelPolygon`, so every Tampa test took the synthetic-box fallback and
// never ran the centroid branch at all. Broward HAS an endpoint, so these
// drive the real non-fallback path with a real concave ring.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { polygonCentroid, interiorPoint, pointInRing } from '@/lib/parcel';
import { runDiagnostic } from '@/lib/orchestrator';
import type { ParcelRing } from '@/lib/types';

/** Codex's U, verbatim: local (x,y) mapped to [lat,lng]. */
const U_XY = [[0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6], [0, 0]];
const BASE = { lat: 26.1224, lng: -80.1373 }; // Fort Lauderdale, Broward
const U_RING: ParcelRing = U_XY.map(([x, y]) => [BASE.lat + y * 0.0001, BASE.lng + x * 0.0001]) as ParcelRing;

describe('a point used to decide jurisdiction is inside the parcel', () => {
  it('reproduces the centroid landing outside a concave lot', () => {
    const c = polygonCentroid(U_RING);
    // The exact failure Codex reported, on the real function.
    expect(pointInRing(c, U_RING)).toBe(false);
  });

  it('returns a point proven inside instead', () => {
    const p = interiorPoint(U_RING);
    expect(p).not.toBeNull();
    expect(pointInRing(p!, U_RING)).toBe(true);
  });

  it('still uses the centroid for an ordinary rectangular lot', () => {
    const rect: ParcelRing = [
      [26.1, -80.1], [26.1, -80.0999], [26.1001, -80.0999], [26.1001, -80.1], [26.1, -80.1],
    ] as ParcelRing;
    const c = polygonCentroid(rect);
    expect(interiorPoint(rect)).toEqual(c);
  });

  it('refuses a degenerate ring rather than guessing', () => {
    expect(interiorPoint([] as unknown as ParcelRing)).toBeNull();
    expect(interiorPoint([[26.1, -80.1], [26.1, -80.1]] as unknown as ParcelRing)).toBeNull();
    expect(interiorPoint([[NaN, -80.1], [26.1, -80.0], [26.2, -80.2]] as unknown as ParcelRing)).toBeNull();
    // A zero-width ring encloses nothing, so no interior point exists.
    expect(interiorPoint([[26.1, -80.1], [26.2, -80.1], [26.3, -80.1], [26.1, -80.1]] as unknown as ParcelRing)).toBeNull();
  });
});

// `fetchParcelPolygon` is wrapped in Next's `unstable_cache`, which
// short-circuits outside a request context: under vitest the county endpoint
// is never called and every run takes the synthetic-box fallback. Stubbing
// fetch therefore CANNOT reach the non-fallback branch. Seam the module
// instead, keeping the real polygonCentroid / interiorPoint / pointInRing so
// the geometry under test is the shipped geometry.
const parcelPolygon = vi.hoisted(() => ({ current: null as any }));

vi.mock('@/lib/parcel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/parcel')>();
  return {
    ...actual,
    fetchParcelPolygon: async (lat: number, lng: number, countyKey: string | null) =>
      parcelPolygon.current ?? actual.fetchParcelPolygon(lat, lng, countyKey),
  };
});

interface Stub { calls: string[]; restore: () => void }

/**
 * Broward, whose parcel endpoint is real, returning the concave U. The place
 * boundary answers by WHICH POINT is asked about: the notch is another city.
 */
function installStub(opts: { ring?: ParcelRing | null } = {}): Stub {
  const real = globalThis.fetch;
  const calls: string[] = [];
  const ring = opts.ring === undefined ? U_RING : opts.ring;
  parcelPolygon.current = ring
    ? { polygon: ring, source: 'Broward County GIS parcel layer (test)', isFallback: false }
    : null;

  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    calls.push(url);

    if (url.includes('geocoding.geo.census.gov')) {
      return new Response(JSON.stringify({ result: { addressMatches: [{
        matchedAddress: '1 BROWARD BLVD, FORT LAUDERDALE, FL, 33301',
        coordinates: { x: BASE.lng, y: BASE.lat },
      }] } }), { status: 200 });
    }
    if (url.includes('geo.fcc.gov')) {
      return new Response(JSON.stringify({ results: [{ county_name: 'Broward County' }] }), { status: 200 });
    }

    // Incorporated places: answer according to the point actually queried.
    if (url.includes('Places_CouSub_ConCity_SubMCD')) {
      const g = new URL(url).searchParams.get('geometry');
      const pt = g ? JSON.parse(g) : null;
      const inside = pt ? pointInRing({ lat: pt.y, lng: pt.x }, U_RING) : false;
      return new Response(JSON.stringify({
        features: [{ attributes: { BASENAME: inside ? 'Lotville' : 'Notchville', NAME: '', STATE: '12' } }],
      }), { status: 200 });
    }

    return new Response(JSON.stringify({ features: [] }), { status: 200 });
  }) as any;

  return {
    calls,
    restore: () => {
      globalThis.fetch = real;
      parcelPolygon.current = null;
    },
  };
}

let active: Stub | null = null;
afterEach(() => { active?.restore(); active = null; });

describe('through the real report, on a concave parcel', () => {
  it('names the city containing the lot, not the one in its notch', async () => {
    active = installStub();

    const report = await runDiagnostic({ address: '1 Broward Blvd, Fort Lauderdale, FL' });

    // Before the fix this was Notchville: the centroid sits in the cut-out.
    expect(report.property.municipality).toBe('Lotville');
  }, 60000);

  it('asks about a point that differs from the geocode', async () => {
    const stub = installStub();
    active = stub;

    await runDiagnostic({ address: '1 Broward Blvd, Fort Lauderdale, FL' });

    const boundary = stub.calls.find((u) => u.includes('Places_CouSub_ConCity_SubMCD'));
    expect(boundary).toBeTruthy();
    const pt = JSON.parse(new URL(boundary!).searchParams.get('geometry')!);
    // A parcel point, not the geocoded address point.
    expect(pt.y === BASE.lat && pt.x === BASE.lng).toBe(false);
    expect(pointInRing({ lat: pt.y, lng: pt.x }, U_RING)).toBe(true);
  }, 60000);
});

describe('a centroid that cannot be trusted is not a parcel point', () => {
  // Found while writing the concave tests, and broader than the concave case:
  // the shoelace formula ran on raw coordinates. A Florida parcel sits at
  // lng -80 / lat 26 and encloses ~1e-8 of coordinate area, so the cross terms
  // (~2080) cancel away the entire signal in float64. An ORDINARY RECTANGULAR
  // lot came out 31 m off and outside itself. The same shape at the origin was
  // exact, which is what identified the cause.
  const rect: ParcelRing = [
    [26.1, -80.1], [26.1, -80.0999], [26.1001, -80.0999], [26.1001, -80.1], [26.1, -80.1],
  ] as ParcelRing;

  it('puts a plain rectangular lot centroid at its true centre', () => {
    const c = polygonCentroid(rect);
    expect(c.lat).toBeCloseTo(26.10005, 9);
    expect(c.lng).toBeCloseTo(-80.09995, 9);
    expect(pointInRing(c, rect)).toBe(true);
  });

  it('gives the same answer wherever on earth the shape sits', () => {
    // Translation invariance: the bug was that it did not hold.
    const shifted: ParcelRing = rect.map(([la, ln]) => [la - 26.1, ln + 80.1]) as ParcelRing;
    const here = polygonCentroid(rect);
    const there = polygonCentroid(shifted);
    expect(here.lat - 26.1).toBeCloseTo(there.lat, 9);
    expect(here.lng + 80.1).toBeCloseTo(there.lng, 9);
  });
});

describe('a parcel we cannot stand inside is left unresolved', () => {
  it('does not fall back to the geocode when the polygon is real but unusable', async () => {
    // Real polygon (isFallback false) with no interior: collinear points.
    const degenerate = [[26.1, -80.1], [26.2, -80.1], [26.3, -80.1], [26.1, -80.1]] as unknown as ParcelRing;
    const stub = installStub({ ring: degenerate });
    active = stub;

    const report = await runDiagnostic({ address: '1 Broward Blvd, Fort Lauderdale, FL' });

    // We had parcel evidence and could not use it. Guessing from the address
    // point here would dress a geocode up as parcel-verified.
    expect(report.property.municipality).toBeNull();
    expect(stub.calls.some((u) => u.includes('Places_CouSub_ConCity_SubMCD'))).toBe(false);
  }, 60000);
});
