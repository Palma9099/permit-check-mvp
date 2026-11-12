// Miami-Dade County code cases, read from the county's OPEN DATA, not a portal.
//
// The deep scan had Miami-Dade on the `generic` browser scraper pointed at the
// RER permit portal with guessed CSS selectors, and with NO code-case search
// configured at all: its only search block was `permit`, and the "Code
// Enforcement" link went to a department homepage. So the largest
// unincorporated population in Florida, 1,186,954, read as a failed portal.
//
// It was never a portal problem. Miami-Dade publishes its code cases as
// queryable ArcGIS FeatureServers, which the instant report has been reading
// all along (src/lib/miami-dade-raw.ts). Probed anonymously 2026-11-12, all
// four answer with no token, no session and no browser:
//
//   CodeComplianceViolation_Open_View              CASE_NUM, CASE_STATUS, STAT_DESC
//   CodeComplianceViolation_ClosedPast5Years_View  same shape
//   Open_Building_Violations                       CASE_NUM, CASE_TYPE, FOLIO, PROP_ADDR
//   EnergovCodeCasePublicView                      CASENUMBER, TYPE, STATUS
//
// Driving a browser at a page to reach data that is already JSON is slower,
// more fragile and reads less, so this adapter uses `fetch` and never touches
// ctx.page.

import type { ScraperCtx } from './types.js';
import type { ScrapeResult, ScrapedViolation } from '../types.js';
import type { GenericJurisdiction } from './jurisdictions.js';

const ARCGIS = 'https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/ArcGIS/rest/services';
const PARCELS = `${ARCGIS}/MDC_Parcels/FeatureServer/0/query`;

/** Folio as the layers store it: digits only. */
const compactFolio = (f: string | null | undefined): string | null => {
  const d = String(f ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d : null;
};

const clean = (v: unknown): string | null => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s && s !== 'null' && s !== 'undefined' ? s : null;
};

/** ArcGIS epoch milliseconds to an ISO date, or null. */
const asDate = (v: unknown): string | null => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

