// Extra Miami-Dade facts a buyer or owner cares about, all from public county
// sources: what taxes may do after a sale, permit health, hurricane evacuation
// zone, sewer or septic, and replacement cost. Each piece fails on its own and
// returns null, so a slow county server can never break the report.

import type { Permit } from '../types';
import { fetchWithTimeout } from '../net';
import { compactFolio, paByFolio } from '../miami-dade-raw';

const OPEN_DATA = 'https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/ArcGIS/rest/services';

// Typical combined Miami-Dade millage is roughly 17 to 20 mills. Used only for a
// labelled estimate; the county tax bill sets the real number.
const TYPICAL_RATE = 0.018;

export interface TaxImpact {
  year: number;
  marketValue: number;       // county "just" (market) value
  assessedValue: number;     // value taxes are based on today (after the cap)
  currentTaxable: number;    // county taxable value today (after exemptions)
  afterSaleTaxable: number;  // taxable value if the cap and exemptions reset
  increase: number;          // afterSaleTaxable - currentTaxable (>= 0)
  estAnnualIncrease: number; // increase x typical rate, rounded
  rateAssumed: number;
  hasHomestead: boolean;
}

export interface EvacuationInfo {
  zone: string | null;       // A to E, or null when outside every zone
  category: number | null;   // storm category at which the county orders evacuation
  hvhz: boolean;             // Miami-Dade is a High-Velocity Hurricane Zone
}

export interface SewerInfo {
  utility: string | null;
  inServiceArea: boolean;
  septicOrWellFlag: boolean;
  summary: string;
}

export interface PermitHealth {
  closedOut: number;          // county shows a close-out (certificate of completion or occupancy) date
  inspectedNoCloseout: number; // inspected but no close-out date on record
  noInspection: number;       // issued, but no inspection on record
  expired: number;            // expired without a final inspection (county GIS permit layer)
  items: Array<{
    permitNumber: string | null;
    appType: string | null;
    issueDate: string | null;
    status: string | null;
    bucket: 'closedOut' | 'inspected' | 'noInspection' | 'expired';
    ageYears: number | null;
  }>;
}

export interface CountyExtras {
  tax: TaxImpact | null;
  evacuation: EvacuationInfo | null;
  sewer: SewerInfo | null;
  permitHealth: PermitHealth | null;
  replacementCostNew: number | null;
  sources: string[];
}

/**
 * Did the layer ANSWER, and if so with what?
 *
 * Codex F1: these helpers returned null both for "the service did not answer"
 * and for "the service answered, nothing at this point". The aggregation below
 * then built an evacuation / sewer fact out of the null, and three separate
 * consumers turned that into a published negative: the report card says "This
 * address is outside the county evacuation zones", the PDF prints "Outside
 * county sewer", and the readiness score charges a 2-point penalty for it. A
 * nullable field is not a safe field when something downstream turns the null
 * into a sentence.
 *
 * `answered: false` is unavailable and must never become a claim.
 * `answered: true, attrs: null` is a real empty answer and is entitled to one.
 */
type Lookup = { answered: true; attrs: any | null } | { answered: false };

const UNAVAILABLE: Lookup = { answered: false };

async function arcgisPoint(service: string, lat: number, lng: number): Promise<Lookup> {
  const qs = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'false',
    f: 'json',
  });
  const res = await fetchWithTimeout(`${OPEN_DATA}/${service}/FeatureServer/0/query?${qs}`, {
    cache: 'no-store',
    timeoutMs: 9000,
    retries: 1,
    label: 'md-extras',
  });
  if (!res.ok) return UNAVAILABLE;
  const j: any = await res.json();
  // No features ARRAY means the layer did not answer with a feature
  // collection, which is not the same as answering with none.
  if (!Array.isArray(j?.features)) return UNAVAILABLE;
  return { answered: true, attrs: j.features[0]?.attributes ?? null };
}

async function arcgisWhere(service: string, where: string): Promise<Lookup> {
  const qs = new URLSearchParams({ where, outFields: '*', returnGeometry: 'false', f: 'json' });
  const res = await fetchWithTimeout(`${OPEN_DATA}/${service}/FeatureServer/0/query?${qs}`, {
    cache: 'no-store',
    timeoutMs: 9000,
    retries: 1,
    label: 'md-extras',
  });
  if (!res.ok) return UNAVAILABLE;
  const j: any = await res.json();
  // No features ARRAY means the layer did not answer with a feature
  // collection, which is not the same as answering with none.
  if (!Array.isArray(j?.features)) return UNAVAILABLE;
  return { answered: true, attrs: j.features[0]?.attributes ?? null };
}

function latest<T extends { Year?: number }>(rows: T[] | undefined): T | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return [...rows].sort((a, b) => (b.Year ?? 0) - (a.Year ?? 0))[0];
}

function taxFrom(pa: any): TaxImpact | null {
  const a = latest<any>(pa?.Assessment?.AssessmentInfos);
  const t = latest<any>(pa?.Taxable?.TaxableInfos);
  if (!a || !t) return null;
  const market = Number(a.TotalValue);
  const assessed = Number(a.AssessedValue);
  const currentTaxable = Number(t.CountyTaxableValue);
  if (![market, assessed, currentTaxable].every((n) => Number.isFinite(n) && n > 0)) return null;
  const exemption = Number(t.CountyExemptionValue) || 0;
  const increase = Math.max(0, Math.round(market - currentTaxable));
  return {
    year: Number(a.Year) || new Date().getFullYear(),
    marketValue: Math.round(market),
    assessedValue: Math.round(assessed),
    currentTaxable: Math.round(currentTaxable),
    afterSaleTaxable: Math.round(market),
    increase,
    estAnnualIncrease: Math.round((increase * TYPICAL_RATE) / 10) * 10,
    rateAssumed: TYPICAL_RATE,
    hasHomestead: exemption >= 25000,
  };
}

