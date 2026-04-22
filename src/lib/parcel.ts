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
  try {
    const u = new URL(opts.baseUrl + '/query');
    u.searchParams.set('geometry', JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }));
    u.searchParams.set('geometryType', 'esriGeometryPoint');
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
    if (!res.ok) return null;
    const data: any = await res.json();
    const rings: any[] | undefined = data?.features?.[0]?.geometry?.rings;
    if (!Array.isArray(rings) || rings.length === 0) return null;
    const ring = rings[0];
    if (!Array.isArray(ring) || ring.length < 3) return null;
    // ESRI returns rings as [[x,y], ...] = [[lng,lat], ...]
    const latLngRing: ParcelRing = ring.map((pt: any[]) => [Number(pt[1]), Number(pt[0])]);
    if (latLngRing.some(([la, ln]) => !Number.isFinite(la) || !Number.isFinite(ln))) return null;
    return { polygon: latLngRing, source: opts.sourceLabel, isFallback: false };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-county ArcGIS endpoints (best known). When a county isn't listed, we
// fall through to the statewide layer.
// ---------------------------------------------------------------------------

const COUNTY_ENDPOINTS: Record<string, EsriQueryOpts> = {
  'miami-dade': {
    baseUrl: 'https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/MDC_Parcel/FeatureServer/0',
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

// Statewide fallback — Florida Department of Revenue publishes a rolled-up
// parcel layer that covers all 67 counties.
const STATEWIDE_ENDPOINT: EsriQueryOpts = {
  baseUrl: 'https://services1.arcgis.com/KdZm1lEtbRM3E29W/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0',
  sourceLabel: 'Florida DOR Statewide Cadastral',
};

// ---------------------------------------------------------------------------
// Fallback polygon — a small square around the point, in lat/lng.
// ~100ft on each side at Florida latitudes. Purely to give the vision model
// a "subject area" box when no real parcel polygon is retrievable.
// ---------------------------------------------------------------------------

function fallbackSquare(lat: number, lng: number, meters = 18): ParcelPolygonResult {
  // Rough degree-per-meter at Florida latitudes (~25–30°N).
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
    source: 'synthesized ~120ft box around geocoded point (no parcel layer available)',
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

  // 2. Statewide.
  const s = await queryEsriByPoint(lat, lng, STATEWIDE_ENDPOINT);
  if (s) return s;

  // 3. Fallback box — so the red outline still shows up on the sat image.
  return fallbackSquare(lat, lng);
}
