// Palma Lien Search: the municipal lien search a title company orders before a
// Miami-Dade closing.
//
// The county's open-data layers carry most of it: recorded code liens (with
// Official Records book and page), fines sent to collections, open code and
// building cases (unsafe structures included), environmental (DERM) cases, and
// open or expired permits. Those are pulled here, by folio.
//
// Three parts sit behind a captcha or bot wall and are never automated: the Tax
// Collector (taxes and tax certificates), the Clerk's Official Records (liens
// and releases) and the water and sewer balance. Palma staff complete those
// before the search is delivered; they are listed as staff steps.
//
// A source that did not answer is reported as "could not be checked", never as
// clear.

import type { Permit } from './types';
import {
  arcgisQuery,
  cleanString,
  compactFolio,
  fromEpochMs,
  mergePermits,
  paByFolio,
  permitLayerByFolio,
  permitsByFolio,
} from './miami-dade-raw';

export type LienTone = 'red' | 'amber' | 'green';

export interface LienLine {
  title: string;
  detail: string;
  tone: LienTone;
}

export interface LienSection {
  key: 'liens' | 'code' | 'building' | 'permits' | 'environment';
  title: string;
  state: 'clear' | 'found' | 'failed';
  summary: string;
  lines: LienLine[];
  source: string;
}

export interface StaffStep {
  key: 'taxes' | 'records' | 'utilities' | 'city';
  title: string;
  how: string;
}

export interface LienSearch {
  folio: string;
  prettyFolio: string;
  address: string | null;
  owner: string | null;
  legal: string | null;
  municipality: string | null;
  unincorporated: boolean;
  searchedAt: string;
  sections: LienSection[];
  staffSteps: StaffStep[];
  found: number; // lines that need action (red or amber)
  failed: number; // sections that could not be checked
}

const pretty = (f: string) => `${f.slice(0, 2)}-${f.slice(2, 6)}-${f.slice(6, 9)}-${f.slice(9)}`;
const dt = (s: string | null) =>
  s ? new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'date not shown';
// The code-lien layer writes recording dates as MM/DD/YYYY.
const mdy = (s: string) => {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? dt(`${m[3]}-${m[1]}-${m[2]}`) : s || 'date not shown';
};
const cap = (s: string) => s.toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

// County code-compliance cases (CCVIOL). Status codes: 1 Open, 2 Closed,
// 4 Lien, 6 Civil, 8 Referred to Internal Compliance (collections), 9 Active LP.
const RELEASED = /satisf|cancel|fulfilled|case closed/i;

function ccviolLines(rows: any[]): { liens: LienLine[]; open: LienLine[] } {
  const liens: LienLine[] = [];
  const open: LienLine[] = [];
  for (const r of rows) {
    const num = cleanString(r.CASE_NUM);
    const stat = cleanString(r.STAT_DESC);
    const last = cleanString(r.LAST_ACTV);
    const what = cap(cleanString(r.PROBLEM_DESC) || 'Code violation');
    const opened = dt(fromEpochMs(r.CASE_DATE));
    const book = cleanString(r.LN_RECBOOK);
    const page = cleanString(r.LN_RECPAGE);
    const rec = cleanString(r.LN_RECDATE);
    if (book) {
      const released = RELEASED.test(last);
      liens.push({
        title: `Code lien, case ${num}`,
        detail: `${what}. Recorded ${mdy(rec)}, Official Records Book ${book} Page ${page}. ${
          released ? `County shows "${last}". Confirm the release is recorded.` : `County shows "${last || stat}", no release on file.`
        }`,
        tone: released ? 'green' : 'red',
      });
    } else if (/^lien/i.test(stat)) {
      liens.push({ title: `Lien in process, case ${num}`, detail: `${what}, opened ${opened}. Not recorded yet. County shows "${last}".`, tone: 'red' });
    } else if (/referred/i.test(stat)) {
      liens.push({ title: `Fines sent to county collections, case ${num}`, detail: `${what}, opened ${opened}. County shows "${last}".`, tone: 'red' });
    } else if (/civil|active lp/i.test(stat)) {
      liens.push({ title: `Court action, case ${num}`, detail: `${what}, opened ${opened}. Status "${stat}".`, tone: 'red' });
    } else if (/^open/i.test(stat)) {
      open.push({ title: `Open code case ${num}`, detail: `${what}, opened ${opened}. Last action "${last}".`, tone: 'amber' });
    }
  }
  return { liens, open };
}

// The county's newer code-case system (EnerGov).
function energovLines(rows: any[]): { liens: LienLine[]; open: LienLine[] } {
  const liens: LienLine[] = [];
  const open: LienLine[] = [];
  for (const r of rows) {
    const status = cleanString(r.STATUS);
    if (!status || /^closed/i.test(status)) continue;
    const line = {
      title: `Code case ${cleanString(r.CASENUMBER)}`,
      detail: `${cleanString(r.TYPE) || cleanString(r.DESCRIPTION) || 'Code case'}, opened ${dt(fromEpochMs(r.OPENEDDATE))}. Status "${status}".`,
    };
    if (/lien|collection/i.test(status)) liens.push({ ...line, tone: 'red' });
    else open.push({ ...line, tone: 'amber' });
  }
  return { liens, open };
}

