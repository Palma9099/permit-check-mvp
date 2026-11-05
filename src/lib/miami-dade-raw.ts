// Raw Miami-Dade data pulls — split out of miami-dade.ts so the county
// adapter can reuse them without pulling in the legacy assembler.

import type { CodeCase, Permit } from './types';
import { fetchWithTimeout } from './net';

const PA_PROXY =
  'https://apps.miamidadepa.gov/PAPublicServiceProxy/PaServicesProxy.ashx';
const ARCGIS_BASE =
  'https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/ArcGIS/rest/services';

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  // 12s timeout + one retry: MDC's PA proxy and ArcGIS endpoints can stall
  // under load, and a bare fetch here would hang the whole report to the
  // serverless maxDuration. Fail fast so callers' .catch() fallbacks kick in.
  const res = await fetchWithTimeout(url, {
    ...init,
    cache: 'no-store',
    timeoutMs: 12000,
    retries: 1,
    headers: {
      accept: 'application/json',
      ...(init?.headers ?? {}),
    },
    label: 'miami-dade',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function fromEpochMs(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function cleanString(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s.replace(/\s+/g, ' ').trim();
}

export function compactFolio(folio: string): string {
  return folio.replace(/\D+/g, '').padStart(13, '0').slice(-13);
}

export async function paByAddress(
  address: string,
  zip?: string | null,
): Promise<{
  folio: string | null;
  candidates: Array<{ folio: string; address: string }>;
}> {
  const bare = address
    .split(',')[0]
    .replace(/\s+\d{5}(-\d{4})?\s*$/, '')
    .replace(/\s+(miami|fl|florida)\s*.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const url =
    PA_PROXY +
    '?Operation=GetAddress&clientAppName=PropertySearch' +
    '&from=1&to=25' +
    '&myAddress=' + encodeURIComponent(bare) +
    '&myUnit=';
  const data = await fetchJson(url).catch(() => null);
  if (!data) return { folio: null, candidates: [] };
  const list: any[] =
    data?.MinimumPropertyInfos ??
    data?.MinimumPropertyInfo ??
    data?.SearchResults ??
    [];
  if (!Array.isArray(list) || list.length === 0) return { folio: null, candidates: [] };
  const cands = list.map((r: any) => ({
    folio: compactFolio(String(r.Strap ?? r.Folio ?? r.FOLIO ?? '')),
    address: cleanString(r.SiteAddress ?? r.Address ?? ''),
  })).filter((c) => c.folio.length === 13);

  // The Property Appraiser address search matches street-number + name only, so
  // it can return the same street in the wrong city. When we know the ZIP, keep
  // only candidates whose site address carries it — preventing a confident
  // lookup on a same-numbered parcel in a different municipality. If none match
  // the ZIP, fall back to the full list rather than returning nothing.
  const z = zip ? String(zip).replace(/\D+/g, '').slice(0, 5) : '';
  let ordered = cands;
  if (z.length === 5) {
    const inZip = cands.filter((c) => c.address.includes(z));
    if (inZip.length > 0) ordered = inZip;
  }

  // A geocoder can move an address to a neighbouring house number (7861 came
  // back as 8788 once). Never accept a lot whose house number differs from the
  // one searched for.
  const num = bare.match(/^\d+/)?.[0];
  if (num) ordered = ordered.filter((c) => c.address.match(/^\d+/)?.[0] === num);

  return { folio: ordered[0]?.folio ?? null, candidates: ordered };
}

// County parcel layer: which lot contains a point, and where a lot is.
const PARCELS = 'https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/ParcelsView_gdb/FeatureServer/0/query';

export async function folioAtPoint(lat: number, lng: number): Promise<string | null> {
  const q = new URLSearchParams({
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'FOLIO',
    returnGeometry: 'false',
    f: 'json',
  });
  const data = await fetchJson(`${PARCELS}?${q.toString()}`).catch(() => null);
  const f = cleanString(data?.features?.[0]?.attributes?.FOLIO);
  return f ? compactFolio(f) : null;
}

// Centre of a lot by folio (average of its outline points; plenty for
// re-centring a map on a house lot).
export async function lotCenterByFolio(folio: string): Promise<{ lat: number; lng: number } | null> {
  const q = new URLSearchParams({
    where: `FOLIO='${compactFolio(folio)}'`,
    outFields: 'FOLIO',
    outSR: '4326',
    returnGeometry: 'true',
    f: 'json',
  });
  const data = await fetchJson(`${PARCELS}?${q.toString()}`).catch(() => null);
  const ring: number[][] | undefined = data?.features?.[0]?.geometry?.rings?.[0];
  if (!ring?.length) return null;
  const lng = ring.reduce((n, p) => n + p[0], 0) / ring.length;
  const lat = ring.reduce((n, p) => n + p[1], 0) / ring.length;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export async function paByFolio(folio: string): Promise<any | null> {
  const url =
    PA_PROXY +
    '?Operation=GetPropertySearchByFolio&clientAppName=PropertySearch' +
    '&folioNumber=' + encodeURIComponent(compactFolio(folio));
  return fetchJson(url).catch(() => null);
}

async function arcgisQuery(service: string, where: string, out: string = '*'): Promise<any[]> {
  const url =
    `${ARCGIS_BASE}/${encodeURIComponent(service)}/FeatureServer/0/query` +
    `?where=${encodeURIComponent(where)}` +
    `&outFields=${encodeURIComponent(out)}` +
    `&returnGeometry=false&f=json&resultRecordCount=200`;
  const data = await fetchJson(url).catch((e) => {
    throw new Error(`county query failed (${service}): ${e?.message ?? e}`);
  });
  // ArcGIS answers HTTP 200 with an {error} body when a layer needs a token or
  // is gone. Treat that as a failure, never as "no rows" (that once turned a
  // locked permit layer into "zero permits" in every report).
  if (data?.error) {
    throw new Error(`county query rejected (${service}): ${data.error.code} ${data.error.message}`);
  }
  if (!data || !Array.isArray(data.features)) return [];
  return data.features.map((f: any) => f.attributes ?? {});
}

// The old BuildingPermit_gdb layer now requires a token. The county's public
// replacement is the miamidade_permit_data table (same permits, refreshed daily).
const PERMIT_TABLE = 'miamidade_permit_data';

function permitStatus(r: any): string {
  const co = fromEpochMs(r.CoCcDate);
  if (co) return `Closed out ${co}`;
  const insp = fromEpochMs(r.LastApprovedInspDate);
  if (insp) return `Inspected ${insp}, no close-out date`;
  return 'No inspection on record';
}

export async function permitsByFolio(folio: string): Promise<Permit[]> {
  const f = compactFolio(folio);
  const rows = await arcgisQuery(
    PERMIT_TABLE,
    `FolioNumber='${f}'`,
    'FolioNumber,PermitNumber,ProcessNumber,ApplicationTypeDescription,PermitIssuedDate,CoCcDate,LastApprovedInspDate,EstimatedValue,ContractorName,DetailDescriptionComments,CategoryDescription1',
  );
  return rows.map((r) => ({
    permitNumber: cleanString(r.PermitNumber) || null,
    processNumber: cleanString(r.ProcessNumber) || null,
    appType: cleanString(r.ApplicationTypeDescription) || null,
    issueDate: cleanString(r.PermitIssuedDate).slice(0, 10) || null,
    status: permitStatus(r),
    estValue: Number.isFinite(Number(r.EstimatedValue)) && Number(r.EstimatedValue) > 0 ? Number(r.EstimatedValue) : null,
    contractor: cleanString(r.ContractorName).replace(/\\/g, '') || null,
    scope: [cleanString(r.DetailDescriptionComments), cleanString(r.CategoryDescription1)].filter(Boolean).join(' - ') || null,
  }));
}

// The county's GIS permit layer: permits that are active, expired without a
// final inspection, or recently finaled, going back to the 1980s. It is not a
// full history (the full archive sits behind the county's captcha-protected
// search), but it is the only public source of older OPEN and EXPIRED permits,
// which are what block a sale or an insurance claim.
const PERMIT_LAYER =
  'https://gisweb.miamidade.gov/arcgis/rest/services/MD_LandInformation/MapServer/1/query';

const ymd = (s: unknown) => {
  const t = cleanString(s);
  return /^\d{8}$/.test(t) && t !== '00000000' ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : null;
};

export async function permitLayerByFolio(folio: string): Promise<Permit[]> {
  const f = compactFolio(folio);
  const q = new URLSearchParams({
    where: `FOLIO='${f}'`,
    outFields: 'ID,PROCNUM,TYPE,DESC1,FFRMLINE,ISSUDATE,LSTINSDT,BPSTATUS,CONTRNAME',
    returnGeometry: 'false',
    f: 'json',
  });
  const data = await fetchJson(`${PERMIT_LAYER}?${q.toString()}`);
  if (data?.error) throw new Error(`permit layer: ${data.error.message ?? 'error'}`);
  return (data?.features ?? []).map((ft: any) => {
    const r = ft.attributes ?? {};
    const last = ymd(r.LSTINSDT);
    const code = cleanString(r.BPSTATUS);
    const status =
      code === 'E'
        ? `Expired without final inspection${last ? ` (last inspection ${last})` : ''}`
        : code === 'A'
        ? `Open${last ? `, last inspection ${last}` : ', no inspection on record'}`
        : code === 'F'
        ? `Closed out${last ? ` (final inspection ${last})` : ''}`
        : null;
    return {
      permitNumber: r.ID != null ? String(r.ID) : null,
      processNumber: cleanString(r.PROCNUM) || null,
      appType: cleanString(r.DESC1) || cleanString(r.TYPE) || null,
      issueDate: fromEpochMs(r.ISSUDATE),
      status,
      estValue: null,
      contractor: cleanString(r.CONTRNAME) || null,
      scope: cleanString(r.FFRMLINE) || null,
    } as Permit;
  });
}

// Merge the permit table (2020 on, full detail) with the GIS layer (older open
// and expired permits). Same permit number in both: keep the table's detail but
// take the layer's status, which says outright whether the permit finaled,
// expired or is still open; the table only implies it from dates.
export function mergePermits(table: Permit[], layer: Permit[]): Permit[] {
  const byNum = new Map<string, Permit>();
  for (const p of table) if (p.permitNumber) byNum.set(p.permitNumber, p);
  const out = [...table];
  for (const p of layer) {
    const hit = p.permitNumber ? byNum.get(p.permitNumber) : undefined;
    if (hit) {
      if (p.status) hit.status = p.status;
      continue;
    }
    out.push(p);
  }
  return out.sort((a, b) => String(b.issueDate ?? '').localeCompare(String(a.issueDate ?? '')));
}

export async function inspectionsByAddress(addressFragment: string): Promise<number> {
  const frag = addressFragment.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().toUpperCase();
  if (!frag) return 0;
  const rows = await arcgisQuery(
    'inspectionsData',
    `job_site_address LIKE '%${frag.replace(/'/g, "''")}%'`,
    'permit_number,job_site_address'
  );
  return rows.length;
}

export async function neighborPermits(folio: string): Promise<{
  total: number;
  byAddress: Array<{ address: string; count: number }>;
}> {
  const f = compactFolio(folio);
  const prefix = f.slice(0, 9);
  if (prefix.length !== 9) return { total: 0, byAddress: [] };
  const rows = await arcgisQuery(
    PERMIT_TABLE,
    `FolioNumber LIKE '${prefix}%' AND FolioNumber <> '${f}'`,
    'FolioNumber,PropertyAddress,PermitNumber',
  );
  const by = new Map<string, number>();
  for (const r of rows) {
    const a = cleanString(r.PropertyAddress);
    if (!a) continue;
    by.set(a, (by.get(a) ?? 0) + 1);
  }
  const sorted = Array.from(by.entries())
    .map(([address, count]) => ({ address, count }))
    .sort((a, b) => b.count - a.count);
  return { total: rows.length, byAddress: sorted.slice(0, 12) };
}

async function codeCaseQuery(service: string, folio: string): Promise<CodeCase[]> {
  const f = compactFolio(folio);
  const where =
    service.startsWith('Energov') ? `PARCELNUMBER='${f}'` : `FOLIO='${f}'`;
  const rows = await arcgisQuery(service, where);
  return rows.map((r) => ({
    caseNumber: cleanString(r.CASE_NUM ?? r.CASENUMBER ?? ''),
    caseDate: fromEpochMs(r.CASE_DATE ?? r.OPENEDDATE),
    status: cleanString(r.STAT_DESC ?? r.STATUS ?? r.CASE_STATUS ?? ''),
    problemDescription: cleanString(r.PROBLEM_DESC ?? r.DESCRIPTION ?? ''),
    lastAction: cleanString(r.LAST_ACTV ?? ''),
    lien: cleanString(r.LN_RFRLTYP ?? ''),
  }));
}

export async function codeEnforcement(folio: string): Promise<{
  open: CodeCase[];
  closedPast5: CodeCase[];
}> {
  const [open1, open2, open3, closed1, ener1] = await Promise.all([
    codeCaseQuery('CodeComplianceViolation_Open_View', folio),
    codeCaseQuery('Open_Building_Violations', folio),
    codeCaseQuery('BuildingViolation_gdb', folio),
    codeCaseQuery('CodeComplianceViolation_ClosedPast5Years_View', folio),
    codeCaseQuery('EnergovCodeCasePublicView', folio),
  ]);
  const seen = new Set<string>();
  const open = [...open1, ...open2, ...open3, ...ener1].filter((c) => {
    const k = c.caseNumber + '|' + c.caseDate;
    if (seen.has(k)) return false;
    seen.add(k);
    return Boolean(c.caseNumber);
  });
  const closedPast5 = closed1.filter((c) => Boolean(c.caseNumber));
  return { open, closedPast5 };
}