function bucketOf(status: string | null): 'closedOut' | 'inspected' | 'noInspection' | 'expired' {
  const s = (status ?? '').toLowerCase();
  if (s.startsWith('closed out')) return 'closedOut';
  if (s.startsWith('expired')) return 'expired';
  if (s.startsWith('inspected') || s.startsWith('open, last inspection')) return 'inspected';
  return 'noInspection';
}

const BUCKET_ORDER = ['expired', 'noInspection', 'inspected', 'closedOut'];

function permitHealthFrom(permits: Permit[]): PermitHealth | null {
  if (!permits.length) return null;
  const now = Date.now();
  const items = permits.map((p) => {
    const t = p.issueDate ? Date.parse(p.issueDate) : NaN;
    return {
      permitNumber: p.permitNumber,
      appType: p.appType,
      issueDate: p.issueDate,
      status: p.status,
      bucket: bucketOf(p.status),
      ageYears: Number.isFinite(t) ? Math.round(((now - t) / (365.25 * 86400000)) * 10) / 10 : null,
    };
  });
  const count = (b: string) => items.filter((i) => i.bucket === b).length;
  return {
    closedOut: count('closedOut'),
    inspectedNoCloseout: count('inspected'),
    noInspection: count('noInspection'),
    expired: count('expired'),
    // Problems first, so the short list on the card shows what needs action.
    items: [...items].sort((a, b) => BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket)).slice(0, 8),
  };
}

export async function fetchMiamiDadeExtras(opts: {
  folio: string;
  lat: number;
  lng: number;
  permits: Permit[];
}): Promise<CountyExtras> {
  const folio = compactFolio(opts.folio);
  const [pa, evac, sewerArea, septic] = await Promise.all([
    paByFolio(folio).catch(() => null),
    arcgisPoint('HurricaneEvacZone_gdb', opts.lat, opts.lng).catch(() => UNAVAILABLE),
    arcgisPoint('SewerServiceArea_gdb', opts.lat, opts.lng).catch(() => UNAVAILABLE),
    arcgisWhere('PossiblePropertiesServedBySepticOrWell', `FOLIO='${folio}'`).catch(() => UNAVAILABLE),
  ]);

  const sources: string[] = [];
  const tax = pa ? taxFrom(pa) : null;
  if (tax) sources.push('Miami-Dade Property Appraiser (values, cap, exemptions)');

  // The `|| pa` is gone on purpose: a successful property-appraiser lookup was
  // standing in for an evacuation answer, so a malformed evacuation response
  // still produced the "outside the county evacuation zones" sentence. The card
  // now appears exactly when the evacuation layer itself answered, which still
  // covers the genuine no-zone case.
  let evacuation: EvacuationInfo | null = null;
  if (evac.answered) {
    const a = evac.attrs;
    evacuation = {
      zone: a?.ZONEID ? String(a.ZONEID) : null,
      category: Number.isFinite(Number(a?.CATEGORY)) ? Number(a.CATEGORY) : null,
      hvhz: true,
    };
    sources.push('Miami-Dade Emergency Management hurricane evacuation zones');
  }

  // Two separate facts from two separate layers, so BOTH must have answered
  // before either negative is published. Previously a malformed septic answer
  // still produced "not flagged as septic or well", and the `else if (evac ||
  // pa)` branch below it manufactured the whole "Outside the county sewer
  // service areas" card off nothing but a successful appraiser lookup. That one
  // object drives three claims: the report card, the PDF's "Outside county
  // sewer", and a 2-point readiness penalty.
  //
  // Requiring both is deliberately conservative: when only one layer answers we
  // publish nothing rather than a half-known fact. That loses a true utility
  // name in the rare partial case, which is the right trade when the
  // alternative is a confident wrong negative. Septic SEMANTICS are untouched
  // here; only the unknown-versus-empty distinction changed.
  let sewer: SewerInfo | null = null;
  if (sewerArea.answered && septic.answered) {
    const flagged = !!septic.attrs;
    const inServiceArea = !!sewerArea.attrs;
    const utility = sewerArea.attrs?.UTILITYNAME ? String(sewerArea.attrs.UTILITYNAME) : null;
    sewer = {
      utility,
      inServiceArea,
      septicOrWellFlag: flagged,
      summary: flagged
        ? 'The county lists this parcel as possibly on septic or a well. Ask for the septic permit and last inspection.'
        : inServiceArea
        ? 'Inside a county sewer service area and not flagged as septic or well.'
        : 'Outside the county sewer service areas. A city utility or a septic system is possible. Verify before you buy.',
    };
    sources.push('Miami-Dade sewer service areas and septic/well parcel list');
  }

  const rcn = Number(
    (pa?.Building?.BuildingInfos ?? []).sort((a: any, b: any) => (b.RollYear ?? 0) - (a.RollYear ?? 0))[0]?.ReplacementCostNew,
  );

  return {
    tax,
    evacuation,
    sewer,
    permitHealth: permitHealthFrom(opts.permits),
    replacementCostNew: Number.isFinite(rcn) && rcn > 0 ? Math.round(rcn) : null,
    sources,
  };
}
