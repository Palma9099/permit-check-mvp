// Google Street View historical pano fetcher.
//
// Google's own Street View time-slider on maps.google.com exposes ALL
// historical panos at a given location through the `GeoPhotoService.SingleImageSearch`
// endpoint when called with the right `pb=` flags (`!5m1!1e2!6m1!1e2` enable
// historical timeline data). The endpoint is undocumented but has been stable
// for years and powers the public maps.google.com slider.
//
// Once we have a historical pano_id, the documented Street View Static API
// renders that exact frame:
//   https://maps.googleapis.com/maps/api/streetview?pano=ID&heading=H&...&key=K
//
// This is the primary historical Street View source for the report. Mapillary
// is used as fallback when Google has no panos for a parcel (which on FL
// residential streets is rare; Google's coverage is much better than Mapillary's).
//
// Maintenance note: the `pb` payload format is undocumented and Google
// occasionally rotates it. The reference implementation we mirror is the
// `streetview` Python package by robolyst (github.com/robolyst/streetview),
// which keeps its payload current. If this endpoint starts returning HTTP 400
// or "Invalid 'pb' parameter", check that lib for the latest payload and
// update `makeSearchUrl` below.

const SEARCH_URL = 'https://maps.googleapis.com/maps/api/js/GeoPhotoService.SingleImageSearch';

export interface GooglePano {
  panoId: string;
  panoLat: number;
  panoLng: number;
  cameraHeading: number;       // compass angle the camera was facing when captured
  date: string | null;         // 'YYYY-MM' (Google does not return day)
  year: number | null;
  distM: number;               // meters from the parcel center
  bearingToSubject: number;    // compass bearing from pano position TO parcel center
}

// Build the SingleImageSearch URL. The `5m1!1e2!6m1!1e2` flags at the end are
// what unlocks historical timeline data (without them, only the current pano
// comes back). Format mirrors the streetview Python lib (MIT, robolyst).
function makeSearchUrl(lat: number, lng: number): string {
  const pb =
    '!1m5!1sapiv3!5sUS!11m2!1m1!1b0!2m4!1m2' +
    `!3d${lat}!4d${lng}` +
    '!2d50!3m10!2m2!1sen!2sGB!9m1!1e2!11m4!1m3!1e2!2b1!3e2!4m10!1e1!1e2!1e3!1e4!1e8!1e6!5m1!1e2!6m1!1e2';
  const u = new URL(SEARCH_URL);
  u.searchParams.set('pb', pb);
  u.searchParams.set('callback', 'callbackfunc');
  return u.toString();
}

// JSONP response shape (heavily nested array — same format the public
// maps.google.com slider parses):
//   callbackfunc( <data> )
// where data is one of:
//   [[5, "generic", "Search returned no images."]]   → no panos
// or a 2-element array whose [1][5][0] subset has:
//   subset[3][0]   → list of pano entries
//   subset[8]      → list of date entries that align IN REVERSE with the
//                    last n panos
function parseSearchResponse(text: string): { panos: any[]; dates: any[] } | null {
  // Google wraps in `callbackfunc( ... )`. The `s` flag is needed because
  // the body contains literal newlines.
  const m = text.match(/callbackfunc\(\s*([\s\S]*?)\s*\)\s*$/);
  if (!m) return null;
  let data: any;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return null;
  }
  if (Array.isArray(data) && Array.isArray(data[0]) && data[0][0] === 5) {
    return { panos: [], dates: [] };
  }
  const subset = data?.[1]?.[5]?.[0];
  if (!subset) return null;
  const panos = Array.isArray(subset?.[3]?.[0]) ? subset[3][0] : [];
  const dates = subset.length >= 9 && Array.isArray(subset[8]) ? subset[8] : [];
  return { panos, dates };
}

export async function searchGooglePanoramas(
  parcelLat: number,
  parcelLng: number,
  timeoutMs = 8000,
): Promise<GooglePano[]> {
  const url = makeSearchUrl(parcelLat, parcelLng);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      // The endpoint sometimes 400s without a browser-ish UA.
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; permit-check)' },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[google-historical] HTTP ${res.status}: ${body.slice(0, 200)}`);
      return [];
    }
    const text = await res.text();
    const parsed = parseSearchResponse(text);
    if (!parsed) {
      console.error('[google-historical] could not parse response');
      return [];
    }
    const { panos, dates } = parsed;

    // Each date entry is [panoIndex, [year, month], ...]. The FIRST element is
    // an explicit index into the panos array — use it to map dates to panos
    // directly. The old code assumed the dated panos were always the trailing
    // N entries and zipped them by reversed position; that silently mis-stapled
    // dates (or dropped them) whenever the dated captures weren't contiguous at
    // the end of the array, which is common. Index-based mapping is exact.
    const dateByIndex = new Map<number, { year: number; month: number }>();
    for (const d of dates) {
      if (
        Array.isArray(d) &&
        typeof d[0] === 'number' &&
        Array.isArray(d[1]) &&
        typeof d[1][0] === 'number' &&
        typeof d[1][1] === 'number'
      ) {
        dateByIndex.set(d[0], { year: d[1][0], month: d[1][1] });
      }
    }

    const result: GooglePano[] = [];
    for (let i = 0; i < panos.length; i++) {
      const p = panos[i];
      const panoId = p?.[0]?.[1];
      const lat = p?.[2]?.[0]?.[2];
      const lng = p?.[2]?.[0]?.[3];
      const heading = p?.[2]?.[2]?.[0];
      if (typeof panoId !== 'string' || typeof lat !== 'number' || typeof lng !== 'number') continue;

      let date: string | null = null;
      let year: number | null = null;
      const dm = dateByIndex.get(i);
      if (dm) {
        date = `${dm.year}-${String(dm.month).padStart(2, '0')}`;
        year = dm.year;
      }

      const distM = haversineMeters(lat, lng, parcelLat, parcelLng);
      const bearingToSubject = bearingDeg(lat, lng, parcelLat, parcelLng);

      result.push({
        panoId,
        panoLat: lat,
        panoLng: lng,
        cameraHeading: typeof heading === 'number' ? heading : 0,
        date,
        year,
        distM,
        bearingToSubject,
      });
    }
    return result;
  } catch (err: any) {
    console.error(`[google-historical] threw: ${String(err?.message ?? err).slice(0, 200)}`);
    return [];
  } finally {
    clearTimeout(t);
  }
}

