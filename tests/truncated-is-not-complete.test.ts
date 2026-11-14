// A response the server cut short is not the complete answer to the query.
//
// ArcGIS says so three ways, and `partialResultReason` in src/lib/arcgis.ts
// already sweeps all three. The gap these tests close is that the Miami-Dade
// permit paths and the statewide parcel roll never asked: they read the first
// page as the whole truth, so "these are all the permits on this property" and
// "the roll holds no building data for it" could both be a page-one artefact.
//
// Every test asserts BOTH directions, because only the pair is load-bearing:
//
//   - a truncated answer must NOT be published as a complete one
//   - a complete answer must STILL produce the ordinary result, including the
//     honest empty one
//
// Without the second half, "reject everything" would pass these tests and the
// product's real answers would be gone.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { permitsByFolio, permitLayerByFolio, codeEnforcement } from '@/lib/miami-dade-raw';
import { parcelByPoint, parcelByFolio } from '@/lib/counties/statewide-cadastral';

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
  vi.restoreAllMocks();
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const serveAll = (body: unknown) => {
  globalThis.fetch = (async () => json(body)) as any;
};

/** One permit row as the permit TABLE returns it. */
const tableRow = (n: string) => ({ attributes: { PermitNumber: n, ApplicationTypeDescription: 'ROOF' } });
/** One permit row as the GIS permit LAYER returns it. */
const layerRow = (id: number) => ({ attributes: { ID: id, BPSTATUS: 'E', PROCNUM: 'P' + id } });

describe('Miami-Dade permit table: a truncated page is not the permit history', () => {
  it('rejects exceededTransferLimit even when rows came back', async () => {
    // Before: these rows became "the permits on this property". The caller
    // publishes the list and a count, so a first page read as the whole set
    // hides exactly the open or expired permit the report exists to surface.
    serveAll({ features: [tableRow('A')], exceededTransferLimit: true });
    await expect(permitsByFolio('30-1234-567-8901')).rejects.toThrow(/partial result.*exceededTransferLimit/i);
  });

  it('rejects the geojson-shaped flag', async () => {
    serveAll({ features: [tableRow('A')], properties: { exceededTransferLimit: true } });
    await expect(permitsByFolio('30-1234-567-8901')).rejects.toThrow(/partial result.*properties\.exceededTransferLimit/i);
  });

  it('rejects a continuation token', async () => {
    // A token names a continuation, not a position, so there is no offset to
    // ask for next. Refusing is the whole correct behaviour.
    serveAll({ features: [tableRow('A')], resultPaginationToken: 'next-page' });
    await expect(permitsByFolio('30-1234-567-8901')).rejects.toThrow(/partial result.*resultPaginationToken/i);
  });

  it('still returns the permits when the answer is complete', async () => {
    serveAll({ features: [tableRow('A'), tableRow('B')], exceededTransferLimit: false });
    const rows = await permitsByFolio('30-1234-567-8901');
    expect(rows.map((r) => r.permitNumber)).toEqual(['A', 'B']);
  });

  it('still returns the honest empty answer', async () => {
    // The whole point of the product: "no permits" has to remain sayable.
    serveAll({ features: [] });
    await expect(permitsByFolio('30-1234-567-8901')).resolves.toEqual([]);
  });

  it('treats an empty truncated page as truncated, not as no permits', async () => {
    // The shape that slipped past a record-by-record validator elsewhere in
    // this repo: nothing to inspect, and the envelope is the only thing that
    // says the answer is a prefix.
    serveAll({ features: [], exceededTransferLimit: true });
    await expect(permitsByFolio('30-1234-567-8901')).rejects.toThrow(/partial result/i);
  });
});

describe('Miami-Dade permit LAYER: a truncated page is not the permit history', () => {
  it('rejects a truncated answer', async () => {
    // This layer is the only public source of older OPEN and EXPIRED permits.
    serveAll({ features: [layerRow(1)], exceededTransferLimit: true });
    await expect(permitLayerByFolio('30-1234-567-8901')).rejects.toThrow(/partial result.*exceededTransferLimit/i);
  });

  it('rejects a continuation token', async () => {
    serveAll({ features: [layerRow(1)], resultPaginationToken: 'tok' });
    await expect(permitLayerByFolio('30-1234-567-8901')).rejects.toThrow(/partial result.*resultPaginationToken/i);
  });

  it('still returns the permits when the answer is complete', async () => {
    serveAll({ features: [layerRow(7)], exceededTransferLimit: false });
    const rows = await permitLayerByFolio('30-1234-567-8901');
    expect(rows).toHaveLength(1);
    expect(rows[0].permitNumber).toBe('7');
    expect(rows[0].status).toMatch(/expired/i);
  });

  it('still returns the honest empty answer', async () => {
    serveAll({ features: [] });
    await expect(permitLayerByFolio('30-1234-567-8901')).resolves.toEqual([]);
  });
});

