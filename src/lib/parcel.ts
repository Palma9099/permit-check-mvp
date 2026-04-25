// Parcel polygon fetcher.
//
// The vision model was flagging neighbor features (the most painful bug: a
// pool in the NEIGHBOR'S yard reported as the subject's pool). To fix it we
// need to show the model exactly where the subject parcel ends. We do that
// by drawing the parcel polygon in red on the satellite image — but first we
// need the polygon coordinates.
//
// Source strategy, in order of preference:
//   1. Known county-specific ArcGIS parcel services (Miami-Dade confirmed;
//      others best-effort).
//   2. FL DOR / statewide parcel layer (covers all 67 counties).
//   3. Generated fallback polygon — a small ~100ft square centered on the
//      geocoded point. Not an actual parcel, but gives the vision model a
//      usable "subject area" hint so it doesn't drift into neighbors.
//
// Any fetch failure falls through silently to the next source. Never throw —
// the main report should always render.

import type { ParcelRing } from './types';

export interface ParcelPolygonResult {
  polygon: ParcelRing;
  source: string;        // human-readable source label for the report
  isFallback: boolean;   // true when we had to synthesize a box
}

// ---------------------------------------------------------------------------
// Esri FeatureServer helper — returns the polygon geometry for the first
// feature whose geometry CONTAINS the given point.
// ---------------------------------------------------------------------------

interface EsriQueryOpts {
  baseUrl: string;   // e.g. https://services.arcgis.com/.../FeatureServer/0
  sourceLabel: string;
}

