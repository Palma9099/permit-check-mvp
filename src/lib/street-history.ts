// Older Street View photos of a property, dated and aimed at the house.
//
// Google's server APIs cannot list a street's capture history, but its Maps
// JavaScript API can, from the browser: a StreetViewService lookup returns every
// dated capture near a point. We read those dates and positions, keep the
// captures taken from nearly the same spot (so the angle matches), aim each one
// at the property, and render them with the Street View Static API.
// Browser only. Needs the Maps JavaScript API enabled for the browser key.

declare const google: any;

export interface StreetFrame {
  pano: string;
  date: string; // YYYY-MM
  year: number;
  heading: number;
  distM: number;
  lat: number;
  lng: number;
  label: string; // "Oct 2008"
  imageUrl: string;
}

let loading: Promise<void> | null = null;

function loadMaps(key: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('browser only'));
  const w = window as any;
  if (w.google?.maps?.StreetViewService) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const cb = `__palmaMapsReady${Date.now()}`;
    w[cb] = () => resolve();
    w.gm_authFailure = () => reject(new Error('Google rejected the browser key'));
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=${cb}&v=weekly`;
    s.async = true;
    s.onerror = () => reject(new Error('Could not load Google Maps'));
    document.head.appendChild(s);
  });
  loading.catch(() => {
    loading = null; // allow a retry on the next report
  });
  return loading;
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
function bearing(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const y = Math.sin(rad(bLng - aLng)) * Math.cos(rad(bLat));
  const x = Math.cos(rad(aLat)) * Math.sin(rad(bLat)) - Math.sin(rad(aLat)) * Math.cos(rad(bLat)) * Math.cos(rad(bLng - aLng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
function meters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return Math.hypot((bLat - aLat) * 111_320, (bLng - aLng) * 111_320 * Math.cos(rad((aLat + bLat) / 2)));
}

// The capture date is stored under an obfuscated property name that can change
// between Google releases, so find whichever property holds a Date.
function dateOf(t: Record<string, unknown>): Date | null {
  for (const v of Object.values(t)) if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  return null;
}

function monthYear(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export async function fetchStreetHistory(opts: { key: string; lat: number; lng: number }): Promise<StreetFrame[]> {
  await loadMaps(opts.key);
  const svc = new google.maps.StreetViewService();
  const byLocation = new Promise<any>((res) =>
    svc.getPanorama(
      { location: { lat: opts.lat, lng: opts.lng }, radius: 60, source: google.maps.StreetViewSource.OUTDOOR },
      (d: any, status: string) => res(status === 'OK' ? d : null),
    ),
  );
  const first = await byLocation;
  const times: Array<{ pano: string; d: Date }> = (first?.time ?? [])
    .map((t: any) => ({ pano: String(t.pano), d: dateOf(t) }))
    .filter((t: any) => t.pano && t.d);
  if (times.length < 2) return [];

  const placed = (
    await Promise.all(
      times.map(
        (t) =>
          new Promise<any>((res) =>
            svc.getPanorama({ pano: t.pano }, (d: any, status: string) => {
              const ll = status === 'OK' ? d?.location?.latLng : null;
              if (!ll) return res(null);
              const lat = ll.lat();
              const lng = ll.lng();
              res({ pano: t.pano, d: t.d, lat, lng, distM: meters(lat, lng, opts.lat, opts.lng), heading: bearing(lat, lng, opts.lat, opts.lng) });
            }),
          ),
      ),
    )
  ).filter(Boolean) as Array<{ pano: string; d: Date; lat: number; lng: number; distM: number; heading: number }>;

  // Same spot: keep captures within 15 m of the one nearest the house, and
  // within 55 m of the house itself.
  const near = placed.filter((p) => p.distM <= 55).sort((a, b) => a.distM - b.distM);
  if (!near.length) return [];
  const anchor = near[0];
  const cluster = near
    .filter((p) => meters(p.lat, p.lng, anchor.lat, anchor.lng) <= 15)
    .sort((a, b) => a.d.getTime() - b.d.getTime());
  // One frame per month.
  const seen = new Set<string>();
  const unique = cluster.filter((p) => {
    const k = p.d.toISOString().slice(0, 7);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.length < 2) return [];

  // At most five: oldest, newest, and evenly spaced between.
  let chosen = unique;
  if (unique.length > 5) {
    const idx = new Set([0, unique.length - 1, ...[1, 2, 3].map((i) => Math.round((i * (unique.length - 1)) / 4))]);
    chosen = [...idx].sort((a, b) => a - b).map((i) => unique[i]);
  }

  return chosen.map((p) => {
    const heading = Math.round(p.heading);
    return {
      pano: p.pano,
      date: p.d.toISOString().slice(0, 7),
      year: p.d.getUTCFullYear(),
      heading,
      distM: Math.round(p.distM),
      lat: p.lat,
      lng: p.lng,
      label: monthYear(p.d),
      imageUrl:
        'https://maps.googleapis.com/maps/api/streetview?size=640x480' +
        `&pano=${encodeURIComponent(p.pano)}&heading=${heading}&pitch=5&fov=100&return_error_code=true` +
        `&key=${encodeURIComponent(opts.key)}`,
    };
  });
}
