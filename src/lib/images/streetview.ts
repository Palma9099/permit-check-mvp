// Unified Street View engine — Google sole source.
//
// PROBLEM THIS REPLACES:
// The old code had two parallel pipelines:
//   - Current SV via Google's documented metadata API + offset sampling
//   - Historical SV via Google's SingleImageSearch
// They returned panos at different positions, computed headings against the
// parcel centroid (or worse, the parcel-line geocode), and rendered frames
// that pointed at "somewhere in the lot" rather than at the house. For
// 6704 SW 134 PL specifically, the rendered THEN/NOW pair pointed
// north-northwest at the back fence while Google Maps' own viewer at the
// same pano shows the front of the house when pointed west-southwest —
// because the house is on the WEST side of the lot, not at the centroid
// of the parcel-line geocode.
//
// NEW ENGINE:
//   1. Caller passes in two points:
//        searchLat/searchLng = where to look for Google panos (parcel center)
//        aimLat/aimLng       = what the camera should point AT (polygon
//                              centroid — almost always the building)
//   2. ONE call to Google's SingleImageSearch returns all panos at the
//      parcel, both Street View Car captures (with dates) and user photo
//      spheres (no dates).
//   3. We use only the dated Street View Car panos and only those within
//      30m of the AIM point. Cluster by camera position so corner lots
//      that have panos on two distinct fronting streets emit two side
//      pairs.
//   4. For each cluster, compute ONE shared heading: bearing from the
//      cluster centroid → aim point. That's "look at the house from where
//      the car was." Same heading is applied to every pano in that cluster
//      (THEN, NOW, every drive in between), so THEN/NOW frames are
//      identical geometry — only the date changes.
//   5. Pick LATEST dated pano in the primary cluster as the canonical
//      "current" frame. Pick EARLIEST as THEN if there's at least a 3-year
//      gap.
//
// This is the only Street View entry point for the orchestrator. The old
// streetview-historical.ts wraps this engine for backward compatibility.

import type { StreetViewImage } from '../types';
import {
  searchGooglePanoramas,
  buildHistoricalStaticUrl,
  type GooglePano,
} from './google-historical';

export interface StreetViewHistoricalFrame {
  captureDate: string;       // ISO timestamp (year-month-01T00:00:00Z)
  captureYear: number;
  imageUrl: string;
  heading: number;           // compass heading (0-359)
  label: string;             // human-readable for the report
}

export interface StreetViewSidePair {
  sideLabel: string;                    // "Primary front", "Side 2", etc.
  approxBearingFromCenter: number;      // shared heading for this side
  then: StreetViewHistoricalFrame | null;
  now: StreetViewHistoricalFrame | null;
}

export interface StreetViewEngineResult {
  // Current frames for the report's "Street View — front of subject" block.
  // Always 1 frame today (one cluster = one front view). Multiple frames
  // when corner-lot detection emits a side per fronting street.
  current: StreetViewImage[];
  // Historical THEN/NOW pairs. Same panos as `current`, just multiple dates.
  historicalSides: StreetViewSidePair[];
  // All dated panos discovered (for vision-compare's `allFrames`).
  allFrames: StreetViewHistoricalFrame[];
  // Source label for the report.
  source: string;
  // Honest reason if we couldn't produce a usable result.
  failureReason: string | null;
}

const DEFAULT_FOV = 110;            // wide enough that aim imprecision still fits the building
const DEFAULT_PITCH = 5;            // tilt up 5° to clear privacy fences
const MAX_PANO_DIST_M = 30;         // panos beyond this aren't really fronting the parcel
const CLUSTER_RADIUS_M = 8;         // panos within 8m of each other = same cluster (one side)
const MIN_THEN_NOW_YEARS = 3;       // require ≥3yr span for a real THEN/NOW

