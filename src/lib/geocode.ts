// Address → lat/lng + county resolution.
//
// Primary: Google Geocoding API. Returns structured address components that
// include administrative_area_level_2 (the county), which we map to a key in
// FL_COUNTY_DIRECTORY.
//
// Fallback: US Census geocoder (no key). No county in the onelineaddress
// response, so we only use this if Google isn't configured / fails.
//
// CONFIDENCE: a bare street search ("1000 5th St") can silently resolve to the
// same street number in the WRONG city — e.g. "1000 5th St, Miami Beach 33139"
// matching "1000 NW 5 St, Miami 33128". Because every downstream step (folio,
// permits, imagery) keys off this single result, an unvalidated match produces
// a confident report on the wrong property. So we (a) constrain Google by the
// user's ZIP when present, and (b) validate the matched city/ZIP against what
// the user typed and flag the result low-confidence when they disagree.

import { normalizeCountyKey } from './counties/portals';
import { fetchWithTimeout } from './net';

export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
  county: string | null;        // normalized directory key, e.g. "miami-dade"
  countyDisplay: string | null; // what the geocoder returned, e.g. "Miami-Dade County"
  source: 'google' | 'census';

  // Match-quality signals (used to warn on wrong-property matches).
  partialMatch: boolean;              // Google flagged the match as approximate
  locationType: string | null;       // ROOFTOP | RANGE_INTERPOLATED | GEOMETRIC_CENTER | APPROXIMATE
  inputZip: string | null;           // ZIP parsed from the user's input
  inputCity: string | null;          // city parsed from the user's input
  matchedZip: string | null;         // ZIP on the geocoded result
  matchedCity: string | null;        // locality on the geocoded result
  confidence: 'high' | 'low';
  confidenceReason: string | null;   // human-readable reason when confidence is low
}

/** Pull a 5-digit ZIP out of a free-form string. */
function parseZip(s: string): string | null {
  const m = s.match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : null;
}

/**
 * Best-effort city extraction from a typed address.
 * Handles "street, city, FL 33139", "street, city FL 33139", "street, city".
 */
function parseCity(s: string): string | null {
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    // "<street>, <city>, <state zip>"
    return cleanCity(parts[1]);
  }
  if (parts.length === 2) {
    // "<street>, <city [state] [zip]>"
    return cleanCity(parts[1]);
  }
  return null;
}

