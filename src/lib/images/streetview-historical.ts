// Historical Street View — Google primary, Mapillary fallback.
//
// Adrian's actual use case (FL residential due-diligence) needs Then-vs-Now
// Street View to catch facade changes that don't show up from above:
// repainted exterior, replaced front door, new perimeter gates, swapped
// windows. Aerial imagery misses all of these.
//
// SOURCE PRIORITY:
//   1. Google Street View historical — call GeoPhotoService.SingleImageSearch
//      with the timeline flag set to get all panos at the parcel (often goes
//      back to 2007/2008 in urban FL). Render the earliest + latest via
//      Static Street View API. THIS IS THE PRIMARY SOURCE because Google's
//      coverage on FL residential streets is dramatically better than
//      Mapillary's.
//
//   2. Mapillary — open data, Meta-owned, free OAuth token. Falls back when
//      Google has nothing for the parcel (rare on FL residential, common in
//      gated communities or unbuilt areas). Coverage is uneven on FL
//      residential streets but it's worth a shot.
//
// We honestly return then=null + a failureReason when no historical pair is
// available — never fabricate a comparison.
//
// The vision-compare prompt knows to use these pairs specifically for
// facade/door/gate/paint/window changes, separate from the satellite-based
// roof/footprint/pool reasoning.

import type { StreetViewImage } from '../types';
import { fetchMapillaryHistorical } from './mapillary';
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

// Convert a Google pano into a renderable frame. We render with `pano=ID`
// looking from the pano position toward the parcel center, which puts the
// subject in the middle of the frame.
function googlePanoToFrame(p: GooglePano, sideLabel: string, role: 'then' | 'now'): HistoricalStreetViewFrame | null {
  const url = buildHistoricalStaticUrl(p.panoId, p.bearingToSubject);
  if (!url || !p.date || p.year == null) return null;
  const captureDate = `${p.date}-01T00:00:00Z`;
  const roleLabel = role === 'then' ? 'Then' : 'Now';
  return {
    captureDate,
    captureYear: p.year,
    imageUrl: url,
    heading: Math.round(p.bearingToSubject),
    label: `${sideLabel} — ${roleLabel} · ${p.date}`,
  };
}

async function fetchGoogleHistorical(
  parcelLat: number,
  parcelLng: number,
): Promise<HistoricalStreetViewResult | null> {
  const panos = await searchGooglePanoramas(parcelLat, parcelLng);
  if (panos.length === 0) return null;

  // Drop panos absurdly far from the parcel (>60m). At FL residential lot
  // scale, panos beyond that are usually around the corner / on the wrong
  // street.
  const close = panos.filter((p) => p.distM <= 60);
  if (close.length === 0) {
    return {
      then: null,
      now: null,
      sides: [],
      allFrames: [],
      source: 'Google Street View',
      failureReason: `Found ${panos.length} Google panos but none within 60m of the parcel.`,
    };
  }

  // Cluster by approach bearing. Interior lots collapse to 1 cluster;
  // corner lots keep 2.
  const clusters = clusterPanosBySide(close);

  // For each cluster, pick best Then/Now pair (≥3 year span).
  const sidePairs: HistoricalStreetViewSidePair[] = [];
  let allFrames: HistoricalStreetViewFrame[] = [];

  clusters.forEach((cluster, idx) => {
    if (cluster.length === 0) return;
    const sideLabel = idx === 0 ? 'Primary front' : `Side ${idx + 1}`;
    const { then, now } = pickThenNow(cluster, 3);

    const thenFrame = then ? googlePanoToFrame(then, sideLabel, 'then') : null;
    const nowFrame = now ? googlePanoToFrame(now, sideLabel, 'now') : null;

    sidePairs.push({
      sideLabel,
      approxBearingFromCenter: cluster[0].bearingToSubject,
      then: thenFrame,
      now: nowFrame,
    });

    // Add every dated pano in the cluster to allFrames for completeness.
    for (const p of cluster) {
      const f = googlePanoToFrame(p, sideLabel, 'now');
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
        ? `Google Street View has only one capture span at this parcel (${onlyYear}) — no THEN frame to compare. Try Mapillary fallback.`
        : 'Google Street View returned no dated captures.',
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

async function fetchMapillaryFallback(
  parcelLat: number,
  parcelLng: number,
): Promise<HistoricalStreetViewResult> {
  const m = await fetchMapillaryHistorical(parcelLat, parcelLng);

  const toFrame = (img: typeof m.then, sideLabel?: string): HistoricalStreetViewFrame | null => {
    if (!img) return null;
    return {
      captureDate: img.capturedAt,
      captureYear: img.capturedYear,
      imageUrl: img.imageUrl,
      heading: Math.round(img.compassAngle),
      label: sideLabel
        ? `${sideLabel} · ${img.capturedAt.slice(0, 10)}`
        : `Mapillary pano · ${img.capturedAt.slice(0, 10)} · facing ${Math.round(img.bearingToSubject)}°`,
    };
  };

  const allFrames = m.allFrames
    .map((f) => toFrame(f))
    .filter((f): f is HistoricalStreetViewFrame => f !== null);

  const sides = m.sides.map((s): HistoricalStreetViewSidePair => ({
    sideLabel: s.sideLabel,
    approxBearingFromCenter: s.approxBearingFromCenter,
    then: toFrame(s.then, `${s.sideLabel} — Then`),
    now: toFrame(s.now, `${s.sideLabel} — Now`),
  }));

  return {
    then: toFrame(m.then, 'Primary front — Then'),
    now: toFrame(m.now, 'Primary front — Now'),
    sides,
    allFrames,
    source: m.source,
    failureReason: m.failureReason,
  };
}

export async function fetchHistoricalStreetView(
  parcelLat: number,
  parcelLng: number,
  _currentImages: StreetViewImage[],
): Promise<HistoricalStreetViewResult> {
  // Try Google first. If we get a real Then/Now pair, ship it — Google
  // coverage in FL is the better source. If Google has nothing or only one
  // capture, fall back to Mapillary.
  const google = await fetchGoogleHistorical(parcelLat, parcelLng);
  if (google && google.then && google.now) {
    console.log(
      `[historical-streetview] Google succeeded: then=${google.then.captureYear} now=${google.now.captureYear} sides=${google.sides.length}`,
    );
    return google;
  }

  console.log(
    `[historical-streetview] Google insufficient (${google?.failureReason ?? 'no result'}), falling back to Mapillary`,
  );
  const mapillary = await fetchMapillaryFallback(parcelLat, parcelLng);
  if (mapillary.then && mapillary.now) {
    console.log(
      `[historical-streetview] Mapillary succeeded: then=${mapillary.then.captureYear} now=${mapillary.now.captureYear}`,
    );
    return mapillary;
  }

  // Neither source produced a real pair. Prefer the Google result for its
  // failureReason (more accurate), but include Mapillary's allFrames if any.
  const failureReason = google?.failureReason ?? mapillary.failureReason ?? 'No historical Street View available for this parcel.';
  return {
    then: null,
    now: google?.now ?? mapillary.now,
    sides: (google?.sides ?? []).length > 0 ? (google!.sides) : mapillary.sides,
    allFrames: [...(google?.allFrames ?? []), ...mapillary.allFrames],
    source: google?.source ?? mapillary.source,
    failureReason,
  };
}
