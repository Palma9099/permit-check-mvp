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

import { queryFeaturesValidated, str } from '../arcgis';

const PLACES =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4';

const FLORIDA = '12';

/**
 * What the Census place layer established about this point.
 *
 * `unincorporated` is a VALUE CONSTRUCTED HERE, inside the function that did
 * the validating. That is the whole point of the redesign: for three review
 * rounds this fact was instead INFERRED by a caller noticing that a list was
 * empty, and an empty list has two causes - the source had nothing, or the
 * source said something we could not read. Every guard I added closed one
 * shape of the second cause and left the next one, because no amount of
 * guarding fixes an inference drawn from a count.
 *
 * Now the only way to obtain `unincorporated` is for this function to return
 * it, and it does that only after every returned record has been proved
 * readable. Unreadable answers throw. A caller cannot manufacture the positive
 * finding, however it counts things.
 */
export type PlaceFinding =
  /** A Florida incorporated place contains the point. */
  | { kind: 'named'; municipality: string }
  /** The layer answered completely and NO place contains the point. */
  | { kind: 'unincorporated' };

/**
 * The incorporated place containing this point.
 *
 * Throws when the source did not answer, when any returned record is
 * unreadable, or when the answer is self-contradictory for a Florida parcel.
 * A caller must never read a failed lookup as "unincorporated".
 */
export async function placeAt(lat: number, lng: number): Promise<PlaceFinding> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('census-places needs a finite point');
  }
  // STATE is required on every feature, checked BEFORE the Florida filter, so
  // a record whose state cannot be read can no longer vanish into it.
  const rows = await queryFeaturesValidated(
    PLACES,
    {
      point: { lat, lng },
      outFields: 'BASENAME,NAME,STATE',
      resultRecordCount: 4,
      label: 'census-places',
    },
    ['STATE'],
  );

  // A complete answer with no features at all: the point is inside no
  // incorporated place anywhere. This is the one path to the positive finding.
  if (rows.length === 0) return { kind: 'unincorporated' };

  const inFlorida = rows.filter((r) => str(r.STATE) === FLORIDA);
  if (inFlorida.length === 0) {
    // Every record was readable and none is in Florida, so the point IS inside
    // an incorporated place - just not a Florida one. For a Florida parcel
    // that is a contradiction, not a finding of unincorporated Florida land,
    // and the honest answer is that we do not know.
    throw new Error(
      `census-places matched only non-Florida places (${rows.map((r) => str(r.STATE)).join(',')}); jurisdiction not established`,
    );
  }

  const r = inFlorida[0];
  const name = str(r.BASENAME) || str(r.NAME).replace(/\s+(city|town|village)$/i, '');
  if (!name) {
    // The layer says the point IS inside a place and will not say which.
    throw new Error('census-places matched a Florida place with no name; jurisdiction not established');
  }
  return { kind: 'named', municipality: name };
}

/**
 * The place name, or null for a parcel the layer placed inside none.
 *
 * Kept for the two callers that read it this way (the deep-scan route column
 * and fl-records' city-letter decision). Both already treat a throw as
 * "unknown", which is why `placeAt` throwing is what makes them correct.
 */
export async function municipalityAt(lat: number, lng: number): Promise<string | null> {
  const f = await placeAt(lat, lng);
  return f.kind === 'named' ? f.municipality : null;
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
  lookup: (lat: number, lng: number) => Promise<PlaceFinding> = placeAt,
): Promise<MunicipalityFinding> {
  const named = (fromRecord ?? '').trim();
  if (named) return { kind: 'named', municipality: named };
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return { kind: 'unknown' };
  }
  try {
    // `lookup` returns the finding it built after validating; this function
    // never decides "unincorporated" for itself.
    return await lookup(point.lat, point.lng);
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
  lookup: (lat: number, lng: number) => Promise<PlaceFinding> = placeAt,
): Promise<string | null> {
  // Implemented on top of municipalityFinding so the two can never disagree
  // about precedence or about what a failure means.
  const f = await municipalityFinding(fromRecord, point, lookup);
  return f.kind === 'named' ? f.municipality : null;
}
