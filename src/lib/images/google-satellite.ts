// Google Static Maps (satellite) URL builder, with parcel polygon overlay.
//
// The Google Maps Static API accepts a `path` parameter that draws a
// polyline / polygon directly on the returned PNG — no server-side image
// manipulation required. Syntax:
//
//   path=color:0xFF0000FF|weight:4|lat1,lng1|lat2,lng2|...|latN,lngN
//
// We draw the parcel polygon as a bright red outline (no fill) so the
// vision model can see everything inside AND everything around the parcel,
// but know exactly where the subject ends.
//
// URL length budget: Google Static Maps caps at ~8,192 chars. A typical
// residential parcel has 4–20 vertices; even with 50 points at ~20 chars
// each we stay well under. We clamp to 200 points defensively.

import type { ParcelRing } from '../types';
import { browserMapsKey } from './keys';

export interface SatelliteUrlOpts {
  lat: number;
  lng: number;
  polygon?: ParcelRing | null;
  // Zoom-equivalent. Lower zoom = wider frame. Google Static Maps accepts
  // integer zooms 0–21 for satellite.
  zoom?: number;
  // Pixel dimensions of the returned PNG. Max free-tier: 640x640. With
  // &scale=2 we effectively get 1280x1280 at 2x DPI.
  size?: { w: number; h: number };
  scale?: 1 | 2;
}

export function buildGoogleSatelliteUrl(opts: SatelliteUrlOpts): string | null {
  const key = browserMapsKey();
  if (!key) return null;

  const size = opts.size ?? { w: 640, h: 640 };
  const scale = opts.scale ?? 2;
  const zoom = opts.zoom ?? 20;

  const u = new URL('https://maps.googleapis.com/maps/api/staticmap');
  u.searchParams.set('center', `${opts.lat},${opts.lng}`);
  u.searchParams.set('zoom', String(zoom));
  u.searchParams.set('size', `${size.w}x${size.h}`);
  u.searchParams.set('scale', String(scale));
  u.searchParams.set('maptype', 'satellite');
  u.searchParams.set('format', 'png');
  u.searchParams.set('key', key);

  if (opts.polygon && opts.polygon.length >= 3) {
    const pts = opts.polygon.slice(0, 200);
    // Ensure the ring closes — Google Static Maps draws a polyline; to get
    // a closed ring we append the first point at the end if not already.
    const first = pts[0];
    const last = pts[pts.length - 1];
    const closed =
      first[0] === last[0] && first[1] === last[1] ? pts : [...pts, first];
    const pathPoints = closed.map(([la, ln]) => `${la.toFixed(6)},${ln.toFixed(6)}`).join('|');
    const path = `color:0xFF0000FF|weight:4|${pathPoints}`;
    u.searchParams.set('path', path);
  }

  return u.toString();
}

// Two convenience builders the caller can use directly — tight subject view
// and wider block-context view — both with the polygon overlay baked in.
export function buildSubjectSatelliteUrl(lat: number, lng: number, polygon?: ParcelRing | null): string | null {
  return buildGoogleSatelliteUrl({ lat, lng, polygon, zoom: 20, size: { w: 640, h: 640 } });
}

export function buildContextSatelliteUrl(lat: number, lng: number, polygon?: ParcelRing | null): string | null {
  return buildGoogleSatelliteUrl({ lat, lng, polygon, zoom: 18, size: { w: 640, h: 640 } });
}
