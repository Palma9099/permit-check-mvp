// Raw Miami-Dade data pulls — split out of miami-dade.ts so the county
// adapter can reuse them without pulling in the legacy assembler.

import type { CodeCase, Permit } from './types';

const PA_PROXY =
  'https://apps.miamidadepa.gov/PAPublicServiceProxy/PaServicesProxy.ashx';
const ARCGIS_BASE =
  'https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/ArcGIS/rest/services';

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      ...(init?.headers ?? {}),
    },
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

export async function paByAddress(address: string): Promise<{
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
  return { folio: cands[0]?.folio ?? null, candidates: cands };
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
  const data = await fetchJson(url).catch(() => null);
  if (!data || !Array.isArray(data.features)) return [];
  return data.features.map((f: any) => f.attributes ?? {});
}

export async function permitsByFolio(folio: string): Promise<Permit[]> {
  const f = compactFolio(folio);
  const rows = await arcgisQuery(
    'BuildingPermit_gdb',
    `FOLIO='${f}'`,
    'FOLIO,PROCNUM,APPTYPE,ISSUDATE,BPSTATUS,ESTVALUE,CONTRNAME,DESC1,DESC2'
  );
  return rows.map((r) => ({
    permitNumber: cleanString(r.PROCNUM) || null,
    processNumber: cleanString(r.PROCNUM) || null,
    appType: cleanString(r.APPTYPE) || null,
    issueDate: fromEpochMs(r.ISSUDATE),
    status: cleanString(r.BPSTATUS) || null,
    estValue: typeof r.ESTVALUE === 'number' ? r.ESTVALUE : null,
    contractor: cleanString(r.CONTRNAME) || null,
    scope: [cleanString(r.DESC1), cleanString(r.DESC2)].filter(Boolean).join(' — ') || null,
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
    'BuildingPermit_gdb',
    `FOLIO LIKE '${prefix}%' AND FOLIO <> '${f}'`,
    'FOLIO,ADDRESS,PROCNUM'
  );
  const by = new Map<string, number>();
  for (const r of rows) {
    const a = cleanString(r.ADDRESS);
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
