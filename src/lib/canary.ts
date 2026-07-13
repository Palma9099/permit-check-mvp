// Upstream-schema canary.
//
// The tool's property data rests on ~40 third-party ArcGIS layers, each mapped
// field-by-field (e.g. Broward ACTUAL_YEAR_BUILT, Hillsborough ACT, HCPA DOR_C).
// If a county silently renames or drops a field, the mapper returns null and the
// report shows blanks - with no error and no signal. This canary runs the REAL
// code paths at known-good fixture inputs and asserts the fields the report
// depends on come back populated. A failure means an upstream layer drifted.
//
// Fixtures are built parcels verified to return year/area/folio at the time of
// writing; we assert non-null, not exact values, so normal reassessment doesn't
// trip it - only a structural (schema) change does.

import { fetchCountyProperty } from './counties/county-property';
import { parcelByFolio } from './counties/statewide-cadastral';
import { miamiDadeAdapter } from './counties/miami-dade-adapter';

export interface CanaryCheck {
  name: string;
  ok: boolean;
  detail: string;
}

// A hosted per-county parcel layer fixture: a coordinate known to sit on a
// fully-attributed built parcel.
interface CountyFixture {
  name: string;
  key: string; // bare county key used by fetchCountyProperty
  lat: number;
  lng: number;
}

const COUNTY_FIXTURES: CountyFixture[] = [
  { name: 'Broward (BCPA hosted layer)', key: 'broward', lat: 26.1436, lng: -80.136 },
  { name: 'Hillsborough (HCPA hosted layer)', key: 'hillsborough', lat: 28.02, lng: -82.46 },
  { name: 'Palm Beach (PBC hosted layer)', key: 'palm-beach', lat: 26.69, lng: -80.065 },
  { name: 'Lee (LeePA hosted layer)', key: 'lee', lat: 26.62, lng: -81.87 },
];

async function checkCounty(f: CountyFixture): Promise<CanaryCheck> {
  try {
    const p = await fetchCountyProperty(f.key, f.lat, f.lng);
    if (!p) return { name: f.name, ok: false, detail: 'no parcel resolved at the fixture point' };
    const missing: string[] = [];
    if (!p.parcelId) missing.push('parcelId');
    if (!p.yearBuilt && !p.livingArea) missing.push('yearBuilt & livingArea both null');
    if (!p.siteAddress) missing.push('siteAddress');
    if (missing.length) {
      return { name: f.name, ok: false, detail: `missing ${missing.join('; ')} (folio=${p.parcelId ?? 'null'})` };
    }
    return { name: f.name, ok: true, detail: `folio=${p.parcelId} yr=${p.yearBuilt ?? '-'} area=${p.livingArea ?? '-'}` };
  } catch (e: any) {
    return { name: f.name, ok: false, detail: 'threw: ' + String(e?.message ?? e).slice(0, 140) };
  }
}

// Miami-Dade has its own bespoke adapter (PA JSON + Open Data). Verify a known
// single-family folio still returns owner/year via the adapter's address path.
async function checkMiamiDade(): Promise<CanaryCheck> {
  const name = 'Miami-Dade (bespoke PA adapter)';
  try {
    const r = await miamiDadeAdapter.run({
      address: '6704 SW 134 PL',
      zip: '33183',
      lat: 25.702,
      lng: -80.406,
    });
    const pb = r.propertyBasics;
    if (!pb.folio) return { name, ok: false, detail: 'PA did not resolve the fixture address to a folio' };
    const missing: string[] = [];
    if (!pb.yearBuilt) missing.push('yearBuilt');
    if (!pb.owner) missing.push('owner');
    if (missing.length) return { name, ok: false, detail: `missing ${missing.join('; ')} (folio=${pb.folio})` };
    return { name, ok: true, detail: `folio=${pb.folio} yr=${pb.yearBuilt} owner=present` };
  } catch (e: any) {
    return { name, ok: false, detail: 'threw: ' + String(e?.message ?? e).slice(0, 140) };
  }
}

// FDOR statewide roll: the indexed folio path (fast/reliable) is what the
// folio-only lookup and every fallback county's data quality depend on. Assert a
// known Miami-Dade folio still resolves to a parcel with year built.
async function checkFdorFolio(): Promise<CanaryCheck> {
  const name = 'FDOR statewide roll (folio index)';
  try {
    const r = await parcelByFolio('30-4926-002-1120');
    if (!r || !r.parcel?.parcelId) return { name, ok: false, detail: 'known folio did not resolve' };
    const p = r.parcel;
    if (!p.yearBuilt && !p.livingArea) {
      return { name, ok: false, detail: `resolved ${p.parcelId} but yearBuilt & livingArea both null (schema drift?)` };
    }
    return { name, ok: true, detail: `folio=${p.parcelId} yr=${p.yearBuilt ?? '-'} area=${p.livingArea ?? '-'}` };
  } catch (e: any) {
    return { name, ok: false, detail: 'threw: ' + String(e?.message ?? e).slice(0, 140) };
  }
}

// Run every check in parallel. Never throws - individual failures are captured.
export async function runCanary(): Promise<CanaryCheck[]> {
  return Promise.all([
    ...COUNTY_FIXTURES.map(checkCounty),
    checkMiamiDade(),
    checkFdorFolio(),
  ]);
}
