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

/**
 * Attribute rows. Throws when the source did not answer properly.
 *
 * Codex R2-01: that docstring was already the contract and the code did not
 * keep it. A 200 response whose JSON has no `features` array returned `[]`,
 * indistinguishable from a layer that genuinely matched nothing. Every one of
 * this function's callers is a lien, code-case, permit or boundary source
 * where an empty answer is read as "nothing on this property", so an
 * unreadable body became a clean result - the one failure this product exists
 * to prevent. `raw` already throws on HTTP failure, non-JSON and an {error}
 * body; this closes the last shape that slipped through.
 */
export async function queryLayer(layerUrl: string, q: LayerQuery = {}): Promise<any[]> {
  const data = await raw(layerUrl, q);
  // A count query legitimately answers {count: N} with no features.
  if (q.returnCountOnly) return Array.isArray(data?.features) ? data.features : [];
  if (!data || typeof data !== 'object' || !Array.isArray(data.features)) {
    throw new Error(`layer query returned no features array (${q.label ?? 'arcgis'})`);
  }
  return data.features.map((f: any) => f.attributes ?? {});
}

/**
 * RAW features, with every record proved readable before the caller sees it.
 *
 * `queryLayer` normalizes each feature to `f.attributes ?? {}`, which destroys
 * the one fact a spatial lookup depends on: whether the record was readable at
 * all. A feature with no attributes becomes an empty object, survives into the
 * rows, and then disappears at the caller's first filter - leaving an empty
 * list that looks exactly like a point matching nothing.
 *
 * Codex R3-01 is that bug: `{"features":[{"attributes":{}}]}` passed
 * `queryLayer`, was removed by a `STATE === '12'` filter and the empty
 * remainder was read as "inside no incorporated place". Three rounds of
 * guarding individual shapes did not fix it, because the problem is not any
 * one shape: it is that FILTERING AN UNVALIDATED LIST ERASES THE DIFFERENCE
 * between "no such record" and "a record we could not read".
 *
 * So validation happens here, before any filter: every feature must carry an
 * attributes object, and every field named in `required` must be a non-empty
 * string on every feature. Anything else throws. What comes back can be
 * filtered safely, because an empty result now means the source really had
 * nothing to say.
 */
export async function queryFeaturesValidated(
  layerUrl: string,
  q: LayerQuery,
  required: string[],
): Promise<any[]> {
  const data = await raw(layerUrl, q);
  const label = q.label ?? 'arcgis';
  if (!data || typeof data !== 'object' || !Array.isArray(data.features)) {
    throw new Error(`layer query returned no features array (${label})`);
  }
  return data.features.map((f: any) => {
    const a = f?.attributes;
    if (!a || typeof a !== 'object' || Array.isArray(a)) {
      throw new Error(`layer query returned a feature with no attributes (${label})`);
    }
    for (const field of required) {
      if (!str(a[field])) {
        throw new Error(`layer query returned a feature with no readable ${field} (${label})`);
      }
    }
    return a;
  });
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