function permitLines(permits: Permit[]): LienLine[] {
  const out: LienLine[] = [];
  for (const p of permits) {
    const s = p.status ?? '';
    if (/^closed out/i.test(s)) continue;
    const expired = /^expired/i.test(s);
    const work = (p.scope ?? '').split(' - ')[0].trim();
    const status = (s || 'No inspection on record').replace(/\d{4}-\d{2}-\d{2}/g, (d) => dt(d));
    out.push({
      title: `${expired ? 'Expired' : 'Open'} permit ${p.permitNumber ?? ''}`.trim(),
      detail: `${work ? work[0].toUpperCase() + work.slice(1).toLowerCase() : p.appType ?? 'Permit'}. Issued ${dt(p.issueDate)}. ${status}.`,
      tone: expired ? 'red' : 'amber',
    });
  }
  return out;
}

function section(
  key: LienSection['key'],
  title: string,
  source: string,
  result: PromiseSettledResult<LienLine[]>,
  clearText: string,
): LienSection {
  if (result.status === 'rejected') {
    return { key, title, source, state: 'failed', lines: [], summary: 'The county source did not answer. Palma staff check this by hand before delivery.' };
  }
  // Satisfied liens matter only for checking releases: one line with their
  // Official Records references instead of a line each.
  const sat = result.value.filter((l) => l.tone === 'green');
  const lines =
    sat.length > 2
      ? [
          ...result.value.filter((l) => l.tone !== 'green'),
          {
            title: `${sat.length} older liens shown as satisfied`,
            detail: `Official Records Book/Page: ${sat.map((l) => l.detail.match(/Book (\S+) Page (\S+?)\./)?.slice(1, 3).join('/')).filter(Boolean).join(', ')}. Confirm each release is recorded.`,
            tone: 'green' as const,
          },
        ]
      : result.value;
  const problems = lines.filter((l) => l.tone !== 'green').length;
  const released = sat.length;
  const old = released ? ` ${released} older lien${released > 1 ? 's show' : ' shows'} as satisfied; confirm the release${released > 1 ? 's are' : ' is'} recorded.` : '';
  return {
    key,
    title,
    source,
    // Problems first, satisfied liens after.
    lines: [...lines].sort((a, b) => Number(a.tone === 'green') - Number(b.tone === 'green')),
    state: problems ? 'found' : 'clear',
    summary: (problems ? `${problems} item${problems > 1 ? 's' : ''} to resolve before closing.` : clearText) + old,
  };
}

