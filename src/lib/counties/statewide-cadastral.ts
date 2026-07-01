// Statewide property/appraiser data via the Florida DOR certified tax roll.
//
// Source: the "Florida Statewide Cadastral" FeatureServer published by the
// Florida Geographic Information Office (FGIO). Layer 0 is the FDOR Cadastral
// (the NAL — Name/Address/Legal — file that EVERY county property appraiser
// submits to the state Department of Revenue each assessment year). Because
// it's a single statewide layer keyed on geometry, one point-in-polygon query
// returns real appraiser-grade data for ANY of Florida's 67 counties:
// owner, situs address, actual year built, heated/living area, land size,
// just/assessed/taxable values, homestead split, and the two most recent
// qualified sales.
//
// This is what lets the top-10 counties (+ Monroe) become Tier A for PROPERTY
// data without a bespoke scraper per county. It is an annual certified roll,
// not a live daily feed — we stamp the assessment year and say so. Permits and
// code-enforcement cases are NOT in this file; those remain county/city portal
// links (handled by the adapter) until a given county exposes a usable API.
//
// Endpoint validated live across Miami-Dade, Broward, Palm Beach, Hillsborough,
// Orange, Pinellas, Duval, Lee, Polk, Brevard, and Monroe.

import type { Sale } from '../types';
import { fetchWithTimeout } from '../net';

const CADASTRAL_LAYER =
  'https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query';

// FDOR county numbers (CO_NO) → our directory keys. These are the state's
// standard alphabetical county codes (11 Alachua … 77 Washington). Only the
// entries we actually route to Tier A need be correct, but the full map keeps
// the reverse lookup honest for any county.
export const FDOR_CO_NO_TO_KEY: Record<number, string> = {
  11: 'alachua', 12: 'baker', 13: 'bay', 14: 'bradford', 15: 'brevard',
  16: 'broward', 17: 'calhoun', 18: 'charlotte', 19: 'citrus', 20: 'clay',
  21: 'collier', 22: 'columbia', 23: 'miami-dade', 24: 'desoto', 25: 'dixie',
  26: 'duval', 27: 'escambia', 28: 'flagler', 29: 'franklin', 30: 'gadsden',
  31: 'gilchrist', 32: 'glades', 33: 'gulf', 34: 'hamilton', 35: 'hardee',
  36: 'hendry', 37: 'hernando', 38: 'highlands', 39: 'hillsborough', 40: 'holmes',
  41: 'indian-river', 42: 'jackson', 43: 'jefferson', 44: 'lafayette', 45: 'lake',
  46: 'lee', 47: 'leon', 48: 'levy', 49: 'liberty', 50: 'madison',
  51: 'manatee', 52: 'marion', 53: 'martin', 54: 'monroe', 55: 'nassau',
  56: 'okaloosa', 57: 'okeechobee', 58: 'orange', 59: 'osceola', 60: 'palm-beach',
  61: 'pasco', 62: 'pinellas', 63: 'polk', 64: 'putnam', 65: 'st-johns',
  66: 'st-lucie', 67: 'santa-rosa', 68: 'sarasota', 69: 'seminole', 70: 'sumter',
  71: 'suwannee', 72: 'taylor', 73: 'union', 74: 'volusia', 75: 'wakulla',
  76: 'walton', 77: 'washington',
};

// FL DOR land-use codes (DOR_UC). We map the residential codes precisely and
// fall back to a category label for the broader ranges. The raw value in the
// data is a zero-padded string like "001", "026", "080".
const DOR_USE_EXACT: Record<number, string> = {
  0: 'Vacant residential',
  1: 'Single-family residence',
  2: 'Mobile home',
  3: 'Multi-family (10+ units)',
  4: 'Condominium',
  5: 'Cooperative',
  6: 'Retirement home',
  7: 'Miscellaneous residential',
  8: 'Multi-family (fewer than 10 units)',
  9: 'Residential common element',
};

