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

// Build heading-aware Street View URLs that aim at the parcel center.
//   - Calls metadata to find the actual pano location.
//   - Computes bearing pano → parcel.
//   - Returns 2 images: primary front view + a +25° offset for parallax.
//
// On any failure (no pano, missing key, missing pano location), falls back
// to the old 4-cardinal grid so the report still shows something.
export async function buildStreetViewUrlsTowardParcel(
  parcelLat: number,
  parcelLng: number,
  opts?: { fov?: number; size?: { w: number; h: number }; offsetDeg?: number },
): Promise<StreetViewImage[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return [];

  const meta = await getStreetViewMeta(parcelLat, parcelLng, 80);
  if (!meta.ok || meta.panoLat == null || meta.panoLng == null) {
    // Fall back to the old grid so the realtor at least sees something.
    return buildStreetViewUrls({ lat: parcelLat, lng: parcelLng });
  }

  const front = bearingDeg(meta.panoLat, meta.panoLng, parcelLat, parcelLng);
  const offset = opts?.offsetDeg ?? 25;
  const headings = [front, (front + offset + 360) % 360];
  const size = opts?.size ?? { w: 640, h: 480 };
  const fov = opts?.fov ?? 90;

  return headings.map((h, i) => {
    const u = new URL('https://maps.googleapis.com/maps/api/streetview');
    u.searchParams.set('size', `${size.w}x${size.h}`);
    // Use the pano location (not the parcel) so heading is interpreted from
    // the actual camera point. Otherwise Google snaps to a different pano.
    u.searchParams.set('location', `${meta.panoLat},${meta.panoLng}`);
    u.searchParams.set('heading', h.toFixed(1));
    u.searchParams.set('pitch', '0');
    u.searchParams.set('fov', String(fov));
    u.searchParams.set('source', 'outdoor');
    u.searchParams.set('return_error_code', 'true');
    u.searchParams.set('key', key);
    const label = i === 0
      ? `Street View — front of subject (heading ${h.toFixed(0)}°)`
      : `Street View — angled (heading ${h.toFixed(0)}°, +${offset}° offset)`;
    return {
      heading: Math.round(h),
      label,
      imageUrl: u.toString(),
    };
  });
}