export async function runLienSearch(folioIn: string): Promise<LienSearch> {
  const f = compactFolio(folioIn);
  const where = `FOLIO='${f}'`;
  const [pa, ccviol, energov, bv, derm, table, layer] = await Promise.allSettled([
    paByFolio(f),
    arcgisQuery('CCVIOL_gdb', where),
    arcgisQuery('EnergovCodeCasePublicView', `PARCELNUMBER='${f}'`),
    arcgisQuery('BuildingViolation_gdb', where),
    arcgisQuery('DermEnforcement', where),
    permitsByFolio(f),
    permitLayerByFolio(f),
  ]);

  // Liens recorded on building-violation cases sit in their own table, keyed by
  // case number.
  const bvRows = bv.status === 'fulfilled' ? bv.value : [];
  const bvNums = bvRows.map((r) => cleanString(r.CASE_NUM)).filter((n) => /^\d+$/.test(n));
  const bvLiens: PromiseSettledResult<any[]> = bvNums.length
    ? await Promise.allSettled([arcgisQuery('BuildingViolationLien', `CASE_NUM IN (${bvNums.map((n) => `'${n}'`).join(',')})`)]).then((r) => r[0])
    : { status: 'fulfilled', value: [] };

  const cc = ccviol.status === 'fulfilled' ? ccviolLines(ccviol.value) : null;
  const eg = energov.status === 'fulfilled' ? energovLines(energov.value) : null;

  const liensRes: PromiseSettledResult<LienLine[]> =
    ccviol.status === 'rejected' || energov.status === 'rejected' || bv.status === 'rejected' || bvLiens.status === 'rejected'
      ? { status: 'rejected', reason: 'source failed' }
      : {
          status: 'fulfilled',
          value: [
            ...cc!.liens,
            ...eg!.liens,
            ...(bvLiens as PromiseFulfilledResult<any[]>).value.map((l) => ({
              title: `Building violation lien, case ${cleanString(l.CASE_NUM)}`,
              detail: `Recorded ${dt(fromEpochMs(l.LIEN_RECDT))}, Official Records Book ${l.LIEN_BOOK} Page ${l.LIEN_PAGE}. The county layer does not show releases; confirm payoff or release.`,
              tone: 'red' as const,
            })),
          ],
        };

  const codeRes: PromiseSettledResult<LienLine[]> =
    ccviol.status === 'rejected' || energov.status === 'rejected'
      ? { status: 'rejected', reason: 'source failed' }
      : { status: 'fulfilled', value: [...cc!.open, ...eg!.open] };

  const buildingRes: PromiseSettledResult<LienLine[]> =
    bv.status === 'rejected'
      ? bv
      : {
          status: 'fulfilled',
          value: bvRows
            .filter((r) => !r.CLOSED_DATE)
            .map((r) => {
              const type = cleanString(r.CASE_TYPE) || 'Building violation';
              return {
                title: `${type}, case ${cleanString(r.CASE_NUM)}`,
                detail: `Opened ${dt(fromEpochMs(r.OPEN_DATE))}${cleanString(r.PERMIT_NUM) ? `, permit ${cleanString(r.PERMIT_NUM)}` : ''}. Still open.`,
                tone: /unsafe/i.test(type) ? ('red' as const) : ('amber' as const),
              };
            }),
        };

  // Permits: the 2020+ table and the older GIS layer. Both must answer, or an
  // old expired permit could be missed.
  const permitsRes: PromiseSettledResult<LienLine[]> =
    table.status === 'rejected' || layer.status === 'rejected'
      ? { status: 'rejected', reason: 'source failed' }
      : { status: 'fulfilled', value: permitLines(mergePermits(table.value, layer.value)) };

  const envRes: PromiseSettledResult<LienLine[]> =
    derm.status === 'rejected'
      ? derm
      : {
          status: 'fulfilled',
          value: derm.value
            .filter((r) => /^open/i.test(cleanString(r.CASE_STATUS_DESCRIPTION)))
            .map((r) => {
              const level = cleanString(r.CASE_STATUS_LEVEL_DESCRIPTION).replace(/\s+/g, ' ');
              return {
                title: `Environmental case ${cleanString(r.CASE_NUMBER)}`,
                detail: `${cleanString(r.CASE_TYPE_DESCRIPTION) || cleanString(r.CASE_DESCRIPTION) || 'DERM enforcement'}. Stage: ${level || 'open'}.`,
                tone: /lien|court|collection/i.test(level) ? ('red' as const) : ('amber' as const),
              };
            }),
        };

  const sections = [
    section('liens', 'Recorded liens and unpaid fines', 'Miami-Dade Code Compliance and Building violation records', liensRes, 'No open code or building liens and no fines in collections.'),
    section('code', 'Open code cases', 'Miami-Dade Code Compliance (both case systems)', codeRes, 'No open code cases.'),
    section('building', 'Open building violations', 'Miami-Dade Building Department violations, incl. unsafe structures', buildingRes, 'No open building violations or unsafe structure cases.'),
    section('permits', 'Open and expired permits', 'Miami-Dade building permits (county permit table and GIS permit layer)', permitsRes, 'No open or expired county permits.'),
    section('environment', 'Environmental (DERM) cases', 'Miami-Dade Environmental Resources Management enforcement', envRes, 'No open environmental cases.'),
  ];

  const p = pa.status === 'fulfilled' ? pa.value : null;
  const municipality = cleanString(p?.PropertyInfo?.Municipality) || null;
  const unincorporated = !municipality || /unincorporated/i.test(municipality);
  const city = !municipality ? 'the city' : /^miami$/i.test(municipality) ? 'City of Miami' : cap(municipality);
  const staffSteps: StaffStep[] = [
    { key: 'taxes', title: 'Property taxes', how: 'Current-year bill, any delinquent years and tax certificates, from the Miami-Dade Tax Collector.' },
    { key: 'records', title: 'Official Records', how: 'Recorded liens and releases against the owner and parcel, from the Clerk of the Court and Comptroller.' },
    { key: 'utilities', title: 'Water and sewer', how: unincorporated ? 'Open balance or lien from Miami-Dade Water and Sewer.' : `Open balance or lien from Miami-Dade Water and Sewer or ${city}'s utility.` },
  ];
  if (!unincorporated) {
    staffSteps.push({ key: 'city', title: `${city} lien letter`, how: `${city} code liens, city permits and city fees. The county records above do not cover city cases.` });
  }

  return {
    folio: f,
    prettyFolio: pretty(f),
    address: cleanString(p?.SiteAddress?.[0]?.Address) || null,
    owner: (p?.OwnerInfos ?? []).map((o: any) => cleanString(o?.Name)).filter(Boolean).join(' & ') || null,
    legal: cleanString(p?.LegalDescription?.Description).replace(/\|/g, ', ') || null,
    municipality,
    unincorporated,
    searchedAt: new Date().toISOString(),
    sections,
    staffSteps,
    found: sections.reduce((n, s) => n + s.lines.filter((l) => l.tone !== 'green').length, 0),
    failed: sections.filter((s) => s.state === 'failed').length,
  };
}
