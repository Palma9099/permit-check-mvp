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