function dorUseDescription(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(/\D+/g, ''));
  if (!Number.isFinite(n)) return null;
  if (n in DOR_USE_EXACT) return DOR_USE_EXACT[n];
  if (n >= 10 && n <= 39) return `Commercial (DOR use ${pad3(n)})`;
  if (n >= 40 && n <= 49) return `Industrial (DOR use ${pad3(n)})`;
  if (n >= 50 && n <= 69) return `Agricultural (DOR use ${pad3(n)})`;
  if (n >= 70 && n <= 79) return `Institutional (DOR use ${pad3(n)})`;
  if (n >= 80 && n <= 89) return `Governmental (DOR use ${pad3(n)})`;
  if (n >= 90 && n <= 99) return `Miscellaneous (DOR use ${pad3(n)})`;
  return `DOR use ${pad3(n)}`;
}

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

function s(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const c = v.replace(/[, $]+/g, '').trim();
    if (!c) return null;
    const n = Number(c);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// A positive number that is meaningfully non-zero (the roll uses 0 as "null").
function posNum(v: unknown): number | null {
  const n = num(v);
  return n && n > 0 ? n : null;
}

function titleCaseAddress(a: string): string {
  // The roll stores situs in UPPER CASE for most counties. Light title-casing
  // makes the report read like a professional document without mangling
  // directionals/unit tokens.
  return a
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(N|S|E|W|NE|NW|SE|SW|Ne|Nw|Se|Sw)\b/g, (m) => m.toUpperCase());
}

export interface StatewideParcel {
  coNo: number | null;
  countyKey: string | null;
  parcelId: string | null;
  owner: string | null;
  siteAddress: string | null;
  mailingAddress: string | null;
  mailingMatchesSite: boolean | null;
  yearBuilt: number | null;
  effectiveYearBuilt: number | null;
  livingArea: number | null;
  landSqft: number | null;
  dorUseDescription: string | null;
  legal: string | null;
  justValue: number | null;
  assessedValue: number | null;
  taxableValue: number | null;
  homesteadStatusText: string;
  sales: Sale[];
  assessmentYear: number | null;
}

const OUT_FIELDS = [
  'CO_NO', 'PARCEL_ID', 'OWN_NAME', 'OWN_ADDR1', 'OWN_CITY', 'OWN_STATE', 'OWN_ZIPCD',
  'PHY_ADDR1', 'PHY_CITY', 'PHY_ZIPCD', 'S_LEGAL', 'DOR_UC',
  'ACT_YR_BLT', 'EFF_YR_BLT', 'TOT_LVG_AR', 'LND_SQFOOT',
  'JV', 'AV_SD', 'TV_SD', 'AV_HMSTD', 'JV_HMSTD', 'ASMNT_YR',
  'SALE_PRC1', 'SALE_YR1', 'SALE_MO1', 'QUAL_CD1',
  'SALE_PRC2', 'SALE_YR2', 'SALE_MO2', 'QUAL_CD2',
].join(',');