// Public API: build the entire Street View block — current + historical —
// from one unified pipeline.
export async function buildStreetViewEngine(opts: {
  searchLat: number;
  searchLng: number;
  aimLat: number;
  aimLng: number;
  fov?: number;
  size?: { w: number; h: number };
}): Promise<StreetViewEngineResult> {
  const fov = opts.fov ?? DEFAULT_FOV;
  const size = opts.size ?? { w: 640, h: 480 };

  // 1. Pull every pano Google has near the parcel.
  const allPanos = await searchGooglePanoramas(opts.searchLat, opts.searchLng);
  if (allPanos.length === 0) {
    return emptyResult('No Google Street View panos near this location.');
  }

  // 2. Recompute distance/bearing relative to the AIM point (not the search
  //    point). Aim is what the camera should look at — for a typical FL lot
  //    that's the polygon centroid, which is much closer to the actual house
  //    than the parcel-line geocode.
  const enriched = allPanos.map((p) => {
    const distToAim = haversineMeters(p.panoLat, p.panoLng, opts.aimLat, opts.aimLng);
    const bearingToAim = bearingFromTo(p.panoLat, p.panoLng, opts.aimLat, opts.aimLng);
    return { ...p, distToAim, bearingToAim };
  });

  // 3. Keep only DATED Street View Car captures within 30m of aim.
  //    User photo spheres (date=null) are dropped — they aren't part of
  //    a historical sequence and Google doesn't include them in the
  //    timeline-slider history anyway.
  const usableDated = enriched
    .filter((p) => p.date != null)
    .filter((p) => p.distToAim <= MAX_PANO_DIST_M);

  if (usableDated.length === 0) {
    // No dated panos near aim. Try a "current only" render from the closest
    // pano at all (could be undated photo sphere) so the report still shows
    // something for the front view.
    const fallback = enriched
      .filter((p) => p.distToAim <= MAX_PANO_DIST_M)
      .sort((a, b) => a.distToAim - b.distToAim)[0];
    if (!fallback) {
      return emptyResult(`No Google Street View panos within ${MAX_PANO_DIST_M}m of the property.`);
    }
    const heading = fallback.bearingToAim;
    const url = buildHistoricalStaticUrl(fallback.panoId, heading, size, fov, DEFAULT_PITCH);
    return {
      current: url
        ? [{ heading: Math.round(heading), label: `Street View — front of subject (${heading.toFixed(0)}°)`, imageUrl: url }]
        : [],
      historicalSides: [],
      allFrames: [],
      source: 'Google Street View',
      failureReason: 'No dated Street View Car captures near this property — current view only, no historical timeline available.',
    };
  }

  // 4. Cluster dated panos by camera position. Most addresses → 1 cluster.
  //    Addresses where Google did multiple drives from different positions
  //    (e.g. one drive on the front street and one on a back alley) → 2+
  //    clusters.
  const rawClusters = clusterByPosition(usableDated, CLUSTER_RADIUS_M);

  // 5. Sort clusters by LATEST DATE in each cluster, descending. The cluster
  //    with the most recent capture is the most likely to be Google's
  //    current fronting drive — it's what shows up by default in
  //    maps.google.com when you open Street View at this address. For 6704
  //    SW 134 PL specifically: Google added a 2025 drive on the north curb
  //    that captures the front facade. The OLD 2008-2022 cluster on the
  //    south curb has more captures but doesn't see the front.
  const clusters = rawClusters.slice().sort((a, b) => {
    const aLatest = maxDate(a);
    const bLatest = maxDate(b);
    if (aLatest !== bLatest) return bLatest.localeCompare(aLatest);
    return b.length - a.length; // tie-break by size
  });

  // 6. For each cluster, build a THEN/NOW pair. Render EACH pano with its
  //    OWN per-pano bearing-to-aim — same camera position renders the same
  //    pano-relative geometry. Within a tight cluster (8m radius) per-pano
  //    bearings differ by <5°, so THEN and NOW look at the building from
  //    nearly identical angles. Across clusters they may differ — that's
  //    accurate, not a bug; the building is in every frame.
  const sides: StreetViewSidePair[] = [];
  const currentFrames: StreetViewImage[] = [];
  const allFrames: StreetViewHistoricalFrame[] = [];

  for (const [idx, cluster] of clusters.entries()) {
    cluster.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    const earliest = cluster[0];
    const latest = cluster[cluster.length - 1];

    const earliestHeading = bearingFromTo(earliest.panoLat, earliest.panoLng, opts.aimLat, opts.aimLng);
    const latestHeading = bearingFromTo(latest.panoLat, latest.panoLng, opts.aimLat, opts.aimLng);
    const sideLabel = idx === 0 ? 'Primary front' : `Side ${idx + 1}`;

    const nowUrl = buildHistoricalStaticUrl(latest.panoId, latestHeading, size, fov, DEFAULT_PITCH);
    const yearsApart = (latest.year ?? 0) - (earliest.year ?? 0);
    const thenUrl =
      yearsApart >= MIN_THEN_NOW_YEARS
        ? buildHistoricalStaticUrl(earliest.panoId, earliestHeading, size, fov, DEFAULT_PITCH)
        : null;

    // Primary cluster's NOW pano goes into the current frames list (this is
    // the canonical "current view of the front of the subject").
    if (idx === 0 && nowUrl) {
      currentFrames.push({
        heading: Math.round(latestHeading),
        label: `Street View — front of subject (${latestHeading.toFixed(0)}°, ${latest.date})`,
        imageUrl: nowUrl,
      });
    } else if (idx > 0 && nowUrl) {
      currentFrames.push({
        heading: Math.round(latestHeading),
        label: `Street View — ${sideLabel} (${latestHeading.toFixed(0)}°, ${latest.date})`,
        imageUrl: nowUrl,
      });
    }

    sides.push({
      sideLabel,
      approxBearingFromCenter: latestHeading,
      then:
        thenUrl && earliest.date && earliest.year
          ? {
              captureDate: `${earliest.date}-01T00:00:00Z`,
              captureYear: earliest.year,
              imageUrl: thenUrl,
              heading: Math.round(earliestHeading),
              label: `${sideLabel} — Then · ${earliest.date}`,
            }
          : null,
      now:
        nowUrl && latest.date && latest.year
          ? {
              captureDate: `${latest.date}-01T00:00:00Z`,
              captureYear: latest.year,
              imageUrl: nowUrl,
              heading: Math.round(latestHeading),
              label: `${sideLabel} — Now · ${latest.date}`,
            }
          : null,
    });

    // Track every dated pano in the cluster for completeness.
    for (const p of cluster) {
      const phead = bearingFromTo(p.panoLat, p.panoLng, opts.aimLat, opts.aimLng);
      const url = buildHistoricalStaticUrl(p.panoId, phead, size, fov, DEFAULT_PITCH);
      if (url && p.date && p.year) {
        allFrames.push({
          captureDate: `${p.date}-01T00:00:00Z`,
          captureYear: p.year,
          imageUrl: url,
          heading: Math.round(phead),
          label: `${sideLabel} · ${p.date}`,
        });
      }
    }
  }

  // 6. Determine failureReason for the historical pair. A successful pair
  //    requires AT LEAST one cluster with both a THEN and a NOW frame.
  const hasUsableSide = sides.some((s) => s.then && s.now);
  let failureReason: string | null = null;
  if (!hasUsableSide) {
    const onlyYear = sides[0]?.now?.captureYear ?? null;
    failureReason = onlyYear
      ? `Google Street View has only one dated capture span at this property (${onlyYear}) — no THEN frame to compare. Use the manual upload slot for a historical reference photo.`
      : 'Google Street View returned no dated captures near this property.';
  }

  return {
    current: currentFrames,
    historicalSides: sides,
    allFrames,
    source: 'Google Street View',
    failureReason,
  };
}