async function arcgis(url: string, params: Record<string, string>): Promise<any[]> {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u.toString(), { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: any = await res.json();
  // ArcGIS answers 200 with an {error} body when a layer needs a token or is
  // gone. That must never read as "no rows": it once turned a locked permit
  // layer into "zero permits" in every report.
  if (data?.error) throw new Error(`arcgis-error ${data.error?.message ?? ''}`.trim());
  return Array.isArray(data?.features) ? data.features : [];
}

const byFolio = (service: string, field: string, folio: string) =>
  arcgis(`${ARCGIS}/${encodeURIComponent(service)}/FeatureServer/0/query`, {
    where: `${field}='${folio}'`,
    outFields: '*',
    returnGeometry: 'false',
    resultRecordCount: '200',
    f: 'json',
  });

/** The folio containing a point, so an address-only job can still be searched. */
async function folioAtPoint(lat: number, lng: number): Promise<string | null> {
  const rows = await arcgis(PARCELS, {
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'FOLIO',
    returnGeometry: 'false',
    f: 'json',
  });
  return compactFolio(rows[0]?.attributes?.FOLIO);
}

/**
 * The two CodeCompliance views share a shape, including the recorded-lien
 * columns. Those matter more than anything else on the row: a recorded lien
 * attaches to the property and follows it to the next owner, so the book,
 * page and date go into the record rather than being dropped because the
 * violation shape has no field named for them.
 */
export function mapCodeCompliance(a: any, fromLayer: 'Open' | 'Closed'): ScrapedViolation | null {
  const caseNumber = clean(a.CASE_NUM);
  if (!caseNumber) return null;
  const book = clean(a.LN_RECBOOK);
  const page = clean(a.LN_RECPAGE);
  // LN_RECDATE is esriFieldTypeString on this layer, NOT a date field, so it
  // carries text like "01/15/2020" rather than epoch milliseconds. Running it
  // through asDate would silently drop every real lien date. CASE_DATE beside
  // it IS esriFieldTypeDate, which is why the two are read differently.
  const lienDate = clean(a.LN_RECDATE);
  const lien =
    book && page
      ? `Lien recorded at Official Records book ${book}, page ${page}${lienDate ? `, ${lienDate}` : ''}.`
      : null;
  return {
    caseNumber,
    status: clean(a.STAT_DESC) ?? clean(a.CASE_STATUS) ?? fromLayer,
    openedDate: asDate(a.CASE_DATE),
    closedDate: null,
    description: clean(a.PROBLEM_DESC) ?? clean(a.PROBLEM),
    lastAction: clean(a.LAST_ACTV),
    recordAddress: clean(a.ADDRESS),
    details: lien,
  };
}

/**
 * Open_Building_Violations. This layer publishes NO status column.
 *
 * CASE_TYPE is the violation ("Expired Permit", "All Other Code Violations").
 * VIOL_NAME is NOT a description: it holds a party name ("AMERICAN LARA DREAM
 * LLC") or a placeholder ("REFERENCE ONLY"), checked on two folios. An earlier
 * draft preferred it and put a company's name where a reader looks for what
 * was cited, so it is not published at all.
 */
export function mapBuildingViolation(a: any): ScrapedViolation | null {
  const caseNumber = clean(a.CASE_NUM);
  if (!caseNumber) return null;
  const closed = asDate(a.CLOSED_DATE);
  return {
    caseNumber,
    // Read from the data, not assumed from the layer's name: a closed date
    // means closed, and its absence in a layer of OPEN violations means open.
    status: closed ? 'Closed' : 'Open',
    openedDate: asDate(a.OPEN_DATE),
    closedDate: closed,
    description: clean(a.CASE_TYPE),
    lastAction: null,
    recordAddress: clean(a.PROP_ADDR),
    details: clean(a.PERMIT_NUM) ? `Permit ${clean(a.PERMIT_NUM)}` : null,
  };
}

/** EnerGov, which names nearly every field differently from the others. */
export function mapEnergovCase(a: any): ScrapedViolation | null {
  const caseNumber = clean(a.CASENUMBER);
  if (!caseNumber) return null;
  return {
    caseNumber,
    status: clean(a.STATUS),
    openedDate: asDate(a.OPENEDDATE),
    closedDate: asDate(a.CLOSEDDATE),
    description: clean(a.DESCRIPTION) ?? clean(a.TYPE),
    lastAction: null,
    recordAddress: clean(a.ADDRESSLINE1),
  };
}

export async function runMiamiDadeScrape(
  ctx: ScraperCtx,
  jur: GenericJurisdiction,
): Promise<ScrapeResult> {
  const { log } = ctx;
  const portalLinks = jur.config?.portalLinks ?? [];
  const base: ScrapeResult = {
    ok: false,
    county: 'miami-dade',
    matchedAddress: ctx.address ?? null,
    folio: null,
    permits: [],
    violations: [],
    notes: [],
    portalLinks,
    source: 'Miami-Dade County open data (ArcGIS): code compliance, building violations, EnerGov code cases',
    violationsChecked: false,
    permitsChecked: false,
  };

  // These layers are keyed by folio. Without one there is nothing to search,
  // and saying so is the answer; an address string is not a parcel.
  let folio = compactFolio(ctx.folio);
  if (!folio && ctx.lat != null && ctx.lng != null) {
    folio = await folioAtPoint(ctx.lat, ctx.lng).catch(() => null);
    if (folio) log(`miami-dade: folio ${folio} from the parcel point`);
  }
  if (!folio) {
    base.notes.push(
      "Miami-Dade's code records are filed by folio and this job carried none, so nothing was searched. That is not the same as the property being clear. Look the folio up on the Property Appraiser link below and re-run.",
    );
    return base;
  }
  base.folio = folio;

  // Each layer is its own question. One failing must not silently shrink the
  // list, so a rejection fails the whole read rather than publishing a partial
  // one as complete.
  // Each layer has its OWN shape, so each gets its own mapper. A generic
  // "try these field names" pass across all four silently drops whatever it
  // does not guess, and these layers disagree on nearly every name: OPEN_DATE
  // vs CASE_DATE vs OPENEDDATE, VIOL_NAME vs PROBLEM_DESC vs DESCRIPTION.
  type Layer = {
    service: string;
    field: string;
    label: string;
    map: (a: any) => ScrapedViolation | null;
  };

  const layers: Layer[] = [
    {
      service: 'CodeComplianceViolation_Open_View',
      field: 'FOLIO',
      label: 'open code compliance',
      map: (a) => mapCodeCompliance(a, 'Open'),
    },
    {
      service: 'CodeComplianceViolation_ClosedPast5Years_View',
      field: 'FOLIO',
      label: 'code compliance closed in the past 5 years',
      map: (a) => mapCodeCompliance(a, 'Closed'),
    },
    {
      service: 'Open_Building_Violations',
      field: 'FOLIO',
      label: 'open building violations',
      map: mapBuildingViolation,
    },
    {
      service: 'EnergovCodeCasePublicView',
      field: 'PARCELNUMBER',
      label: 'EnerGov code cases',
      map: mapEnergovCase,
    },
  ];
  const violations: ScrapedViolation[] = [];
  const failed: string[] = [];

  for (const l of layers) {
    try {
      const rows = await byFolio(l.service, l.field, folio);
      log(`miami-dade: ${rows.length} row(s) from ${l.label}`);
      for (const r of rows) {
        const v = l.map(r.attributes ?? {});
        if (v) violations.push(v);
      }
    } catch (e: any) {
      failed.push(`${l.label} (${String(e?.message ?? e).slice(0, 60)})`);
    }
  }

  if (failed.length) {
    // A partial read published as a list is how a property with an open case
    // reads as clean.
    base.notes.push(
      `Miami-Dade's ${failed.join(' and ')} could not be read on this run, so this list is incomplete and nothing here is a clear result. Use the portal links below.`,
    );
    return base;
  }

  // Dedupe: a case can appear in more than one layer.
  const seen = new Set<string>();
  base.violations = violations.filter((v) => {
    const k = `${v.caseNumber ?? ''}|${v.status ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  base.ok = true;
  base.violationsChecked = true;
  // Permits are a separate question and this adapter does not answer it. Saying
  // so is the whole reason violationsChecked and permitsChecked are separate:
  // an adapter that searched one axis was reporting the other as empty.
  base.permitsChecked = false;
  base.notes.push(
    'Permits were NOT searched on this run, so an empty permit list here means nothing. Use the Miami-Dade Permits link below.',
  );
  base.notes.push(
    "These are Miami-Dade COUNTY records, which cover unincorporated county territory. If this parcel sits inside a city, that city is its own code authority and finding nothing here says nothing about the property: the city's own records still need checking.",
  );

  return base;
}