describe('code enforcement: a truncated source is a failed source, not a clear one', () => {
  it('lists the source as failed instead of reporting no cases', async () => {
    // codeEnforcement swallows per-source throws on purpose so one locked layer
    // cannot wipe out the rest. What must not happen is a truncated source
    // silently contributing zero cases to a report that then reads as clear.
    serveAll({ features: [], exceededTransferLimit: true });
    const res = await codeEnforcement('30-1234-567-8901');
    expect(res.open).toEqual([]);
    expect(res.failed.length).toBeGreaterThan(0);
  });

  it('reports a genuinely clear property with no failed sources', async () => {
    serveAll({ features: [] });
    const res = await codeEnforcement('30-1234-567-8901');
    expect(res.open).toEqual([]);
    expect(res.failed).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// The statewide parcel roll. Truncation is NOT an error here - the query asks
// for 8 rows and a widened envelope can legitimately intersect more - so these
// tests pin where it changes a published claim and where it does not.
// --------------------------------------------------------------------------

const rightOfWay = { attributes: { CO_NO: 13, PARCEL_ID: 'ROW-1' } };
const house = {
  attributes: { CO_NO: 13, PARCEL_ID: 'P-1', ACT_YR_BLT: 1965, TOT_LVG_AR: 1400, OWN_NAME: 'SMITH JOHN' },
};

/** Serve the point query and the widened-envelope query separately. */
const serveByGeometry = (point: unknown, envelope: unknown) => {
  globalThis.fetch = (async (u: any) => {
    const url = new URL(String(u));
    const kind = url.searchParams.get('geometryType');
    return json(kind === 'esriGeometryEnvelope' ? envelope : point);
  }) as any;
};

describe('statewide parcel roll: a cut-short answer is not "no building data"', () => {
  it('reports unknown when the only parcel in a truncated answer has no building data', async () => {
    // pickBest PREFERS a building parcel, so when the answer was cut short the
    // better candidate may be in the rows we never saw. Published as-is this
    // renders "?-built, ? heated sq ft" with the certified roll behind it.
    const truncatedRow = { features: [rightOfWay], exceededTransferLimit: true };
    serveByGeometry(truncatedRow, truncatedRow);
    await expect(parcelByPoint(25.77, -80.19)).resolves.toBeNull();
  });

  it('rejects the geojson-shaped flag and a token the same way', async () => {
    const geo = { features: [rightOfWay], properties: { exceededTransferLimit: true } };
    serveByGeometry(geo, geo);
    await expect(parcelByPoint(25.77, -80.19)).resolves.toBeNull();
    const tok = { features: [rightOfWay], resultPaginationToken: 'more' };
    serveByGeometry(tok, tok);
    await expect(parcelByPoint(25.77, -80.19)).resolves.toBeNull();
  });

  it('KEEPS a truncated answer that did resolve to a building parcel', async () => {
    // That parcel really does intersect the point, and completeness was never
    // the claim being made. Only the no-building case needs every row.
    serveByGeometry({ features: [house], exceededTransferLimit: true }, { features: [] });
    const p = await parcelByPoint(25.77, -80.19);
    expect(p?.yearBuilt).toBe(1965);
  });

  it('still returns a vacant parcel from a COMPLETE answer', async () => {
    // A right-of-way or vacant lot with no building data is a real answer when
    // the roll gave us everything: owner and legal still render.
    const complete = { features: [rightOfWay], exceededTransferLimit: false };
    serveByGeometry(complete, complete);
    const p = await parcelByPoint(25.77, -80.19);
    expect(p).not.toBeNull();
    expect(p?.parcelId).toBe('ROW-1');
  });

  it('still returns a house from a complete answer', async () => {
    serveByGeometry({ features: [house] }, { features: [] });
    const p = await parcelByPoint(25.77, -80.19);
    expect(p?.yearBuilt).toBe(1965);
    expect(p?.owner).toMatch(/Smith/i);
  });
});

describe('statewide parcel roll by folio: an ambiguous id resolves to nothing', () => {
  const withCentroid = (attrs: any) => ({ attributes: attrs, centroid: { x: -80.19, y: 25.77 } });

  it('returns null when rows were held back, instead of picking one', async () => {
    // Four or more parcels carry that id - the roll keeps each county's own
    // ids and they repeat across counties. feats[0] would name an owner, a
    // value and a sale history for a property nobody asked about.
    serveAll({ features: [withCentroid(house.attributes)], exceededTransferLimit: true });
    await expect(parcelByFolio('30-1234-567-8901')).resolves.toBeNull();
  });

  it('returns null on a continuation token too', async () => {
    serveAll({ features: [withCentroid(house.attributes)], resultPaginationToken: 'tok' });
    await expect(parcelByFolio('30-1234-567-8901')).resolves.toBeNull();
  });

  it('still resolves an unambiguous folio', async () => {
    serveAll({ features: [withCentroid(house.attributes)], exceededTransferLimit: false });
    const r = await parcelByFolio('30-1234-567-8901');
    expect(r?.lat).toBeCloseTo(25.77);
    expect(r?.parcel.yearBuilt).toBe(1965);
  });

  it('still returns null for a folio that matches nothing', async () => {
    serveAll({ features: [] });
    await expect(parcelByFolio('99-9999-999-9999')).resolves.toBeNull();
  });
});
