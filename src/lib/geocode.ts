// Address → lat/lng + county resolution.
//
// Primary: Google Geocoding API. Returns structured address components that
// include administrative_area_level_2 (the county), which we map to a key in
// FL_COUNTY_DIRECTORY.
//
// Fallback: US Census geocoder (no key). No county in the onelineaddress
// response, so we only use this if Google isn't configured / fails.

import { normalizeCountyKey } from './counties/portals';

export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
  county: string | null;        // normalized directory key, e.g. "miami-dade"
  countyDisplay: string | null; // what the geocoder returned, e.g. "Miami-Dade County"
  source: 'google' | 'census';
}

export async function geocode(address: string): Promise<GeocodeResult | null> {
  const cleaned = address.trim();
  if (!cleaned) return null;

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (key) {
    const g = await geocodeGoogle(cleaned, key);
    if (g) return g;
  }

  // Fallback: Census (no county info in this endpoint).
  return geocodeCensus(cleaned);
}

async function geocodeGoogle(address: string, key: string): Promise<GeocodeResult | null> {
  const url =
    'https://maps.googleapis.com/maps/api/geocode/json' +
    `?address=${encodeURIComponent(address)}` +
    '&region=us&components=country:US|administrative_area:FL' +
    `&key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const data: any = await res.json();
    if (data.status !== 'OK' || !Array.isArray(data.results) || data.results.length === 0) {
      return null;
    }
    const r = data.results[0];
    const lat = Number(r?.geometry?.location?.lat);
    const lng = Number(r?.geometry?.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const countyDisplay = extractCounty(r?.address_components ?? []);
    const normalized = countyDisplay ? normalizeCountyKey(countyDisplay) : null;
    return {
      lat,
      lng,
      formattedAddress: String(r?.formatted_address ?? address),
      county: normalized,
      countyDisplay,
      source: 'google',
    };
  } catch {
    return null;
  }
}

function extractCounty(components: any[]): string | null {
  for (const c of components) {
    const types: string[] = Array.isArray(c?.types) ? c.types : [];
    if (types.includes('administrative_area_level_2')) {
      return String(c?.long_name ?? '').trim() || null;
    }
  }
  return null;
}

async function geocodeCensus(address: string): Promise<GeocodeResult | null> {
  const url =
    'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress' +
    `?address=${encodeURIComponent(address)}` +
    '&benchmark=Public_AR_Current&format=json';
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const data: any = await res.json();
    const match = data?.result?.addressMatches?.[0];
    const coords = match?.coordinates;
    if (!coords) return null;
    const lat = Number(coords.y);
    const lng = Number(coords.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      lat,
      lng,
      formattedAddress: String(match?.matchedAddress ?? address),
      county: null,        // census locations endpoint doesn't return county reliably
      countyDisplay: null,
      source: 'census',
    };
  } catch {
    return null;
  }
}

// When Census is the only geocoder available we still need a county. Call the
// FCC Area API with lat/lng to get the county name. Cheap, no auth.
export async function reverseCounty(lat: number, lng: number): Promise<string | null> {
  const url = `https://geo.fcc.gov/api/census/area?lat=${lat}&lon=${lng}&format=json`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const data: any = await res.json();
    const row = Array.isArray(data?.results) ? data.results[0] : null;
    const name: string | undefined = row?.county_name;
    if (!name) return null;
    return normalizeCountyKey(name);
  } catch {
    return null;
  }
}
