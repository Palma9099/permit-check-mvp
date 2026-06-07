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

import type { ParcelRing, StreetViewImage } from '../types';
import {
  searchGooglePanoramasMulti,
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
const CLUSTER_RADIUS_M = 5;         // panos within 5m of cluster centroid = same cluster.
                                    // Tight enough that bridge panos can't drift the centroid
                                    // across the parcel (e.g. south curb to north curb is ~28m,
                                    // requires multiple sub-5m centroid steps which only happen
                                    // when there's actually a continuous capture from one side
                                    // to the other — i.e. a real drive that should cluster).
const MIN_THEN_NOW_YEARS = 3;       // require ≥3yr span for a real THEN/NOW

// Public API: build the entire Street View block — current + historical —
// from one unified pipeline.
export async function buildStreetViewEngine(opts: {
  searchLat: number;
  searchLng: number;
  aimLat: number;
  aimLng: number;
  // When provided, headings are computed perpendicular to the nearest
  // polygon edge pointing INTO the polygon — that's "look at the building
  // from the road" rather than "look at the polygon centroid." For typical
  // FL residential lots where the house sits a few feet inside one of the
  // shorter polygon edges, this matches what Google Maps does when you
  // click into Street View at the address.
  aimPolygon?: ParcelRing | null;
  fov?: number;
  size?: { w: number; h: number };
}): Promise<StreetViewEngineResult> {
  const fov = opts.fov ?? DEFAULT_FOV;
  const size = opts.size ?? { w: 640, h: 480 };

  // 1. Pull every pano Google has near the parcel. Google's pano search is
  //    sensitive to the query coordinate: for a set-back house the rooftop
  //    geocode lands deep in the lot, and a search from there can return a
  //    pano cluster with NO dated captures while the dated curb captures sit
  //    a few meters away. So we query several points and union by panoId:
  //      - the geocode (where the address resolved)
  //      - the aim/centroid (building center)
  //      - the midpoint of the parcel edge nearest the building (a road-facing
  //        point, present when we have a real polygon)
  //    Distances/bearings in the merged set are normalized to the aim point.
  const searchPoints: Array<{ lat: number; lng: number }> = [
    { lat: opts.searchLat, lng: opts.searchLng },
    { lat: opts.aimLat, lng: opts.aimLng },
  ];
  if (opts.aimPolygon && opts.aimPolygon.length >= 3) {
    const edgeMid = nearestEdgeMidpoint(opts.aimPolygon, opts.aimLat, opts.aimLng);
    if (edgeMid) searchPoints.push(edgeMid);
  }
  const allPanos = await searchGooglePanoramasMulti(searchPoints, opts.aimLat, opts.aimLng);
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

  // 3. Keep only DATED Street View Car captures within 30m of aim. We
  //    don't try to filter by which polygon edge they face — that turned
  //    out to be too brittle when Google rooftop geocodes land INSIDE the
  //    polygon (ambiguous "front edge"). Instead the engine relies on:
  //      a. Centroid-based clustering with a tight 5m radius so bridge
  //         panos can't merge the south curb and the north curb into one
  //         drifty cluster.
  //      b. Closest-cluster-to-aim primary selection so the front-facing
  //         road wins when multiple distinct clusters exist.
  //      c. Per-pano perpendicular-to-nearest-polygon-edge heading so each
  //         frame points the camera at the building from wherever the
  //         camera actually was.
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

  // 5. Sort clusters by DISTANCE FROM CLUSTER CENTROID TO THE AIM POINT,
  //    ascending. The closest cluster to the address is the one Google
  //    Maps points to by default when you click into Street View at the
  //    address. Address-closest is the front-facing road cluster for the
  //    typical FL residential lot — that's the realtor's mental model.
  //
  //    For 6704 SW 134 PL: south cluster centroid is ~14m from the polygon
  //    centroid (front curb on SW 134 PL), north cluster is ~25m (a recent
  //    drive on the back/side road). South wins primary even though north
  //    has a 2025 capture — south has the front view AND historical
  //    captures going back to 2008.
  const clusters = rawClusters.slice().sort((a, b) => {
    const aDist = clusterDistanceToPoint(a, opts.aimLat, opts.aimLng);
    const bDist = clusterDistanceToPoint(b, opts.aimLat, opts.aimLng);
    if (aDist !== bDist) return aDist - bDist;
    // Tie-break: more recent capture, then more captures.
    const dateCompare = maxDate(b).localeCompare(maxDate(a));
    if (dateCompare !== 0) return dateCompare;
    return b.length - a.length;
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

    const earliestHeading = bearingToBuilding(
      earliest.panoLat, earliest.panoLng,
      opts.aimPolygon ?? null, opts.aimLat, opts.aimLng,
    );
    const latestHeading = bearingToBuilding(
      latest.panoLat, latest.panoLng,
      opts.aimPolygon ?? null, opts.aimLat, opts.aimLng,
    );
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
      const phead = bearingToBuilding(p.panoLat, p.panoLng, opts.aimPolygon ?? null, opts.aimLat, opts.aimLng);
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
// CENTROID-based clustering — each pano joins the cluster whose CENTROID
// is closest, but only if within `radiusM`. Otherwise it starts a new
// cluster.
//
// We deliberately don't use single-link (chaining) clustering here. With
// chaining, bridge panos at intermediate positions can merge two clusters
// that are physically far apart — e.g. for 6704 SW 134 PL the south curb
// pano cluster (front-of-house) and the north curb 2025 pano (back/side)
// are 28m apart, but a bridge capture along the perimeter merged them
// into one cluster, and the resulting "average view" pointed the camera
// at the back of the lot. Centroid-based prevents that: a pano 28m from
// an existing cluster's centroid starts a new cluster.
function clusterByPosition<T extends { panoLat: number; panoLng: number }>(
  items: T[],
  radiusM: number,
): T[][] {
  type Bucket = { items: T[]; cLat: number; cLng: number };
  const buckets: Bucket[] = [];
  for (const it of items) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      const d = haversineMeters(b.cLat, b.cLng, it.panoLat, it.panoLng);
      if (d <= radiusM && d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) {
      buckets.push({ items: [it], cLat: it.panoLat, cLng: it.panoLng });
    } else {
      const b = buckets[bestIdx];
      b.items.push(it);
      const n = b.items.length;
      b.cLat = (b.cLat * (n - 1) + it.panoLat) / n;
      b.cLng = (b.cLng * (n - 1) + it.panoLng) / n;
    }
  }
  // No final sort here — caller sorts based on the criterion they care
  // about (closest-to-aim, latest date, etc.).
  return buckets.map((b) => b.items);
}

function maxDate<T extends { date?: string | null }>(items: T[]): string {
  let best = '';
  for (const it of items) {
    if (it.date && it.date > best) best = it.date;
  }
  return best;
}

function clusterDistanceToPoint<T extends { panoLat: number; panoLng: number }>(
  cluster: T[],
  lat: number,
  lng: number,
): number {
  if (cluster.length === 0) return Infinity;
  const cLat = cluster.reduce((s, p) => s + p.panoLat, 0) / cluster.length;
  const cLng = cluster.reduce((s, p) => s + p.panoLng, 0) / cluster.length;
  return haversineMeters(cLat, cLng, lat, lng);
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

function angularDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Compute the heading from a pano position TOWARD the building inside a
// parcel polygon. The building isn't necessarily at the polygon centroid
// — typical FL lots have the house set close to one edge with deeper yard
// behind. Aiming at centroid points the camera at empty yard.
//
// Approach: find the polygon edge nearest to the pano (that's the lot's
// road-facing edge for any pano on the road). The heading we want is
// PERPENDICULAR to that edge, pointing INTO the polygon (away from the
// pano). For 6704 SW 134 PL this produces ~268° from the south curb pano,
// matching Google Maps' default Street View heading of 263°.
//
// Falls back to the simple bearing-to-aim when no polygon is available
// (synthetic-fallback parcels in counties without a real GIS layer).
function bearingToBuilding(
  panoLat: number,
  panoLng: number,
  polygon: ParcelRing | null,
  fallbackAimLat: number,
  fallbackAimLng: number,
): number {
  if (!polygon || polygon.length < 3) {
    return bearingFromTo(panoLat, panoLng, fallbackAimLat, fallbackAimLng);
  }
  // Find the polygon edge nearest to the pano.
  let bestDist = Infinity;
  let bestFrom: [number, number] | null = null;
  let bestTo: [number, number] | null = null;
  for (let i = 0; i < polygon.length - 1; i++) {
    const from = polygon[i];
    const to = polygon[i + 1];
    const d = distancePointToSegmentMeters(panoLat, panoLng, from[0], from[1], to[0], to[1]);
    if (d < bestDist) {
      bestDist = d;
      bestFrom = from;
      bestTo = to;
    }
  }
  if (!bestFrom || !bestTo) {
    return bearingFromTo(panoLat, panoLng, fallbackAimLat, fallbackAimLng);
  }
  // Edge direction.
  const edgeBearing = bearingFromTo(bestFrom[0], bestFrom[1], bestTo[0], bestTo[1]);
  // Two perpendiculars; pick the one that points toward the edge midpoint
  // (i.e., into the polygon, away from where the pano sits).
  const perp1 = (edgeBearing + 90) % 360;
  const perp2 = (edgeBearing - 90 + 360) % 360;
  const midLat = (bestFrom[0] + bestTo[0]) / 2;
  const midLng = (bestFrom[1] + bestTo[1]) / 2;
  const panoToMid = bearingFromTo(panoLat, panoLng, midLat, midLng);
  return angularDelta(perp1, panoToMid) <= angularDelta(perp2, panoToMid) ? perp1 : perp2;
}

// Midpoint of the polygon edge nearest a given point. Used as an extra
// pano-search query point: for a typical FL lot the edge nearest the building
// centroid is the road-facing (or a side) edge, which sits much closer to
// where the Street View car drove than the rooftop geocode does. Searching
// from here surfaces dated curb captures that a rooftop-only search misses.
function nearestEdgeMidpoint(
  polygon: ParcelRing,
  lat: number,
  lng: number,
): { lat: number; lng: number } | null {
  if (!polygon || polygon.length < 3) return null;
  let bestDist = Infinity;
  let best: { lat: number; lng: number } | null = null;
  for (let i = 0; i < polygon.length - 1; i++) {
    const from = polygon[i];
    const to = polygon[i + 1];
    const d = distancePointToSegmentMeters(lat, lng, from[0], from[1], to[0], to[1]);
    if (d < bestDist) {
      bestDist = d;
      best = { lat: (from[0] + to[0]) / 2, lng: (from[1] + to[1]) / 2 };
    }
  }
  return best;
}

// Find the bearing of the polygon edge nearest to a given point.
// Used to determine "which side" of the parcel a pano (or the geocode)
// is on — the front edge for a residential address is the edge nearest
// the geocode point.
function findNearestEdgeBearing(
  polygon: ParcelRing,
  lat: number,
  lng: number,
): number | null {
  if (!polygon || polygon.length < 3) return null;
  let bestDist = Infinity;
  let bestBearing = 0;
  for (let i = 0; i < polygon.length - 1; i++) {
    const from = polygon[i];
    const to = polygon[i + 1];
    const d = distancePointToSegmentMeters(lat, lng, from[0], from[1], to[0], to[1]);
    if (d < bestDist) {
      bestDist = d;
      bestBearing = bearingFromTo(from[0], from[1], to[0], to[1]);
    }
  }
  return bestBearing;
}

// Two edge bearings represent the SAME side of a polygon if their
// orientations (mod 180°) are within tolerance. An edge running N-S has
// bearing ~0° or ~180° depending on direction; both represent the same
// side, so we compare modulo 180°.
function isSameEdgeOrientation(a: number, b: number, toleranceDeg = 35): boolean {
  const aMod = ((a % 180) + 180) % 180;
  const bMod = ((b % 180) + 180) % 180;
  const delta = Math.abs(aMod - bMod);
  return Math.min(delta, 180 - delta) <= toleranceDeg;
}

// Distance from a point to a line segment, in meters. Uses an
// equirectangular local projection centered at the point — accurate to
// sub-meter at parcel-scale distances in FL.
function distancePointToSegmentMeters(
  pLat: number, pLng: number,
  aLat: number, aLng: number,
  bLat: number, bLng: number,
): number {
  const cosLat = Math.cos((pLat * Math.PI) / 180);
  const ax = (aLng - pLng) * 111_320 * cosLat;
  const ay = (aLat - pLat) * 111_320;
  const bx = (bLng - pLng) * 111_320 * cosLat;
  const by = (bLat - pLat) * 111_320;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt(ax * ax + ay * ay);
  const t = Math.max(0, Math.min(1, -((ax * dx) + (ay * dy)) / lenSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.sqrt(projX * projX + projY * projY);
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
