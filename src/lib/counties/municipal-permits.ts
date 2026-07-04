// Municipal permit layer.
//
// Neither Broward nor Palm Beach publishes a COUNTYWIDE building-permit feed —
// permits are issued city by city. Some cities do expose their permit and
// code-enforcement records as queryable ArcGIS layers, though. This module
// queries those city layers by location and returns real permits + code cases
// that the orchestrator merges into the report, even when the county adapter is
// property-data-only (e.g. the statewide FDOR cadastral adapter used for
// Broward). Cities without open permit data simply return nothing and keep
// their portal links.
//
// Design: each city is a self-contained fetcher (own endpoint + field mapping)
// dispatched by county, so adding a city is a localized change and one city's
// schema quirks never affect another. Validated live:
//   • Fort Lauderdale (Broward county seat, ~91k permits + code cases).
//
// Honest scope, surfaced in the report notes: results are matched by geolocation
// (permits at/immediately around the mapped point), so the reader should confirm
// a given permit's address before relying on it.

import type { Permit, CodeCase } from '../types';
import { fetchWithTimeout } from '../net';

export interface MunicipalResult {
  found: boolean; // true only when we actually retrieved rows from a city layer
  cityName: string | null;
  permits: Permit[];
  codeCasesOpen: CodeCase[];
  codeCasesClosedPast5: CodeCase[];
  sources: string[];
  notes: string[];
}

function empty(): MunicipalResult {
  return { found: false, cityName: null, permits: [], codeCasesOpen: [], codeCasesClosedPast5: [], sources: [], notes: [] };
}

// Query an ArcGIS FeatureServer/MapServer layer by a small envelope around a
// point. Returns attribute rows (never throws — failures yield []).
async function queryByPoint(
  layerQueryUrl: string,
  lat: number,
  lng: number,
  outFields: string,
  opts: { meters?: number; orderBy?: string; max?: number; label?: string } = {},
): Promise<any[]> {
  const { meters = 30, orderBy, max = 25, label = 'municipal' } = opts;
  // ~degrees for the requested radius at South Florida latitudes.
  const dLat = meters / 111_320;
  const dLng = meters / (111_320 * Math.cos((lat * Math.PI) / 180));
  const envelope = JSON.stringify({
    xmin: lng - dLng, ymin: lat - dLat, xmax: lng + dLng, ymax: lat + dLat,
    spatialReference: { wkid: 4326 },
  });
  const params = new URLSearchParams({
    geometry: envelope,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
    returnGeometry: 'false',
    resultRecordCount: String(max),
    f: 'json',
  });
  if (orderBy) params.set('orderByFields', orderBy);
  try {
    const res = await fetchWithTimeout(`${layerQueryUrl}?${params.toString()}`, {
      cache: 'no-store', timeoutMs: 10000, retries: 1, label,
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    if (data?.error) return [];
    return Array.isArray(data?.features) ? data.features.map((f: any) => f.attributes ?? {}) : [];
  } catch {
    return [];
  }
}

function s(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
// ArcGIS date fields come back as epoch milliseconds.
function fromEpoch(ms: unknown): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString().slice(0, 10);
}
function isClosedStatus(status: string): boolean {
  return /clos|complet|complied|compliance|resolved|void|withdrawn|final/i.test(status);
}

// ---------------------------------------------------------------------------
// City of Fort Lauderdale — GeneralPurpose/gisdata MapServer
//   layer 27: Building Permits or Land Use Permits
//   layer 30: Code Compliance Cases
// ---------------------------------------------------------------------------
const FTL_PERMITS = 'https://gis.fortlauderdale.gov/arcgis/rest/services/GeneralPurpose/gisdata/MapServer/27/query';
const FTL_CODE = 'https://gis.fortlauderdale.gov/arcgis/rest/services/GeneralPurpose/gisdata/MapServer/30/query';

async function fortLauderdale(lat: number, lng: number): Promise<MunicipalResult> {
  const [permitRows, codeRows] = await Promise.all([
    queryByPoint(FTL_PERMITS, lat, lng,
      'PERMITID,PERMITTYPE,PERMITSTAT,PERMITDESC,SUBMITDT,APPROVEDT,FULLADDR,CONTRACTOR,ESTCOST,COISSUE',
      { meters: 30, orderBy: 'SUBMITDT DESC', max: 30, label: 'ftl-permits' }),
    queryByPoint(FTL_CODE, lat, lng,
      'CASENUM,SITEADDRESS,CASETYPE,CASESTATUS,INITDATE',
      { meters: 30, orderBy: 'INITDATE DESC', max: 20, label: 'ftl-code' }),
  ]);

  const permits: Permit[] = permitRows.map((r) => ({
    permitNumber: s(r.PERMITID) || null,
    processNumber: null,
    appType: s(r.PERMITTYPE) || null,
    issueDate: fromEpoch(r.APPROVEDT) ?? fromEpoch(r.SUBMITDT),
    status: s(r.PERMITSTAT) || null,
    estValue: num(r.ESTCOST),
    contractor: s(r.CONTRACTOR) || null,
    scope: s(r.PERMITDESC) || s(r.FULLADDR) || null,
  }));

  const fiveYearsAgo = Date.now() - 5 * 365.25 * 24 * 3600 * 1000;
  const open: CodeCase[] = [];
  const closedPast5: CodeCase[] = [];
  for (const r of codeRows) {
    const status = s(r.CASESTATUS);
    const initMs = typeof r.INITDATE === 'number' ? r.INITDATE : 0;
    const cc: CodeCase = {
      caseNumber: s(r.CASENUM) || '—',
      caseDate: fromEpoch(r.INITDATE),
      status: status || 'Unknown',
      problemDescription: s(r.CASETYPE) || 'Code compliance case',
      lastAction: s(r.SITEADDRESS),
      lien: '',
    };
    if (isClosedStatus(status)) {
      if (initMs >= fiveYearsAgo) closedPast5.push(cc);
    } else {
      open.push(cc);
    }
  }

  const found = permits.length > 0 || open.length > 0 || closedPast5.length > 0;
  if (!found) return empty();

  return {
    found: true,
    cityName: 'Fort Lauderdale',
    permits,
    codeCasesOpen: open,
    codeCasesClosedPast5: closedPast5,
    sources: [
      'City of Fort Lauderdale GIS (ArcGIS): Building/Land-Use Permits and Code Compliance Cases — queried live by location.',
    ],
    notes: [
      'Fort Lauderdale permit and code records are matched by map location (records at or immediately around this point), so confirm each record’s address matches the subject property before relying on it. Broward has no countywide permit feed; only city-published data is pulled.',
    ],
  };
}

// ---------------------------------------------------------------------------
// Dispatch: run the city fetchers that apply to this county. Extend by adding a
// city fetcher above and a branch here. Only runs where a validated open
// permit layer exists — everything else keeps its portal links.
// ---------------------------------------------------------------------------
export async function fetchMunicipalPermits(input: {
  countyKey: string | null;
  lat: number;
  lng: number;
}): Promise<MunicipalResult> {
  const { countyKey, lat, lng } = input;
  if (!countyKey) return empty();

  try {
    if (countyKey === 'broward') {
      // Currently: Fort Lauderdale. Additional Broward cities with ArcGIS
      // permit layers drop in here as they are validated.
      return await fortLauderdale(lat, lng);
    }
    // Palm Beach: no city or county publishes queryable permit data (permits are
    // behind the ePZB/Accela portal), so there is nothing to pull here yet.
    return empty();
  } catch {
    return empty();
  }
}
