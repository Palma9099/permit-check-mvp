// Historical Street View — Google sole source.
//
// Adrian's actual use case (FL residential due-diligence) needs Then-vs-Now
// Street View to catch facade changes that don't show up from above:
// repainted exterior, replaced front door, new perimeter gates, swapped
// windows. Aerial imagery misses all of these.
//
// We use Google Street View as the only source, both for historical and
// current panos. Google's FL coverage is dramatically better than the
// open-data alternatives (Mapillary, Bing Streetside), and using one
// provider means THEN and NOW frames are source-matched out of the box —
// same lens, same projection, same color profile. Comparison artifacts
// drop to zero.
//
// Pipeline:
//   1. GeoPhotoService.SingleImageSearch with the timeline flag returns
//      every dated pano at the parcel, often going back to 2007/2008 in
//      urban FL.
//   2. Anchor to the canonical fronting pano (the same one current-SV
//      uses) and filter dated panos to those co-located with it. This
//      keeps THEN and NOW on the same camera segment.
//   3. Render earliest + latest via the documented Static Street View API
//      with `pano=ID&heading=H`. Paid, licensed, fully legitimate use.
//   4. Quality gate: if the historical cluster heading is more than 60°
//      off from the current-SV heading, suppress entirely — that's the
//      sign Google's only dated coverage is on the wrong side of the lot
//      (privacy fence, cul-de-sac wrong-curb, etc.). Show an honest
//      "historical not available" line and let the realtor use the
//      manual upload slot for the THEN reference.
//
// We honestly return then=null + a failureReason when no usable pair is
// available — never fabricate a comparison.
//
// The vision-compare prompt knows to use these pairs specifically for
// facade/door/gate/paint/window changes, separate from the satellite-based
// roof/footprint/pool reasoning.

import type { StreetViewImage } from '../types';
import { getStreetViewMeta } from './streetview';
import {
  searchGooglePanoramas,
  clusterPanosBySide,
  pickThenNow,
  buildHistoricalStaticUrl,
  type GooglePano,
} from './google-historical';

export interface HistoricalStreetViewFrame {
  captureDate: string;
  captureYear: number;
  imageUrl: string;
  heading: number;
  label: string;
}

// One street's worth of historical Street View — for corner properties we
// emit multiple of these, one per fronting street.
export interface HistoricalStreetViewSidePair {
  sideLabel: string;
  approxBearingFromCenter: number;
  then: HistoricalStreetViewFrame | null;
  now: HistoricalStreetViewFrame | null;
}

export interface HistoricalStreetViewResult {
  // Back-compat singletons: the most informative side pair.
  then: HistoricalStreetViewFrame | null;
  now: HistoricalStreetViewFrame | null;
  // One pair per fronting street (1 for typical lot, 2+ for corners).
  sides: HistoricalStreetViewSidePair[];
  allFrames: HistoricalStreetViewFrame[];
  source: string | null;
  failureReason: string | null;
}

// Convert a Google pano into a renderable frame.
//
// HEADING: per-pano bearing-to-parcel jitters badly when the pano is right
// next to the parcel (≤10m) — a 1-2m drift between captures swings the
// bearing 20-30°, which at 90° FoV is enough to slide the subject out of
// frame in THEN while keeping it in NOW (or vice versa). Using ONE shared
// `clusterHeading` for every frame in the cluster gives consistent
// THEN-vs-NOW geometry: the subject sits at the same angular position in
// both, so the only thing that changes is the property itself.
//
// FOV: 110° instead of 90° gives ~9m horizontal coverage at 3m distance vs
// ~6m at 90°, so the whole front of a typical FL house fits in frame
// instead of just half.
function googlePanoToFrame(
  p: GooglePano,
  clusterHeading: number,
  sideLabel: string,
  role: 'then' | 'now',
): HistoricalStreetViewFrame | null {
  const url = buildHistoricalStaticUrl(p.panoId, clusterHeading, { w: 640, h: 480 }, 110);
  if (!url || !p.date || p.year == null) return null;
  const captureDate = `${p.date}-01T00:00:00Z`;
  const roleLabel = role === 'then' ? 'Then' : 'Now';
  return {
    captureDate,
    captureYear: p.year,
    imageUrl: url,
    heading: Math.round(clusterHeading),
    label: `${sideLabel} — ${roleLabel} · ${p.date}`,
  };
}

