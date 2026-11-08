// Miami-Dade lien provider.
//
// The county's open-data layers carry most of a lien search: recorded code
// liens (with Official Records book and page), fines sent to collections, open
// code and building cases (unsafe structures included), environmental (DERM)
// cases, and open or expired permits. Those are pulled here, by folio.
//
// Three parts sit behind a captcha or bot wall and are never automated: the Tax
// Collector (taxes and tax certificates), the Clerk's Official Records (liens
// and releases) and the water and sewer balance. Palma staff complete those
// before the search is delivered; they are listed as staff steps.
//
// Miami-Dade is the only Florida county that publishes code-compliance cases
// and the liens recorded on them as parcel-keyed public layers, which is why
// this is the only provider at coverage level 'cases'.

import type { Permit } from '../types';
import {
  arcgisQuery,
  cleanString,
  compactFolio,
  fromEpochMs,
  mergePermits,
  paByFolio,
  permitLayerByFolio,
  permitsByFolio,
} from '../miami-dade-raw';
import {
  cap,
  countTotals,
  dt,
  mdy,
  section,
  type LienCoverage,
  type LienLine,
  type LienSearch,
  type StaffStep,
} from '../lien-types';
import { getCitySource } from './city-sources';

const pretty = (f: string) => `${f.slice(0, 2)}-${f.slice(2, 6)}-${f.slice(6, 9)}-${f.slice(9)}`;

export const MIAMI_DADE_COVERAGE: LienCoverage = {
  level: 'cases',
  automated: [
    'Recorded code liens, with Official Records book and page',
    'Liens in process, fines in county collections and court actions',
    'Open code cases, from both county case systems',
    'Open building violations, unsafe structures included',
    'Environmental (DERM) enforcement cases',
    'Open and expired county building permits',
  ],
  byHand: [
    'Property taxes, delinquent years and tax certificates',
    'Official Records liens and releases against owner and parcel',
    'Water and sewer balance',
    'City lien letter, for a parcel inside a municipality',
  ],
};

// The county layers cover county records. A parcel inside a city also carries
// that city's cases and permits, which the county does not hold; where the
// city publishes them they are pulled too, and the coverage block says so.
function coverageWithCity(cityPermits: boolean): LienCoverage {
  if (!cityPermits) return MIAMI_DADE_COVERAGE;
  return {
    level: 'cases',
    automated: [...MIAMI_DADE_COVERAGE.automated, 'Open, expired, revoked and held City of Miami permits'],
    byHand: MIAMI_DADE_COVERAGE.byHand.map((x) =>
      x.startsWith('City lien letter') ? 'City lien letter: city code liens and city fines' : x,
    ),
  };
}

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

// Liens recorded on building-violation cases sit in their own table, keyed by
// case number.
async function buildingLienRows(bvRows: any[]): Promise<any[]> {
  const nums = bvRows.map((r) => cleanString(r.CASE_NUM)).filter((n) => /^[A-Z0-9]+$/i.test(n));
  return nums.length ? arcgisQuery('BuildingViolationLien', `CASE_NUM IN (${nums.map((n) => `'${n}'`).join(',')})`) : [];
}

const buildingLienLine = (l: any): LienLine => ({
  title: `Building violation lien, case ${cleanString(l.CASE_NUM)}`,
  detail: `Recorded ${dt(fromEpochMs(l.LIEN_RECDT))}, Official Records Book ${l.LIEN_BOOK} Page ${l.LIEN_PAGE}. The county layer does not show releases; confirm payoff or release.`,
  tone: 'red',
});

// Just the liens and unpaid fines still standing, for the property check.
// Throws when a source does not answer, so the caller never reports "none".
export async function miamiDadeOpenLiens(folioIn: string): Promise<{ lines: LienLine[]; scope: string }> {
  const f = compactFolio(folioIn);
  const where = `FOLIO='${f}'`;
  const [ccviol, energov, bv] = await Promise.all([
    arcgisQuery('CCVIOL_gdb', where),
    arcgisQuery('EnergovCodeCasePublicView', `PARCELNUMBER='${f}'`),
    arcgisQuery('BuildingViolation_gdb', where),
  ]);
  const bvLiens = await buildingLienRows(bv);
  const lines = [...ccviolLines(ccviol).liens, ...energovLines(energov).liens, ...bvLiens.map(buildingLienLine)].filter(
    (l) => l.tone !== 'green',
  );
  return { lines, scope: 'Miami-Dade code and building liens and county fines' };
}

