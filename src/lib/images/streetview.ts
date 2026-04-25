// Google Street View Static API — heading-aware URL builder.
//
// The naive 4-cardinal-headings approach (N/E/S/W) wastes 2–3 of 4 frames on
// pavement or the neighbor across the street, because the camera at the road
// rarely faces the subject from a cardinal direction. The AI vision call can
// usually reconcile that against the satellite anchor, but it's noisy and
// makes the report look like it's mixing parcels.
//
// New approach:
//   1. Call the metadata endpoint at the parcel center to get the actual
//      pano location (lat/lng of the closest Street View capture point).
//   2. Compute the great-circle bearing FROM the pano TO the parcel center.
//      That's the heading that puts the subject squarely in the frame.
//   3. Return two images: the primary front-facing shot at that bearing, and
//      one slight-angle shot at bearing + 25° for parallax.
//
// Falls back to the old 4-cardinal grid only if the metadata call fails or
// returns no usable location.
//
// Metadata response (free tier, no quota cost):
//   { status: "OK", pano_id, location: { lat, lng }, date }
// Static image:
//   https://maps.googleapis.com/maps/api/streetview?size=640x480&location=...&heading=...&pitch=0&fov=90&key=...

import type { StreetViewImage } from '../types';

export interface StreetViewOpts {
  lat: number;
  lng: number;
  headings?: number[];
  size?: { w: number; h: number };
  fov?: number;
}

function labelForHeading(h: number): string {
  const normalized = ((h % 360) + 360) % 360;
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(normalized / 45) % 8;
  return `Street View facing ${names[idx]}`;
}

// Great-circle bearing from point A to point B, in degrees clockwise from north.
function bearingDeg(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(fromLat);
  const φ2 = toRad(toLat);
  const Δλ = toRad(toLng - fromLng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return (toDeg(θ) + 360) % 360;
}

export function buildStreetViewUrls(opts: StreetViewOpts): StreetViewImage[] {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return [];

  const size = opts.size ?? { w: 640, h: 480 };
  const fov = opts.fov ?? 90;
  const headings = opts.headings ?? [0, 90, 180, 270];

  return headings.map((h) => {
    const u = new URL('https://maps.googleapis.com/maps/api/streetview');
    u.searchParams.set('size', `${size.w}x${size.h}`);
    u.searchParams.set('location', `${opts.lat},${opts.lng}`);
    u.searchParams.set('heading', String(h));
    u.searchParams.set('pitch', '0');
    u.searchParams.set('fov', String(fov));
    u.searchParams.set('source', 'outdoor');
    u.searchParams.set('return_error_code', 'true');
    u.searchParams.set('key', key);
    return {
      heading: h,
      label: labelForHeading(h),
      imageUrl: u.toString(),
    };
  });
}

// Metadata response shape we care about.
interface StreetViewMeta {
  ok: boolean;
  panoLat: number | null;
  panoLng: number | null;
  panoDate: string | null;
}

export async function getStreetViewMeta(lat: number, lng: number, radiusM = 80): Promise<StreetViewMeta> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return { ok: false, panoLat: null, panoLng: null, panoDate: null };
  const u = new URL('https://maps.googleapis.com/maps/api/streetview/metadata');
  u.searchParams.set('location', `${lat},${lng}`);
  u.searchParams.set('radius', String(radiusM));
  u.searchParams.set('source', 'outdoor');
  u.searchParams.set('key', key);
  try {
    const res = await fetch(u.toString(), { cache: 'no-store' });
    if (!res.ok) return { ok: false, panoLat: null, panoLng: null, panoDate: null };
    const data: any = await res.json();
    if (data?.status !== 'OK') return { ok: false, panoLat: null, panoLng: null, panoDate: null };
    const pl = data?.location;
    return {
      ok: true,
      panoLat: typeof pl?.lat === 'number' ? pl.lat : null,
      panoLng: typeof pl?.lng === 'number' ? pl.lng : null,
      panoDate: typeof data?.date === 'string' ? data.date : null,
    };
  } catch {
    return { ok: false, panoLat: null, panoLng: null, panoDate: null };
  }
}

