// Historical aerial imagery via Microsoft Planetary Computer's NAIP catalog.
//
// NAIP (National Agriculture Imagery Program) is 1m-resolution 4-band aerial
// imagery captured over the continental US every 2–3 years, going back to
// ~2004 for most Florida counties. Planetary Computer hosts it in a free,
// STAC-searchable catalog with a tiler that can return PNGs clipped to an
// arbitrary bbox — no scipy/rasterio required server-side.
//
// Pipeline:
//   1. STAC search at the parcel point, sorted by capture date ascending.
//   2. Pick the earliest item as "then" and the latest as "now".
//      (We still also fetch a Google Static Maps current frame separately —
//      NAIP's "now" is typically 1–2 years behind Google's satellite layer,
//      so we keep both.)
//   3. Build the tiler bbox-crop URL for each, clipped to the parcel extent
//      (or a synthetic ~120ft box around the point if no polygon).
//
// Reliability notes:
//   - STAC search endpoint is unauthenticated and rate-limited; we set a
//     10s timeout and fail closed (return nulls) on any error.
//   - The tiler endpoint is also unauthenticated but subject to soft
//     throttling. A PLANETARY_COMPUTER_KEY env var will be attached as a
//     subscription header when present for higher quotas.
//   - NAIP coverage is US-only. Outside Florida/the continental US this
//     returns nothing.

import type { ParcelRing } from '../types';

const STAC_SEARCH = 'https://planetarycomputer.microsoft.com/api/stac/v1/search';
const TILER_BASE = 'https://planetarycomputer.microsoft.com/api/data/v1';

export interface HistoricalAerialFrame {
  captureDate: string;          // ISO 8601 (e.g. "2015-11-23T00:00:00Z")
  captureYear: number;          // e.g. 2015
  itemId: string;               // STAC item id, for debugging
  imageUrl: string;             // PNG URL clipped to the parcel bbox, 640x640
}

export interface HistoricalAerialResult {
  then: HistoricalAerialFrame | null;
  now: HistoricalAerialFrame | null;
  allFrames: HistoricalAerialFrame[];    // earliest → latest, for the report
  source: string;                         // "Microsoft Planetary Computer / NAIP"
  failureReason: string | null;
}

// Approx lat/lng deltas for a given distance at Florida latitudes. 1° lat ≈
// 111km; 1° lng ≈ 101km at 25°N. 120ft ≈ 36.6m. These don't need to be exact
// — they just set the bbox extent for the clipped PNG.
const FEET_PER_DEG_LAT = 364320;      // 111,000m / 0.3048 / 1000 — rough
const FEET_PER_DEG_LNG_FL = 331000;   // ~cos(26°) * FEET_PER_DEG_LAT

function bboxFromParcel(
  lat: number,
  lng: number,
  polygon: ParcelRing | null | undefined,
  paddingFeet = 200,
): { minx: number; miny: number; maxx: number; maxy: number } {
  // Why 200ft (was 40ft): NAIP is 1m native for older years (2010 captures
  // are 1m, more recent are 30–60cm). A tight ~150ft box at 1m gives only
  // ~46 native pixels — rendered to 640×640 that's a 13× upscale, which
  // shows as heavy pixelation in the report. A 200ft padding around a
  // typical 70×80ft lot puts the bbox closer to ~470ft per side, ≈ 143m,
  // ≈ 143 native pixels at 1m and ≈ 477 at 30cm. Render-time upscale drops
  // to 1.3–4×, looks substantially sharper. Trade-off: subject is a smaller
  // fraction of the frame — but the AI cross-references the Google NOW
  // satellite frame (with red polygon overlay) for spatial anchoring, so it
  // can still tell which building is the subject.
  if (polygon && polygon.length >= 3) {
    let minLat = polygon[0][0];
    let maxLat = polygon[0][0];
    let minLng = polygon[0][1];
    let maxLng = polygon[0][1];
    for (const [la, ln] of polygon) {
      if (la < minLat) minLat = la;
      if (la > maxLat) maxLat = la;
      if (ln < minLng) minLng = ln;
      if (ln > maxLng) maxLng = ln;
    }
    const padLat = paddingFeet / FEET_PER_DEG_LAT;
    const padLng = paddingFeet / FEET_PER_DEG_LNG_FL;
    return {
      minx: minLng - padLng,
      miny: minLat - padLat,
      maxx: maxLng + padLng,
      maxy: maxLat + padLat,
    };
  }
  // Fallback: ~470ft box around the geocoded point.
  const halfLat = 235 / FEET_PER_DEG_LAT;
  const halfLng = 235 / FEET_PER_DEG_LNG_FL;
  return {
    minx: lng - halfLng,
    miny: lat - halfLat,
    maxx: lng + halfLng,
    maxy: lat + halfLat,
  };
}