function cleanCity(seg: string): string | null {
  const c = seg
    .replace(/\b(FL|florida)\b/i, ' ')
    .replace(/\b\d{5}(?:-\d{4})?\b/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return c || null;
}

function normCity(s: string | null): string {
  return (s ?? '').toLowerCase().replace(/[^a-z]+/g, '');
}

export async function geocode(address: string): Promise<GeocodeResult | null> {
  const cleaned = address.trim();
  if (!cleaned) return null;

  const inputZip = parseZip(cleaned);
  const inputCity = parseCity(cleaned);

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (key) {
    const g = await geocodeGoogle(cleaned, key, inputZip, inputCity);
    if (g) return g;
  }

  // Fallback: Census (no county info in this endpoint).
  return geocodeCensus(cleaned, inputZip, inputCity);
}

async function geocodeGoogle(
  address: string,
  key: string,
  inputZip: string | null,
  inputCity: string | null,
): Promise<GeocodeResult | null> {
  // Try a ZIP-constrained query first (strongest unambiguous signal), then
  // fall back to a FL-only query so a wrong/typo ZIP can't blank the result.
  const build = (constrainZip: boolean) => {
    let components = 'country:US|administrative_area:FL';
    if (constrainZip && inputZip) components += `|postal_code:${inputZip}`;
    return (
      'https://maps.googleapis.com/maps/api/geocode/json' +
      `?address=${encodeURIComponent(address)}` +
      `&region=us&components=${encodeURIComponent(components)}` +
      `&key=${encodeURIComponent(key)}`
    );
  };

  const tries: string[] = [];
  if (inputZip) tries.push(build(true));
  tries.push(build(false));

  for (const url of tries) {
    try {
      const res = await fetchWithTimeout(url, { cache: 'no-store', timeoutMs: 10000, retries: 1, label: 'geocode-google' });
      if (!res.ok) continue;
      const data: any = await res.json();
      if (data.status !== 'OK' || !Array.isArray(data.results) || data.results.length === 0) {
        continue; // ZERO_RESULTS on a constrained pass → try the next (looser) pass
      }

      // Prefer a result whose ZIP matches what the user typed; else first result.
      const results: any[] = data.results;
      let r =
        (inputZip && results.find((x) => zipOf(x) === inputZip)) || results[0];

      const lat = Number(r?.geometry?.location?.lat);
      const lng = Number(r?.geometry?.location?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const countyDisplay = extractComponent(r, 'administrative_area_level_2');
      const matchedCity =
        extractComponent(r, 'locality') ||
        extractComponent(r, 'sublocality') ||
        extractComponent(r, 'postal_town');
      const matchedZip = zipOf(r);
      const partialMatch = r?.partial_match === true;
      const locationType: string | null = r?.geometry?.location_type ?? null;

      const { confidence, confidenceReason } = assessConfidence({
        partialMatch,
        locationType,
        inputZip,
        inputCity,
        matchedZip,
        matchedCity,
      });

      return {
        lat,
        lng,
        formattedAddress: String(r?.formatted_address ?? address),
        county: countyDisplay ? normalizeCountyKey(countyDisplay) : null,
        countyDisplay,
        source: 'google',
        partialMatch,
        locationType,
        inputZip,
        inputCity,
        matchedZip,
        matchedCity,
        confidence,
        confidenceReason,
      };
    } catch {
      // try next pass
    }
  }
  return null;
}

function zipOf(result: any): string | null {
  return extractComponent(result, 'postal_code');
}

function extractComponent(result: any, type: string): string | null {
  const components: any[] = Array.isArray(result?.address_components)
    ? result.address_components
    : [];
  for (const c of components) {
    const types: string[] = Array.isArray(c?.types) ? c.types : [];
    if (types.includes(type)) {
      return String(c?.long_name ?? '').trim() || null;
    }
  }
  return null;
}

function assessConfidence(args: {
  partialMatch: boolean;
  locationType: string | null;
  inputZip: string | null;
  inputCity: string | null;
  matchedZip: string | null;
  matchedCity: string | null;
}): { confidence: 'high' | 'low'; confidenceReason: string | null } {
  const { partialMatch, locationType, inputZip, inputCity, matchedZip, matchedCity } = args;

  if (inputZip && matchedZip && inputZip !== matchedZip) {
    return {
      confidence: 'low',
      confidenceReason: `You entered ZIP ${inputZip}, but the closest record found is in ${matchedZip}${matchedCity ? ` (${matchedCity})` : ''}.`,
    };
  }
  if (inputCity && matchedCity && normCity(inputCity) !== normCity(matchedCity)) {
    return {
      confidence: 'low',
      confidenceReason: `You entered "${inputCity}", but the closest record found is in "${matchedCity}".`,
    };
  }
  if (partialMatch) {
    return {
      confidence: 'low',
      confidenceReason: 'The address could not be matched exactly — this is the geocoder’s best approximation.',
    };
  }
  if (locationType === 'APPROXIMATE') {
    return {
      confidence: 'low',
      confidenceReason: 'Only an approximate (non-rooftop) location was found for this address.',
    };
  }
  return { confidence: 'high', confidenceReason: null };
}

async function geocodeCensus(
  address: string,
  inputZip: string | null,
  inputCity: string | null,
): Promise<GeocodeResult | null> {
  const url =
    'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress' +
    `?address=${encodeURIComponent(address)}` +
    '&benchmark=Public_AR_Current&format=json';
  try {
    const res = await fetchWithTimeout(url, { cache: 'no-store', timeoutMs: 10000, retries: 1, label: 'geocode-census' });
    if (!res.ok) return null;
    const data: any = await res.json();
    const match = data?.result?.addressMatches?.[0];
    const coords = match?.coordinates;
    if (!coords) return null;
    const lat = Number(coords.y);
    const lng = Number(coords.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const matchedAddress = String(match?.matchedAddress ?? address);
    const matchedZip = parseZip(matchedAddress);
    const { confidence, confidenceReason } = assessConfidence({
      partialMatch: false,
      locationType: null,
      inputZip,
      inputCity,
      matchedZip,
      matchedCity: null, // census oneline doesn't give a clean locality field
    });

    return {
      lat,
      lng,
      formattedAddress: matchedAddress,
      county: null,        // census locations endpoint doesn't return county reliably
      countyDisplay: null,
      source: 'census',
      partialMatch: false,
      locationType: null,
      inputZip,
      inputCity,
      matchedZip,
      matchedCity: null,
      confidence,
      confidenceReason,
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
    const res = await fetchWithTimeout(url, { cache: 'no-store', timeoutMs: 8000, retries: 1, label: 'reverse-county' });
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