async function queryFeatures(geometry: string, geometryType: string): Promise<any[]> {
  const params = new URLSearchParams({
    geometry,
    geometryType,
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: OUT_FIELDS,
    returnGeometry: 'false',
    resultRecordCount: '8',
    f: 'json',
  });
  const url = `${CADASTRAL_LAYER}?${params.toString()}`;
  const res = await fetchWithTimeout(url, {
    cache: 'no-store',
    timeoutMs: 12000,
    retries: 1,
    label: 'fdor-cadastral',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: any = await res.json();
  if (data?.error) throw new Error(`arcgis: ${data.error?.message ?? 'error'}`);
  return Array.isArray(data?.features) ? data.features : [];
}

// A feature is "real" (not a right-of-way / water sliver) when it has a county
// number and a non-blank parcel id.
function isRealParcel(attrs: any): boolean {
  return Number.isFinite(attrs?.CO_NO) && attrs?.CO_NO > 0 && !!s(attrs?.PARCEL_ID);
}

function mapAttrs(a: any): StatewideParcel {
  const coNo = Number.isFinite(a?.CO_NO) && a.CO_NO > 0 ? Number(a.CO_NO) : null;
  const site = s(a?.PHY_ADDR1);
  const cityZip = [s(a?.PHY_CITY), posNum(a?.PHY_ZIPCD)].filter(Boolean).join(' ');
  const siteFull = site ? titleCaseAddress([site, cityZip].filter(Boolean).join(', ')) : null;

  const mailStreet = s(a?.OWN_ADDR1);
  const mailCityZip = [s(a?.OWN_CITY), s(a?.OWN_STATE), posNum(a?.OWN_ZIPCD)].filter(Boolean).join(' ');
  const mailFull = mailStreet ? titleCaseAddress([mailStreet, mailCityZip].filter(Boolean).join(', ')) : null;

  const mailMatch: boolean | null =
    site && mailStreet ? site.toUpperCase() === mailStreet.toUpperCase() : null;

  const avHmstd = posNum(a?.AV_HMSTD);
  const jvHmstd = posNum(a?.JV_HMSTD);
  const homesteadStatusText = (avHmstd || jvHmstd)
    ? 'Homestead exemption reflected on the certified tax roll.'
    : 'No homestead exemption on the certified tax roll.';

  const sales: Sale[] = [];
  const mkSale = (prc: unknown, yr: unknown, mo: unknown, q: unknown): Sale | null => {
    const price = posNum(prc);
    const year = posNum(yr);
    if (!price && !year) return null;
    const month = posNum(mo);
    const date = year ? `${year}${month ? '-' + String(month).padStart(2, '0') : ''}` : null;
    return {
      date,
      price: price ?? null,
      qualificationDescription: s(q) ? `Qualification code ${s(q)}` : null,
    };
  };
  const s1 = mkSale(a?.SALE_PRC1, a?.SALE_YR1, a?.SALE_MO1, a?.QUAL_CD1);
  const s2 = mkSale(a?.SALE_PRC2, a?.SALE_YR2, a?.SALE_MO2, a?.QUAL_CD2);
  if (s1) sales.push(s1);
  if (s2) sales.push(s2);

  return {
    coNo,
    countyKey: coNo ? FDOR_CO_NO_TO_KEY[coNo] ?? null : null,
    parcelId: s(a?.PARCEL_ID) || null,
    owner: s(a?.OWN_NAME) || null,
    siteAddress: siteFull,
    mailingAddress: mailFull,
    mailingMatchesSite: mailMatch,
    yearBuilt: posNum(a?.ACT_YR_BLT),
    effectiveYearBuilt: posNum(a?.EFF_YR_BLT),
    livingArea: posNum(a?.TOT_LVG_AR),
    landSqft: posNum(a?.LND_SQFOOT),
    dorUseDescription: dorUseDescription(a?.DOR_UC),
    legal: s(a?.S_LEGAL) || null,
    justValue: posNum(a?.JV),
    assessedValue: posNum(a?.AV_SD),
    taxableValue: posNum(a?.TV_SD),
    homesteadStatusText,
    sales,
    assessmentYear: posNum(a?.ASMNT_YR),
  };
}

/**
 * Resolve the parcel that contains (or is nearest to) a lat/lng from the FL DOR
 * statewide cadastral. Tries a point-in-polygon hit first; if that lands on a
 * road/water sliver (blank parcel) it retries with a small envelope and picks
 * the first real parcel. Returns null on total miss or network failure — the
 * adapter turns that into a graceful "not found", never an exception.
 */
export async function parcelByPoint(lat: number, lng: number): Promise<StatewideParcel | null> {
  try {
    // 1) exact point
    const point = JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } });
    let feats = await queryFeatures(point, 'esriGeometryPoint');
    let real = feats.map((f) => f.attributes).find(isRealParcel);

    // 2) envelope fallback (~7m) when the point missed a parcel polygon
    if (!real) {
      const d = 0.00007;
      const env = JSON.stringify({
        xmin: lng - d, ymin: lat - d, xmax: lng + d, ymax: lat + d,
        spatialReference: { wkid: 4326 },
      });
      feats = await queryFeatures(env, 'esriGeometryEnvelope');
      real = feats.map((f) => f.attributes).find(isRealParcel);
    }

    if (!real) return null;
    return mapAttrs(real);
  } catch (err: any) {
    console.error('[statewide-cadastral] parcelByPoint failed:', String(err?.message ?? err).slice(0, 160));
    return null;
  }
}