function buildNaipCropUrl(
  itemId: string,
  bbox: { minx: number; miny: number; maxx: number; maxy: number },
  width = 640,
  height = 640,
): string {
  // asset_bidx=image|1,2,3 picks the RGB bands (NAIP is 4-band; band 4 is NIR
  // which we skip for visual comparison). format=png returns a true-color PNG.
  const u = new URL(
    `${TILER_BASE}/item/bbox/${bbox.minx},${bbox.miny},${bbox.maxx},${bbox.maxy}/${width}x${height}.png`,
  );
  u.searchParams.set('collection', 'naip');
  u.searchParams.set('item', itemId);
  u.searchParams.set('assets', 'image');
  u.searchParams.set('asset_bidx', 'image|1,2,3');
  return u.toString();
}

async function stacSearch(
  lng: number,
  lat: number,
  timeoutMs = 10000,
): Promise<Array<{ id: string; datetime: string }>> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.PLANETARY_COMPUTER_KEY) {
      headers['Ocp-Apim-Subscription-Key'] = process.env.PLANETARY_COMPUTER_KEY;
    }
    const res = await fetch(STAC_SEARCH, {
      method: 'POST',
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        collections: ['naip'],
        intersects: { type: 'Point', coordinates: [lng, lat] },
        datetime: '2004-01-01/..',
        limit: 50,
        sortby: [{ field: 'properties.datetime', direction: 'asc' }],
      }),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const feats = Array.isArray(data?.features) ? data.features : [];
    return feats
      .map((f: any) => ({
        id: String(f?.id ?? ''),
        datetime: String(f?.properties?.datetime ?? ''),
      }))
      .filter((f: { id: string; datetime: string }) => f.id && f.datetime);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

export async function fetchHistoricalAerials(
  lat: number,
  lng: number,
  polygon?: ParcelRing | null,
): Promise<HistoricalAerialResult> {
  const source = 'Microsoft Planetary Computer / NAIP';
  const bbox = bboxFromParcel(lat, lng, polygon);

  const items = await stacSearch(lng, lat);
  if (items.length === 0) {
    return {
      then: null,
      now: null,
      allFrames: [],
      source,
      failureReason:
        'No NAIP imagery returned from Planetary Computer for this parcel. NAIP coverage is US-only and may have gaps outside the continental US.',
    };
  }

  // items are already sorted ascending by datetime.
  const allFrames: HistoricalAerialFrame[] = items.map((it) => {
    const year = Number(it.datetime.slice(0, 4));
    return {
      captureDate: it.datetime,
      captureYear: Number.isFinite(year) ? year : 0,
      itemId: it.id,
      imageUrl: buildNaipCropUrl(it.id, bbox),
    };
  });

  const then = allFrames[0] ?? null;
  const now = allFrames[allFrames.length - 1] ?? null;

  // Don't return a degenerate "then == now" pair — if only one frame exists,
  // surface it as "now" (the current NAIP), leave "then" null, and the
  // report/prompt will handle the single-frame case.
  if (then && now && then.itemId === now.itemId) {
    return { then: null, now, allFrames, source, failureReason: null };
  }

  return { then, now, allFrames, source, failureReason: null };
}