// Compute the canonical "look at the subject from the road" heading for a
// cluster. Approach: average the pano lat/lngs to get a centroid (which is
// roughly the road position in front of the parcel), then take the bearing
// from that centroid to the parcel center. Robust against per-pano
// position jitter.
function clusterHeadingFromCentroid(cluster: GooglePano[], parcelLat: number, parcelLng: number): number {
  if (cluster.length === 0) return 0;
  const cLat = cluster.reduce((s, p) => s + p.panoLat, 0) / cluster.length;
  const cLng = cluster.reduce((s, p) => s + p.panoLng, 0) / cluster.length;
  return bearingFromTo(cLat, cLng, parcelLat, parcelLng);
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

function angularDeltaDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lng2 - lng1);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function fetchGoogleHistorical(
  parcelLat: number,
  parcelLng: number,
): Promise<HistoricalStreetViewResult | null> {
  // Anchor: use the documented Street View metadata API to find the
  // canonical "best fronting" pano position. This is the pano the CURRENT
  // Street View block in the report uses, so anchoring historical timeline
  // frames to its position guarantees THEN/NOW render from the same camera
  // location and look at the same side of the property as current SV.
  //
  // For interior lots on cul-de-sacs (like 6704 SW 134 PL) Google's
  // SingleImageSearch returns pano clusters on BOTH sides of the parcel —
  // up the street and down the street — and the cluster-centroid heading
  // can land the camera looking through a fence at the back yard. The
  // anchor pano resolves that: only panos co-located with the anchor count.
  const anchorMeta = await getStreetViewMeta(parcelLat, parcelLng, 25);
  const anchorLat = anchorMeta.ok && anchorMeta.panoLat != null ? anchorMeta.panoLat : parcelLat;
  const anchorLng = anchorMeta.ok && anchorMeta.panoLng != null ? anchorMeta.panoLng : parcelLng;
  const haveAnchor = anchorMeta.ok && anchorMeta.panoLat != null;

  const panos = await searchGooglePanoramas(parcelLat, parcelLng);
  if (panos.length === 0) return null;

  // Filter to panos co-located with the anchor (≤ 10m). Tight radius is
  // intentional: a dated pano even 12-15m from the canonical fronting pano
  // is often on the OPPOSITE curb of the same street (6704 SW 134 PL is
  // the canonical failure mode — dated cluster sits 16m south of the
  // metadata-API anchor that's 14m north of parcel). Falls back to a 25m
  // parcel-center radius only if metadata API didn't return an anchor.
  const close = panos.filter((p) => {
    if (haveAnchor) {
      return haversineM(p.panoLat, p.panoLng, anchorLat, anchorLng) <= 10;
    }
    return p.distM <= 25;
  });
  if (close.length === 0) {
    return {
      then: null,
      now: null,
      sides: [],
      allFrames: [],
      source: 'Google Street View',
      failureReason: haveAnchor
        ? `Found ${panos.length} Google panos but none co-located (within 15m) of the canonical fronting pano at ${anchorLat.toFixed(5)},${anchorLng.toFixed(5)}.`
        : `Found ${panos.length} Google panos but none within 25m of the parcel.`,
    };
  }

  // Heading: bearing from the anchor pano to the parcel center. This is the
  // same heading the current SV block uses, so historical THEN/NOW frames
  // get rendered with the EXACT geometry as the current frame — same side
  // of the lot, same angle, same fence position, same view of the front.
  // (Each pano has a slightly different position but they're all within
  // 15m of the anchor, so the bearing-to-parcel from any of them is within
  // ~5° of this anchor heading — close enough for clean comparison.)
  const sharedHeading = bearingFromTo(anchorLat, anchorLng, parcelLat, parcelLng);

  // Cluster only for the rare corner lot where panos beyond 15m of the
  // anchor genuinely sit on a perpendicular fronting street. With our 15m
  // anchor filter we usually collapse to 1 cluster — that's correct for
  // 99% of FL residential lots.
  const clusters = clusterPanosBySide(close);

  // For each surviving cluster, pick best Then/Now pair (≥3 year span).
  const sidePairs: HistoricalStreetViewSidePair[] = [];
  const allFrames: HistoricalStreetViewFrame[] = [];

  clusters.forEach((cluster, idx) => {
    if (cluster.length === 0) return;
    const sideLabel = idx === 0 ? 'Primary front' : `Side ${idx + 1}`;
    const { then, now } = pickThenNow(cluster, 3);

    const thenFrame = then ? googlePanoToFrame(then, sharedHeading, sideLabel, 'then') : null;
    const nowFrame = now ? googlePanoToFrame(now, sharedHeading, sideLabel, 'now') : null;

    sidePairs.push({
      sideLabel,
      approxBearingFromCenter: sharedHeading,
      then: thenFrame,
      now: nowFrame,
    });

    // Add every dated pano in the cluster to allFrames for completeness.
    for (const p of cluster) {
      const f = googlePanoToFrame(p, sharedHeading, sideLabel, 'now');
      if (f) allFrames.push(f);
    }
  });

  // Pick the side with the longest then→now span as the back-compat primary.
  const sidesWithThen = sidePairs.filter((s) => s.then && s.now);
  let primary: HistoricalStreetViewSidePair | null = null;
  if (sidesWithThen.length > 0) {
    sidesWithThen.sort(
      (a, b) =>
        ((b.now?.captureYear ?? 0) - (b.then?.captureYear ?? 0)) -
        ((a.now?.captureYear ?? 0) - (a.then?.captureYear ?? 0)),
    );
    primary = sidesWithThen[0];
  } else {
    primary = sidePairs[0] ?? null;
  }

  if (!primary) {
    return {
      then: null,
      now: null,
      sides: sidePairs,
      allFrames,
      source: 'Google Street View',
      failureReason: 'No usable Google historical side after clustering.',
    };
  }

  if (!primary.then) {
    const onlyYear = primary.now?.captureYear ?? null;
    return {
      then: null,
      now: primary.now,
      sides: sidePairs,
      allFrames,
      source: 'Google Street View',
      failureReason: onlyYear
        ? `Google Street View has only one capture span at this parcel (${onlyYear}) — no THEN frame to compare. Use the manual upload slot for a historical reference photo.`
        : 'Google Street View returned no dated captures for this parcel.',
    };
  }

  return {
    then: primary.then,
    now: primary.now,
    sides: sidePairs,
    allFrames,
    source: 'Google Street View',
    failureReason: null,
  };
}

