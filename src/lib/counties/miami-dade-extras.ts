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
  open: number;
  expired: number;
  finaled: number;
  other: number;
  items: Array<{
    permitNumber: string | null;
    appType: string | null;
    issueDate: string | null;
    status: string | null;
    bucket: 'open' | 'expired' | 'finaled' | 'other';
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

async function arcgisPoint(service: string, lat: number, lng: number): Promise<any | null> {
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
  if (!res.ok) return null;
  const j: any = await res.json();
  return Array.isArray(j?.features) ? j.features[0]?.attributes ?? null : null;
}

async function arcgisWhere(service: string, where: string): Promise<any | null> {
  const qs = new URLSearchParams({ where, outFields: '*', returnGeometry: 'false', f: 'json' });
  const res = await fetchWithTimeout(`${OPEN_DATA}/${service}/FeatureServer/0/query?${qs}`, {
    cache: 'no-store',
    timeoutMs: 9000,
    retries: 1,
    label: 'md-extras',
  });
  if (!res.ok) return null;
  const j: any = await res.json();
  return Array.isArray(j?.features) ? j.features[0]?.attributes ?? null : null;
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

function bucketOf(status: string | null): 'open' | 'expired' | 'finaled' | 'other' {
  const s = (status ?? '').toLowerCase();
  if (!s) return 'other';
  if (/expire|void|cancel|withdraw|revok|denied/.test(s)) return 'expired';
  if (/final|closed|complete|c\.?o\.?\b|certificate of (occupancy|completion)|approved/.test(s)) return 'finaled';
  if (/open|active|issued|pending|in progress|review|inspection|ready/.test(s)) return 'open';
  return 'other';
}

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
    open: count('open'),
    expired: count('expired'),
    finaled: count('finaled'),
    other: count('other'),
    items: items.slice(0, 8),
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
    arcgisPoint('HurricaneEvacZone_gdb', opts.lat, opts.lng).catch(() => null),
    arcgisPoint('SewerServiceArea_gdb', opts.lat, opts.lng).catch(() => null),
    arcgisWhere('PossiblePropertiesServedBySepticOrWell', `FOLIO='${folio}'`).catch(() => null),
  ]);

  const sources: string[] = [];
  const tax = pa ? taxFrom(pa) : null;
  if (tax) sources.push('Miami-Dade Property Appraiser (values, cap, exemptions)');

  let evacuation: EvacuationInfo | null = null;
  if (evac || pa) {
    evacuation = {
      zone: evac?.ZONEID ? String(evac.ZONEID) : null,
      category: Number.isFinite(Number(evac?.CATEGORY)) ? Number(evac.CATEGORY) : null,
      hvhz: true,
    };
    sources.push('Miami-Dade Emergency Management hurricane evacuation zones');
  }

  let sewer: SewerInfo | null = null;
  if (sewerArea || septic) {
    const flagged = !!septic;
    const utility = sewerArea?.UTILITYNAME ? String(sewerArea.UTILITYNAME) : null;
    sewer = {
      utility,
      inServiceArea: !!sewerArea,
      septicOrWellFlag: flagged,
      summary: flagged
        ? 'The county lists this parcel as possibly on septic or a well. Ask for the septic permit and last inspection.'
        : sewerArea
        ? 'Inside a county sewer service area and not flagged as septic or well.'
        : 'Not flagged as septic or well.',
    };
    sources.push('Miami-Dade sewer service areas and septic/well parcel list');
  } else if (evac || pa) {
    sewer = {
      utility: null,
      inServiceArea: false,
      septicOrWellFlag: false,
      summary: 'Outside the county sewer service areas. A city utility or a septic system is possible. Verify before you buy.',
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