// Back-compat thin wrapper used by other callers — returns just the boolean.
export async function hasStreetView(lat: number, lng: number, radiusM = 50): Promise<boolean> {
  const meta = await getStreetViewMeta(lat, lng, radiusM);
  return meta.ok;
}

// Build heading-aware Street View URLs that aim at the parcel from EVERY
// street the parcel touches. Critical for corner lots — there's a Street
// View pano on each fronting street, each facing a different side, and a
// single-pano lookup misses the back/side exposure entirely.
//
// Approach:
//   1. Sample metadata at the parcel center AND at 4 offsets (~30m N/E/S/W).
//      Each offset hops the search closer to a different street, so corner
//      properties surface multiple unique panos.
//   2. Dedupe by pano_id. Drop any pano farther than ~60m from the parcel
//      (those are panos on the next block, not relevant).
//   3. For each unique pano, compute bearing back to parcel and emit one
//      front-facing frame.
//   4. For the closest pano, also emit a +25° angled frame for parallax.
//   5. Cap at 4 frames total (one per side of a corner lot is plenty).
//
// Falls back to the old 4-cardinal grid only when metadata returns nothing.
export async function buildStreetViewUrlsTowardParcel(
  parcelLat: number,
  parcelLng: number,
  opts?: { fov?: number; size?: { w: number; h: number }; offsetDeg?: number },
): Promise<StreetViewImage[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return [];

  // Sample at the center plus 4 offsets ~30m in each cardinal direction.
  // 30m ≈ 0.00027° lat, 0.0003° lng at FL latitudes — far enough to push
  // the metadata "closest pano" search toward a different street on a
  // corner lot, close enough to stay near the subject.
  const dLat = 30 / 111_320;
  const dLng = 30 / (111_320 * Math.cos((parcelLat * Math.PI) / 180));
  const samplePoints: Array<{ lat: number; lng: number }> = [
    { lat: parcelLat, lng: parcelLng },
    { lat: parcelLat + dLat, lng: parcelLng },          // toward North
    { lat: parcelLat - dLat, lng: parcelLng },          // toward South
    { lat: parcelLat, lng: parcelLng + dLng },          // toward East
    { lat: parcelLat, lng: parcelLng - dLng },          // toward West
  ];

  const metas = await Promise.all(
    samplePoints.map((p) => getStreetViewMeta(p.lat, p.lng, 60)),
  );

  // Compute distance from each pano to the parcel, dedupe by panoId,
  // and keep panos within 60m. (PanoId comes back via the metadata
  // endpoint when Google returns OK; on the rare miss we fall back.)
  type Cand = {
    panoLat: number;
    panoLng: number;
    distM: number;
    bearing: number;
    panoKey: string;
  };
  const cands: Cand[] = [];
  for (const m of metas) {
    if (!m.ok || m.panoLat == null || m.panoLng == null) continue;
    const distM = haversineMeters(m.panoLat, m.panoLng, parcelLat, parcelLng);
    if (distM > 60) continue;
    const bearing = bearingDeg(m.panoLat, m.panoLng, parcelLat, parcelLng);
    // Use coarse 5m grid as a dedupe key — distinct panos on different
    // streets will land in different cells, the same pano queried from 5
    // angles will land in the same cell.
    const panoKey = `${Math.round(m.panoLat * 20000)}|${Math.round(m.panoLng * 20000)}`;
    if (cands.some((c) => c.panoKey === panoKey)) continue;
    cands.push({ panoLat: m.panoLat, panoLng: m.panoLng, distM, bearing, panoKey });
  }

  if (cands.length === 0) {
    return buildStreetViewUrls({ lat: parcelLat, lng: parcelLng });
  }

  // Sort by distance to parcel — closest pano first (the "primary" front).
  cands.sort((a, b) => a.distM - b.distM);

  // Filter out fake "side N" candidates that are actually just farther-down
  // panos on the SAME street as the primary. Two panos on the same street
  // (the car driving down it) will have bearings-toward-parcel that are
  // either nearly identical (camera-pano just shifted along the curb) or
  // ~180° opposite (other curb of the same road). EITHER case means there's
  // no NEW visual info — the primary pano already covers that street.
  // A real corner lot's second street will produce a pano whose
  // bearing-toward-parcel is roughly perpendicular (~90° off) to the primary.
  const primary = cands[0];
  const accepted: typeof cands = [primary];
  const SAME_STREET_TOLERANCE_DEG = 35;        // |bearingDelta| ≤ 35°  → same street, near curb
  const OPPOSITE_CURB_TOLERANCE_DEG = 35;      // |bearingDelta| ∈ [180-35, 180+35] → same street, far curb
  for (const c of cands.slice(1)) {
    const delta = angularDelta(c.bearing, primary.bearing);
    const isSameStreetSameCurb = delta <= SAME_STREET_TOLERANCE_DEG;
    const isSameStreetOppositeCurb = Math.abs(delta - 180) <= OPPOSITE_CURB_TOLERANCE_DEG;
    if (isSameStreetSameCurb || isSameStreetOppositeCurb) continue;
    accepted.push(c);
  }

  // Cap at 4 total frames. For an interior lot we'll have 1 accepted pano
  // → 1 primary + 1 angled. For a real corner lot we'll have 2 accepted
  // panos → 1 frame per fronting street + 1 angled on the primary.
  const size = opts?.size ?? { w: 640, h: 480 };
  const fov = opts?.fov ?? 90;
  const offset = opts?.offsetDeg ?? 25;

  const frames: StreetViewImage[] = [];
  accepted.slice(0, 3).forEach((c, i) => {
    // Primary front frame for this pano.
    frames.push(buildSv({
      key, size, fov,
      panoLat: c.panoLat, panoLng: c.panoLng,
      heading: c.bearing,
      label: i === 0
        ? `Street View — front of subject (${c.bearing.toFixed(0)}°)`
        : `Street View — side ${i + 1} of corner lot (${c.bearing.toFixed(0)}°)`,
    }));
    // Add an angled frame ONLY for the closest pano, so we don't blow up
    // the AI prompt with redundant near-duplicate views.
    if (i === 0 && frames.length < 4) {
      const angled = (c.bearing + offset + 360) % 360;
      frames.push(buildSv({
        key, size, fov,
        panoLat: c.panoLat, panoLng: c.panoLng,
        heading: angled,
        label: `Street View — angled view (+${offset}°)`,
      }));
    }
  });

  return frames.slice(0, 4);
}

// Smallest absolute angular difference between two compass headings (0-180).
function angularDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Haversine — meters between two lat/lng pairs.
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

function buildSv(opts: {
  key: string;
  size: { w: number; h: number };
  fov: number;
  panoLat: number;
  panoLng: number;
  heading: number;
  label: string;
}): StreetViewImage {
  const u = new URL('https://maps.googleapis.com/maps/api/streetview');
  u.searchParams.set('size', `${opts.size.w}x${opts.size.h}`);
  u.searchParams.set('location', `${opts.panoLat},${opts.panoLng}`);
  u.searchParams.set('heading', opts.heading.toFixed(1));
  u.searchParams.set('pitch', '0');
  u.searchParams.set('fov', String(opts.fov));
  u.searchParams.set('source', 'outdoor');
  u.searchParams.set('return_error_code', 'true');
  u.searchParams.set('key', opts.key);
  return {
    heading: Math.round(opts.heading),
    label: opts.label,
    imageUrl: u.toString(),
  };
}
