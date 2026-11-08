// Generic ArcGIS layer query, for county and city layers that are not on the
// one Miami-Dade host (miami-dade-raw.ts has its own, kept as-is).
//
// The rule that matters: ArcGIS answers HTTP 200 with an {error} body when a
// layer needs a token or has been removed. Treating that as "no rows" once
// turned a locked permit layer into "zero permits" in every report, so an
// error body throws here. A lien search must never read a failed source as
// clear.

import { fetchWithTimeout } from './net';

export interface LayerQuery {
  where?: string;
  outFields?: string;
  resultRecordCount?: number;
  returnCentroid?: boolean;
  returnCountOnly?: boolean;
  /** Point-in-polygon: lat/lng in WGS84. */
  point?: { lat: number; lng: number };
  timeoutMs?: number;
  label?: string;
}

function params(q: LayerQuery): URLSearchParams {
  const p = new URLSearchParams({
    outFields: q.outFields ?? '*',
    returnGeometry: 'false',
    f: 'json',
  });
  if (q.point) {
    p.set('geometry', JSON.stringify({ x: q.point.lng, y: q.point.lat, spatialReference: { wkid: 4326 } }));
    p.set('geometryType', 'esriGeometryPoint');
    p.set('inSR', '4326');
    p.set('spatialRel', 'esriSpatialRelIntersects');
  }
  // A spatial query needs no where clause; a non-spatial one always does.
  p.set('where', q.where ?? (q.point ? '1=1' : '1=1'));
  if (q.resultRecordCount) p.set('resultRecordCount', String(q.resultRecordCount));
  if (q.returnCentroid) {
    p.set('returnCentroid', 'true');
    p.set('outSR', '4326');
  }
  if (q.returnCountOnly) p.set('returnCountOnly', 'true');
  return p;
}

async function raw(layerUrl: string, q: LayerQuery): Promise<any> {
  const url = `${layerUrl.replace(/\/$/, '')}/query?${params(q).toString()}`;
  const label = q.label ?? 'arcgis';
  const res = await fetchWithTimeout(url, {
    cache: 'no-store',
    timeoutMs: q.timeoutMs ?? 12000,
    retries: 1,
    headers: { accept: 'application/json' },
    label,
  }).catch((e) => {
    throw new Error(`layer query failed (${label}): ${String(e?.message ?? e).slice(0, 160)}`);
  });
  if (!res.ok) throw new Error(`layer query failed (${label}): HTTP ${res.status}`);
  const data: any = await res.json().catch(() => {
    throw new Error(`layer query returned non-JSON (${label})`);
  });
  if (data?.error) {
    throw new Error(`layer query rejected (${label}): ${data.error.code} ${data.error.message}`);
  }
  return data;
}

/** Attribute rows. Throws when the source did not answer properly. */
export async function queryLayer(layerUrl: string, q: LayerQuery = {}): Promise<any[]> {
  const data = await raw(layerUrl, q);
  if (!data || !Array.isArray(data.features)) return [];
  return data.features.map((f: any) => f.attributes ?? {});
}

/** One row plus its polygon centroid, for "where is this parcel" lookups. */
export async function queryOneWithCentroid(
  layerUrl: string,
  q: LayerQuery,
): Promise<{ attributes: any; lat: number; lng: number } | null> {
  const data = await raw(layerUrl, { ...q, returnCentroid: true, resultRecordCount: q.resultRecordCount ?? 1 });
  const feat = Array.isArray(data?.features) ? data.features[0] : null;
  if (!feat) return null;
  const lat = Number(feat.centroid?.y);
  const lng = Number(feat.centroid?.x);
  return {
    attributes: feat.attributes ?? {},
    lat: Number.isFinite(lat) ? lat : NaN,
    lng: Number.isFinite(lng) ? lng : NaN,
  };
}

export const str = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

export const epochDay = (ms: unknown): string | null =>
  typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : null;

/** SQL string literal, single quotes doubled. */
export const sq = (v: string): string => `'${v.replace(/'/g, "''")}'`;