export async function runMiamiDadeLienSearch(folioIn: string): Promise<LienSearch> {
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

  const bvRows = bv.status === 'fulfilled' ? bv.value : [];
  const bvLiens = await Promise.allSettled([buildingLienRows(bvRows)]).then((r) => r[0]);

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
            ...(bvLiens as PromiseFulfilledResult<any[]>).value.map(buildingLienLine),
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

  const p0 = pa.status === 'fulfilled' ? pa.value : null;
  const muni = cleanString(p0?.PropertyInfo?.Municipality) || null;
  const cityPull = getCitySource('miami-dade', muni);
  const cityPermitsRes = await Promise.allSettled([
    cityPull?.permits ? cityPull.permits(f) : Promise.resolve<LienLine[]>([]),
  ]).then((r) => r[0]);

  const sections = [
    section('liens', 'Recorded liens and unpaid fines', 'Miami-Dade Code Compliance and Building violation records', liensRes, 'No open code or building liens and no fines in collections.'),
    section('code', 'Open code cases', 'Miami-Dade Code Compliance (both case systems)', codeRes, 'No open code cases.'),
    section('building', 'Open building violations', 'Miami-Dade Building Department violations, incl. unsafe structures', buildingRes, 'No open building violations or unsafe structure cases.'),
    section('permits', 'Open and expired permits', 'Miami-Dade building permits (county permit table and GIS permit layer)', permitsRes, 'No open or expired county permits.'),
    section('environment', 'Environmental (DERM) cases', 'Miami-Dade Environmental Resources Management enforcement', envRes, 'No open environmental cases.'),
  ];
  if (cityPull?.permits) {
    sections.push(
      section(
        'cityPermits',
        `Open and expired ${cityPull.label} permits`,
        cityPull.permitSource ?? `${cityPull.label} permits`,
        cityPermitsRes,
        `No open or expired ${cityPull.label} permits.`,
      ),
    );
  }

  const p = p0;
  const municipality = muni;
  const unincorporated = !municipality || /unincorporated/i.test(municipality);
  const city = !municipality ? 'the city' : /^miami$/i.test(municipality) ? 'City of Miami' : cap(municipality);
  const staffSteps: StaffStep[] = [
    {
      key: 'taxes',
      title: 'Property taxes',
      how: 'Current-year bill, any delinquent years and tax certificates, from the Miami-Dade Tax Collector.',
      url: `https://miamidade.county-taxes.com/public/search/property_tax?search_query=${f}`,
    },
    {
      key: 'records',
      title: 'Official Records',
      how: 'Recorded liens and releases against the owner and parcel, from the Clerk of the Court and Comptroller.',
      url: 'https://onlineservices.miamidadeclerk.gov/officialrecords/StandardSearch.aspx',
    },
    { key: 'utilities', title: 'Water and sewer', how: unincorporated ? 'Open balance or lien from Miami-Dade Water and Sewer.' : `Open balance or lien from Miami-Dade Water and Sewer or ${city}'s utility.` },
  ];
  if (!unincorporated) {
    staffSteps.push({
      key: 'city',
      title: `${city} lien letter`,
      how: cityPull?.permits
        ? `${city} code liens, code fines and city fees. The county records above do not cover city cases, and the city publishes no code-case layer. Its permits are pulled live above.`
        : `${city} code liens, city permits and city fees. The county records above do not cover city cases.`,
    });
  }

  return {
    county: 'miami-dade',
    countyName: 'Miami-Dade County',
    parcelLabel: 'Folio',
    coverage: coverageWithCity(Boolean(cityPull?.permits)),
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
    ...countTotals(sections),
  };
}
