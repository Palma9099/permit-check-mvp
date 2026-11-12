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
  // No Florida place contains the point. The query completed, so this is a
  // positive finding: the parcel is in no incorporated place.
  if (!r) return null;
  const name = str(r.BASENAME) || str(r.NAME).replace(/\s+(city|town|village)$/i, '');
  // Codex R2-01: a matched Florida feature carrying neither BASENAME nor NAME
  // used to return null here, which a caller reads as "inside no incorporated
  // place". It is the opposite: the layer says the point IS inside a place and
  // will not tell us which. Returning null made a municipal parcel look
  // unincorporated and could send its owner to the county office. Throwing is
  // the documented contract of this function - a caller must never read a
  // failed lookup as unincorporated - and it is what the three callers already
  // handle correctly.
  if (!name) {
    throw new Error('census-places matched a Florida place with no name; jurisdiction not established');
  }
  return name;
}

/**
 * What the boundary source actually established about this parcel.
 *
 * Codex rejected the first version of the Broward office work for exactly the
 * gap this type closes. `governingMunicipality` returns `string | null`, and
 * null carried two different meanings that a reader cannot be told apart:
 *
 *   - the source answered, and the point is inside NO incorporated place, so
 *     the parcel is positively unincorporated and its COUNTY governs
 *   - nobody answered, so no jurisdiction was established at all
 *
 * Collapsing them was safe for the verdict, which stays amber either way, but
 * it threw away a fact the report needs. An unincorporated Broward parcel was
 * told "we could not establish which authority enforces code at this address"
 * when the boundary source had in fact established it.
 *
 * Making the two explicit is strictly stronger than the old rule, not weaker:
 * a failure can no longer reach a caller wearing the same shape as a positive
 * finding of unincorporated land.
 */
export type MunicipalityFinding =
  /** The boundary source named the incorporated place containing the point. */
  | { kind: 'named'; municipality: string }
  /** The source answered and the point is inside no incorporated place. */
  | { kind: 'unincorporated' }
  /** Nobody answered. NOT a finding of unincorporated land. */
  | { kind: 'unknown' };

/**
 * `governingMunicipality`'s three rules, with the two meanings of null kept apart.
 *
 * A county record naming its own municipality still wins, a blank is still
 * filled from the parcel point and never from the postal city, and a failure
 * still never reads as unincorporated - it now reports `unknown` instead of
 * sharing a return value with the positive case.
 */
export async function municipalityFinding(
  fromRecord: string | null | undefined,
  point: { lat: number; lng: number } | null,
  lookup: (lat: number, lng: number) => Promise<string | null> = municipalityAt,
): Promise<MunicipalityFinding> {
  const named = (fromRecord ?? '').trim();
  if (named) return { kind: 'named', municipality: named };
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return { kind: 'unknown' };
  }
  try {
    const hit = await lookup(point.lat, point.lng);
    // `municipalityAt` returns null ONLY when the query succeeded and matched
    // no Florida incorporated place. It throws when the source did not answer,
    // which is the branch below.
    return hit ? { kind: 'named', municipality: hit } : { kind: 'unincorporated' };
  } catch {
    return { kind: 'unknown' };
  }
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
  // Implemented on top of municipalityFinding so the two can never disagree
  // about precedence or about what a failure means.
  const f = await municipalityFinding(fromRecord, point, lookup);
  return f.kind === 'named' ? f.municipality : null;
}