export async function fetchHistoricalStreetView(
  parcelLat: number,
  parcelLng: number,
  currentImages: StreetViewImage[],
): Promise<HistoricalStreetViewResult> {
  // Quality gate inputs: the heading the CURRENT Street View block uses to
  // frame the front of the subject. Historical THEN/NOW MUST land within
  // 60° of this heading or we're rendering the wrong side of the lot.
  const currentSvHeading: number | null =
    typeof currentImages?.[0]?.heading === 'number' ? currentImages[0].heading : null;

  // Google sole source. If Google can't produce a clean THEN/NOW pair (no
  // dated coverage, only a single capture, or the dated panos sit on the
  // wrong side of the lot), we return an honest failureReason and let the
  // realtor's manual photo upload fill in the THEN reference.
  const google = await fetchGoogleHistorical(parcelLat, parcelLng);

  if (!google) {
    return {
      then: null,
      now: null,
      sides: [],
      allFrames: [],
      source: 'Google Street View',
      failureReason: 'No Google Street View panos found for this parcel.',
    };
  }

  if (google.then && google.now) {
    // Quality gate: make sure the historical pair is actually looking at
    // the same SIDE of the parcel that the current SV looks at. For
    // interior lots on cul-de-sacs (6704 SW 134 PL is the canonical case)
    // Google's dated panos can sit on the opposite side of the parcel from
    // wherever the metadata API picked the canonical fronting pano. Same
    // heading from opposite sides = opposite views. Reject and surface
    // "no historical available" rather than show confusing back-of-lot
    // fence shots labeled THEN/NOW.
    const histHeading = google.sides[0]?.approxBearingFromCenter;
    if (
      currentSvHeading != null &&
      typeof histHeading === 'number' &&
      angularDeltaDeg(histHeading, currentSvHeading) > 60
    ) {
      const delta = Math.round(angularDeltaDeg(histHeading, currentSvHeading));
      console.log(
        `[historical-streetview] Google rejected: heading delta ${delta}° between current (${Math.round(currentSvHeading)}°) and historical (${Math.round(histHeading)}°) — wrong side of parcel`,
      );
      return {
        then: null,
        now: null,
        sides: [],
        allFrames: google.allFrames,
        source: 'Google Street View',
        failureReason: `Historical street-level captures at this address are at a different angle (${Math.round(histHeading)}°) than the current Street View (${Math.round(currentSvHeading)}°). Google Street View Car never captured this property's front facade — only the side or back. Use the manual upload slot for a historical reference photo.`,
      };
    }
    console.log(
      `[historical-streetview] Google succeeded: then=${google.then.captureYear} now=${google.now.captureYear} sides=${google.sides.length}`,
    );
    return google;
  }

  // Google found panos but couldn't produce a usable Then/Now pair (e.g.
  // only one dated capture). Pass through the honest failureReason; the
  // UI shows the line and the realtor can use the manual upload slot.
  console.log(
    `[historical-streetview] Google produced no Then/Now pair: ${google.failureReason ?? 'unknown'}`,
  );
  return google;
}