async function queryEsriByPoint(
  lat: number,
  lng: number,
  opts: EsriQueryOpts,
): Promise<ParcelPolygonResult | null> {
  // Use a small envelope (~5m) instead of a strict point intersect. A strict
  // point hits "no features" whenever the geocoded pin lands on a property
  // line, the right-of-way, or just outside the polygon by a few feet — which
  // is common for residential rooftop geocoding. The envelope tolerates that
  // and still returns the single parcel containing the address.
  const DELTA = 0.00005; // ~5m at FL latitudes
  const envelope = {
    xmin: lng - DELTA,
    ymin: lat - DELTA,
    xmax: lng + DELTA,
    ymax: lat + DELTA,
    spatialReference: { wkid: 4326 },
  };
  try {
    const u = new URL(opts.baseUrl + '/query');
    u.searchParams.set('geometry', JSON.stringify(envelope));
    u.searchParams.set('geometryType', 'esriGeometryEnvelope');
    u.searchParams.set('inSR', '4326');
    u.searchParams.set('outSR', '4326');
    u.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
    u.searchParams.set('returnGeometry', 'true');
    u.searchParams.set('outFields', '');
    u.searchParams.set('f', 'json');
    u.searchParams.set('resultRecordCount', '1');
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(u.toString(), { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timeout);
    if (!res.ok) {
      console.error(`[parcel] ${opts.sourceLabel} HTTP ${res.status}`);
      return null;
    }
    const data: any = await res.json();
    if (data?.error) {
      console.error(`[parcel] ${opts.sourceLabel} error: ${JSON.stringify(data.error).slice(0, 200)}`);
      return null;
    }
    const rings: any[] | undefined = data?.features?.[0]?.geometry?.rings;
    if (!Array.isArray(rings) || rings.length === 0) return null;
    const ring = rings[0];
    if (!Array.isArray(ring) || ring.length < 3) return null;
    // ESRI returns rings as [[x,y], ...] = [[lng,lat], ...]
    const latLngRing: ParcelRing = ring.map((pt: any[]) => [Number(pt[1]), Number(pt[0])]);
    if (latLngRing.some(([la, ln]) => !Number.isFinite(la) || !Number.isFinite(ln))) return null;
    return { polygon: latLngRing, source: opts.sourceLabel, isFallback: false };
  } catch (err: any) {
    console.error(`[parcel] ${opts.sourceLabel} threw: ${String(err?.message ?? err).slice(0, 200)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-county ArcGIS endpoints (best known). When a county isn't listed, we
// fall through to the statewide layer.
// ---------------------------------------------------------------------------

const COUNTY_ENDPOINTS: Record<string, EsriQueryOpts> = {
  'miami-dade': {
    // Verified Apr 2026: this is the live Miami-Dade hosted parcel layer.
    // The previous URL (MDC_Parcel/FeatureServer/0) returned 400 "Invalid URL".
    baseUrl: 'https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/ParcelsView_gdb/FeatureServer/0',
    sourceLabel: 'Miami-Dade GIS parcel layer',
  },
  'broward': {
    baseUrl: 'https://services1.arcgis.com/rAZPyFQnu4iBOxQY/arcgis/rest/services/Parcels/FeatureServer/0',
    sourceLabel: 'Broward County GIS parcel layer',
  },
  'palm-beach': {
    baseUrl: 'https://services1.arcgis.com/QYfzdOpn8pmpxFjC/arcgis/rest/services/Parcels/FeatureServer/0',
    sourceLabel: 'Palm Beach County GIS parcel layer',
  },
  'monroe': {
    baseUrl: 'https://services1.arcgis.com/dJ5bRKvwuEhZ8DtR/arcgis/rest/services/Monroe_Parcels/FeatureServer/0',
    sourceLabel: 'Monroe County GIS parcel layer',
  },
  'orange': {
    baseUrl: 'https://services9.arcgis.com/ab4yjZCYn5BC1aWc/arcgis/rest/services/Parcels/FeatureServer/0',
    sourceLabel: 'Orange County GIS parcel layer',
  },
};

// Statewide fallback. The previous URL is dead (returns 400 Invalid URL); none
// of the obvious replacements (FDOR / FGDL / DEP) currently expose a public
// unauthenticated parcel REST endpoint that I could verify. Set to null until
// we identify a working statewide source — for now, addresses outside the
// per-county list fall through directly to the synthetic box.
// TODO: try the DOR FTP/zip layer mirrored to GeoPlatform, or a per-county
// ArcGIS hub for each of the 62 remaining FL counties.
const STATEWIDE_ENDPOINT: EsriQueryOpts | null = null;

// ---------------------------------------------------------------------------
// Fallback polygon — a small square around the point, in lat/lng.
// ~100ft on each side at Florida latitudes. Purely to give the vision model
// a "subject area" box when no real parcel polygon is retrievable.
// ---------------------------------------------------------------------------

function fallbackSquare(lat: number, lng: number, meters = 12): ParcelPolygonResult {
  // Rough degree-per-meter at Florida latitudes (~25–30°N).
  // 12m half-side ≈ 80ft total — fits inside a typical urban Miami residential
  // lot (50–75ft wide) without spilling into neighbors. The previous 18m
  // half-side ≈ 120ft frequently overlapped two adjacent parcels.
  const dLat = meters / 111_320;                       // ~1 deg lat ≈ 111.32 km
  const dLng = meters / (111_320 * Math.cos((lat * Math.PI) / 180));
  const polygon: ParcelRing = [
    [lat + dLat, lng - dLng],
    [lat + dLat, lng + dLng],
    [lat - dLat, lng + dLng],
    [lat - dLat, lng - dLng],
    [lat + dLat, lng - dLng],
  ];
  return {
    polygon,
    source: 'synthesized ~80ft box around geocoded point (no parcel layer available)',
    isFallback: true,
  };
}

// ---------------------------------------------------------------------------
// Public: fetchParcelPolygon
// ---------------------------------------------------------------------------

export async function fetchParcelPolygon(
  lat: number,
  lng: number,
  countyKey: string | null,
): Promise<ParcelPolygonResult> {
  // 1. Try the county-specific endpoint if we know one.
  if (countyKey) {
    const ep = COUNTY_ENDPOINTS[countyKey];
    if (ep) {
      const r = await queryEsriByPoint(lat, lng, ep);
      if (r) return r;
    }
  }

  // 2. Statewide (currently null — see comment above).
  if (STATEWIDE_ENDPOINT) {
    const s = await queryEsriByPoint(lat, lng, STATEWIDE_ENDPOINT);
    if (s) return s;
  }

  // 3. Fallback box — so the red outline still shows up on the sat image.
  return fallbackSquare(lat, lng);
}