// Search Google panos from SEVERAL candidate points and union the results by
// panoId. Google's SingleImageSearch is sensitive to the query coordinate:
// for a set-back house the rooftop geocode can land deep in the lot, and a
// search from there returns a pano cluster with NO dated captures — while a
// search from the parcel centroid or a road-facing point returns the full
// historical timeline (2008/2011/2022 etc.). Querying multiple points and
// merging by panoId guarantees we surface dated captures regardless of where
// any single geocode lands. When the same pano comes back dated from one
// point and undated from another, we keep the dated copy.
export async function searchGooglePanoramasMulti(
  points: Array<{ lat: number; lng: number }>,
  refLat: number,
  refLng: number,
): Promise<GooglePano[]> {
  // Dedupe near-identical query points (within ~2m) so we don't waste calls.
  const uniquePoints: Array<{ lat: number; lng: number }> = [];
  for (const pt of points) {
    if (!uniquePoints.some((u) => haversineMeters(u.lat, u.lng, pt.lat, pt.lng) < 2)) {
      uniquePoints.push(pt);
    }
  }
  const lists = await Promise.all(
    uniquePoints.map((pt) => searchGooglePanoramas(pt.lat, pt.lng).catch(() => [] as GooglePano[])),
  );
  const byId = new Map<string, GooglePano>();
  for (const list of lists) {
    for (const p of list) {
      const existing = byId.get(p.panoId);
      if (!existing || (!existing.date && p.date)) {
        // Normalize dist/bearing to the canonical reference point so callers
        // get consistent values no matter which query point surfaced the pano.
        byId.set(p.panoId, {
          ...p,
          distM: haversineMeters(p.panoLat, p.panoLng, refLat, refLng),
          bearingToSubject: bearingDeg(p.panoLat, p.panoLng, refLat, refLng),
        });
      }
    }
  }
  return [...byId.values()];
}

// Cluster panos by which side (fronting street) they came from. Two panos
// whose bearings-to-subject differ by ≤ tolerance are treated as the same
// street. Matches the Mapillary side-grouping algorithm.
export function clusterPanosBySide(
  panos: GooglePano[],
  maxBearingDeltaDeg = 50,
): GooglePano[][] {
  const sides: { centerBearing: number; frames: GooglePano[] }[] = [];
  for (const p of panos) {
    const existing = sides.find(
      (s) => angularDelta(s.centerBearing, p.bearingToSubject) <= maxBearingDeltaDeg,
    );
    if (existing) {
      existing.frames.push(p);
      // Roll center bearing toward the new frame.
      existing.centerBearing = (existing.centerBearing + p.bearingToSubject) / 2;
    } else {
      sides.push({ centerBearing: p.bearingToSubject, frames: [p] });
    }
  }
  // Largest cluster first — that's the primary fronting street.
  sides.sort((a, b) => b.frames.length - a.frames.length);
  return sides.map((s) => s.frames);
}

// Pick the best Then/Now pair from a single-side cluster.
//   THEN: earliest dated pano in the cluster
//   NOW : latest dated pano in the cluster
// We require ≥ minYearGap years between THEN and NOW so we don't show
// "2022-01 vs 2022-03" as a "Then vs Now" — that's just two adjacent drives.
export function pickThenNow(
  cluster: GooglePano[],
  minYearGap = 3,
): { then: GooglePano | null; now: GooglePano | null } {
  const dated = cluster
    .filter((p) => p.year != null && p.date != null)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  if (dated.length === 0) return { then: null, now: null };
  if (dated.length === 1) return { then: null, now: dated[0] };
  const earliest = dated[0];
  const latest = dated[dated.length - 1];
  if ((latest.year! - earliest.year!) < minYearGap) {
    return { then: null, now: latest };
  }
  return { then: earliest, now: latest };
}

// Build a Google Street View Static API URL that renders a SPECIFIC pano
// (current or historical) looking toward the parcel.
//
// PITCH: 5° up by default. FL residential lots commonly have a 5-6ft solid
// privacy fence right at the property line. With pitch 0° (level) the
// camera frame is half-fence half-house; with pitch 5° (slight up) the
// fence sits at the bottom of the frame and the front facade dominates the
// upper 2/3 — which is what the realtor actually wants to compare.
export function buildHistoricalStaticUrl(
  panoId: string,
  heading: number,
  size: { w: number; h: number } = { w: 640, h: 480 },
  fov = 90,
  pitch = 5,
): string | null {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const u = new URL('https://maps.googleapis.com/maps/api/streetview');
  u.searchParams.set('size', `${size.w}x${size.h}`);
  u.searchParams.set('pano', panoId);
  u.searchParams.set('heading', heading.toFixed(1));
  u.searchParams.set('pitch', String(pitch));
  u.searchParams.set('fov', String(fov));
  u.searchParams.set('return_error_code', 'true');
  u.searchParams.set('key', key);
  return u.toString();
}

// ---- helpers ----

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lng2 - lng1);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function bearingDeg(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(fromLat);
  const φ2 = toRad(toLat);
  const Δλ = toRad(toLng - fromLng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function angularDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
