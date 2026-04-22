// Google Street View Static API — URL builder for multiple headings.
//
// Street View Static API:
//   https://maps.googleapis.com/maps/api/streetview?size=640x640&location=LAT,LNG&heading=HEADING&pitch=0&fov=90&key=KEY
//
// Metadata endpoint (free):
//   https://maps.googleapis.com/maps/api/streetview/metadata?location=...&key=...
// Returns { status: "OK" | "ZERO_RESULTS" | ... } — use to decide whether
// to bother building the image URL.
//
// We fetch 3 headings per property:
//   - "Front" — facing the parcel from the nearest street (we don't know the
//     street direction a priori, so we use 0° as a stand-in for "north";
//     the realtor can rotate in the interactive Street View link).
//   - Two angled views (-45°, +45°).
//
// For the vision model, one solid front-facing image is usually enough;
// angled views help when the parcel is on a corner.

import type { StreetViewImage } from '../types';

export interface StreetViewOpts {
  lat: number;
  lng: number;
  // Headings (degrees clockwise from north) to fetch. Defaults to 3 views.
  headings?: number[];
  size?: { w: number; h: number };
  fov?: number;   // 10–120, wider = more context
}

function labelForHeading(h: number): string {
  const normalized = ((h % 360) + 360) % 360;
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(normalized / 45) % 8;
  return `Street View facing ${names[idx]}`;
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

// Metadata check — returns true if a Street View pano exists near the point.
// Keeps us from showing a "no imagery here" placeholder to the user in the
// few FL properties that lack coverage.
export async function hasStreetView(lat: number, lng: number, radiusM = 50): Promise<boolean> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return false;
  const u = new URL('https://maps.googleapis.com/maps/api/streetview/metadata');
  u.searchParams.set('location', `${lat},${lng}`);
  u.searchParams.set('radius', String(radiusM));
  u.searchParams.set('source', 'outdoor');
  u.searchParams.set('key', key);
  try {
    const res = await fetch(u.toString(), { cache: 'no-store' });
    if (!res.ok) return false;
    const data: any = await res.json();
    return data?.status === 'OK';
  } catch {
    return false;
  }
}
