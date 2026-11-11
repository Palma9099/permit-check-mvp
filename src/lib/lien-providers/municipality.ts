// Which municipality a parcel sits in, from the Census Bureau's incorporated
// place boundaries (TIGERweb). Statewide, public, and keyed on the parcel
// point, which is the only honest way to answer it: a postal city is not a
// jurisdiction, and a mailing address in "Miami, FL" is usually not in the
// City of Miami.
//
// Limitation worth knowing: Census place boundaries are republished annually,
// so a very recent annexation can lag. The staff step that uses this answer
// says to confirm with the city, and the city letter is requested by hand
// either way.

import { queryLayer, str } from '../arcgis';

const PLACES =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4';

const FLORIDA = '12';

/**
 * The incorporated place containing this point, or null for an unincorporated
 * parcel. Throws when the source does not answer, so a caller never reads a
 * failed lookup as "unincorporated".
 */
export async function municipalityAt(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const rows = await queryLayer(PLACES, {
    point: { lat, lng },
    outFields: 'BASENAME,NAME,STATE',
    resultRecordCount: 4,
    label: 'census-places',
  });
  const inFlorida = rows.filter((r) => str(r.STATE) === FLORIDA);
  const r = inFlorida[0];
  if (!r) return null;
  return str(r.BASENAME) || str(r.NAME).replace(/\s+(city|town|village)$/i, '') || null;
}

/**
 * Which municipality governs this parcel, given whatever the county record said.
 *
 * Three rules, in order:
 *
 * 1. **A county record that names its own municipality wins.** It is the
 *    primary source for its own parcels, so an inference never overwrites it.
 *    Only Miami-Dade's Property Appraiser carries the field; the statewide
 *    cadastral roll has no municipality at all, which is why the other
 *    adapters return null and why this function exists.
 * 2. **A blank is filled from the parcel point**, never from the postal city in
 *    the typed address.
 * 3. **A failure stays null.** `municipalityAt` throws when the boundary source
 *    does not answer and returns null for a parcel outside every city, so null
 *    out of here still cannot be read as a finding of "unincorporated" - it
 *    means no name was established, which is what `municipalityKnown` tests.
 *
 * `lookup` is injectable so the rules above can be tested without the network.
 */
export async function governingMunicipality(
  fromRecord: string | null | undefined,
  point: { lat: number; lng: number } | null,
  lookup: (lat: number, lng: number) => Promise<string | null> = municipalityAt,
): Promise<string | null> {
  const named = (fromRecord ?? '').trim();
  if (named) return named;
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  try {
    return await lookup(point.lat, point.lng);
  } catch {
    return null;
  }
}
