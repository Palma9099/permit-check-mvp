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

  return { folio: ordered[0]?.folio ?? null, candidates: ordered };
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