// Helpers
// ----------------------------------------------------------------------------

function emptyResult(failureReason: string): StreetViewEngineResult {
  return {
    current: [],
    historicalSides: [],
    allFrames: [],
    source: 'Google Street View',
    failureReason,
  };
}

// Group panos into clusters. Two panos within `radiusM` meters of each
// other land in the same cluster. Largest cluster (most panos) ranks first.
function clusterByPosition<T extends { panoLat: number; panoLng: number }>(
  items: T[],
  radiusM: number,
): T[][] {
  const groups: T[][] = [];
  for (const it of items) {
    const existing = groups.find((g) =>
      g.some((p) => haversineMeters(p.panoLat, p.panoLng, it.panoLat, it.panoLng) <= radiusM),
    );
    if (existing) existing.push(it);
    else groups.push([it]);
  }
  // No final sort here — caller sorts based on the criterion they care
  // about (size, latest date, etc.).
  return groups;
}

function maxDate<T extends { date?: string | null }>(items: T[]): string {
  let best = '';
  for (const it of items) {
    if (it.date && it.date > best) best = it.date;
  }
  return best;
}

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

function bearingFromTo(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(fromLat);
  const φ2 = toRad(toLat);
  const Δλ = toRad(toLng - fromLng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// ============================================================================
// BACKWARD-COMPAT SHIMS
// ============================================================================
// The orchestrator and other callers still import the old API. Provide thin
// wrappers so we can ship the engine rebuild without rewriting every caller.

// Old API: buildStreetViewUrlsTowardParcel(parcelLat, parcelLng, opts).
// Returns just the current frames. New engine handles current + historical
// in one call; if a caller only wants current, this wrapper hides the rest.
export async function buildStreetViewUrlsTowardParcel(
  parcelLat: number,
  parcelLng: number,
  opts?: { fov?: number; size?: { w: number; h: number } },
): Promise<StreetViewImage[]> {
  const result = await buildStreetViewEngine({
    searchLat: parcelLat,
    searchLng: parcelLng,
    aimLat: parcelLat,
    aimLng: parcelLng,
    fov: opts?.fov,
    size: opts?.size,
  });
  return result.current;
}

// Old API: getStreetViewMeta(lat, lng, radiusM). Documented metadata-only
// endpoint. Kept for code that still calls it; not used by the new engine.
export interface StreetViewMeta {
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

// Old API: hasStreetView(lat, lng). Boolean check used in a couple places.
export async function hasStreetView(lat: number, lng: number, radiusM = 50): Promise<boolean> {
  const meta = await getStreetViewMeta(lat, lng, radiusM);
  return meta.ok;
}
