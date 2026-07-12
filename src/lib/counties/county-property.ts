// Per-county property lookup from each county's OWN hosted parcel layer.
//
// Why this exists: the FL DOR statewide cadastral layer (see statewide-cadastral.ts)
// is one giant multi-million-polygon layer, and its point-in-polygon query is slow
// and hangs intermittently from serverless (property data would come back empty and
// degrade to the "confirm with the PA" line). Each county Property Appraiser also
// publishes its OWN parcel layer as a hosted ArcGIS Online feature service - those
// are single-county and indexed, so a point query returns in a couple of seconds.
//
// This module queries those fast per-county layers first; the statewide adapter
// falls back to the FDOR layer only if a county has no fast source here. Each county
// is a self-contained fetcher (own endpoint + field mapping), dispatched by key.
//
// Validated live:
//   • Broward - BCPA "PARCEL_POLY_BCPA_TAXROLL" hosted layer (~3s, 500k+ parcels).

import type { StatewideParcel } from './statewide-cadastral';
import { dorUseDescription } from './statewide-cadastral';
import { fetchWithTimeout } from '../net';

// ---------------------------------------------------------------------------
// Small local helpers (kept independent of the FDOR module's internals).
// ---------------------------------------------------------------------------
function s(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}
function posNum(v: unknown): number | null {
  const n =
    typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[, $]+/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
function titleCase(a: string): string {
  return a
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(N|S|E|W|NE|NW|SE|SW|Ne|Nw|Se|Sw)\b/g, (m) => m.toUpperCase());
}

// Query a hosted county parcel layer at a point / small envelope, preferring a
// parcel that actually has building data (so a road / right-of-way hit widens to
// the adjacent building parcel). Never throws.
async function queryLayer(baseUrl: string, geometry: string, geometryType: string, label: string): Promise<any[]> {
  const params = new URLSearchParams({
    geometry,
    geometryType,
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'false',
    resultRecordCount: '8',
    f: 'json',
  });
  try {
    const res = await fetchWithTimeout(`${baseUrl}/query?${params.toString()}`, {
      cache: 'no-store', timeoutMs: 9000, retries: 1, label,
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    if (data?.error) return [];
    return Array.isArray(data?.features) ? data.features.map((f: any) => f.attributes ?? {}) : [];
  } catch {
    return [];
  }
}

async function resolveParcel(
  baseUrl: string,
  lat: number,
  lng: number,
  hasBuilding: (a: any) => boolean,
  map: (a: any) => StatewideParcel,
  label: string,
): Promise<StatewideParcel | null> {
  const pick = (rows: any[]): any | null => rows.find(hasBuilding) ?? rows[0] ?? null;
  const point = JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } });
  let chosen = pick(await queryLayer(baseUrl, point, 'esriGeometryPoint', label));
  if (!chosen || !hasBuilding(chosen)) {
    const d = 0.00016; // ~18m
    const env = JSON.stringify({
      xmin: lng - d, ymin: lat - d, xmax: lng + d, ymax: lat + d,
      spatialReference: { wkid: 4326 },
    });
    const envBest = pick(await queryLayer(baseUrl, env, 'esriGeometryEnvelope', label));
    if (envBest && (hasBuilding(envBest) || !chosen)) chosen = envBest;
  }
  return chosen ? map(chosen) : null;
}

// ---------------------------------------------------------------------------
// Broward - BCPA tax-roll parcel layer (hosted on ArcGIS Online).
// ---------------------------------------------------------------------------
const BROWARD_LAYER =
  'https://services.arcgis.com/JMAJrTsHNLrSsWf5/arcgis/rest/services/PARCEL_POLY_BCPA_TAXROLL/FeatureServer/0';

function browardHasBuilding(a: any): boolean {
  return !!(posNum(a?.ACTUAL_YEAR_BUILT) || posNum(a?.BLDG_YEAR_BUILT) || posNum(a?.BLDG_ADJ_SQ_FOOTAGE) || posNum(a?.BLDG_TOT_SQ_FOOTAGE));
}

function browardMap(a: any): StatewideParcel {
  const street = s(a?.ADDRESS_LINE_1);
  const city = s(a?.ADDRESS_LINE_2).split(/\s{2,}/)[0] || '';
  const zip = s(a?.SITUS_ZIP_CODE);
  const siteAddress = street
    ? titleCase([street, city].filter(Boolean).join(', ')) + (zip ? ` ${zip}` : '')
    : null;
  const owner = s(a?.OWNER_NAME_1) || s(a?.NAME_LINE_1) || s(a?.OWNER_NAME) || null;
  const landSf = /sf/i.test(s(a?.LAND_CALC_TYPE_1)) ? posNum(a?.LAND_CALC_FACT_1) : null;
  return {
    coNo: 16,
    countyKey: 'broward',
    parcelId: s(a?.FOLIO) || s(a?.FOLIO_NUMBER) || null,
    owner,
    siteAddress,
    mailingAddress: null,
    mailingMatchesSite: null,
    yearBuilt: posNum(a?.ACTUAL_YEAR_BUILT) ?? posNum(a?.BLDG_YEAR_BUILT),
    effectiveYearBuilt: null,
    livingArea: posNum(a?.BLDG_ADJ_SQ_FOOTAGE) ?? posNum(a?.BLDG_TOT_SQ_FOOTAGE),
    landSqft: landSf,
    dorUseDescription: dorUseDescription(a?.USE_CODE ?? a?.BLDG_USE_CODE),
    legal: null,
    justValue: posNum(a?.JUST_LAND_VALUE),
    assessedValue: posNum(a?.LAST_YRS_ASSESSED),
    taxableValue: posNum(a?.LAST_YRS_TAXABLE_VALUE),
    homesteadStatusText: 'Homestead status not evaluated from this source; confirm with the BCPA record.',
    sales: [],
    assessmentYear: null,
  };
}

// ---------------------------------------------------------------------------
// Dispatch. Returns null for counties without a fast per-county source, so the
// statewide adapter cleanly falls back to the FDOR layer.
// ---------------------------------------------------------------------------
export async function fetchCountyProperty(
  countyKey: string | null,
  lat: number,
  lng: number,
): Promise<StatewideParcel | null> {
  if (!countyKey) return null;
  // Directory slugs are prefixed ("fl-broward"); normalize to the bare key.
  const key = countyKey.replace(/^fl-/, '');
  try {
    if (key === 'broward') {
      return await resolveParcel(BROWARD_LAYER, lat, lng, browardHasBuilding, browardMap, 'bcpa-property');
    }
    return null;
  } catch {
    return null;
  }
}
