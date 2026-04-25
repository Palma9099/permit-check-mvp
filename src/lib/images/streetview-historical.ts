// Historical Street View — backed by Mapillary.
//
// Adrian's actual use case (FL residential due-diligence) needs Then-vs-Now
// Street View to catch facade changes that don't show up from above:
// repainted exterior, replaced front door, new perimeter gates, swapped
// windows. Aerial imagery misses all of these.
//
// Mapillary is the right source: free, documented, OAuth-token auth, returns
// historical street-level panos with capture dates. Coverage on FL residential
// streets is uneven (good on main roads, sparse on cul-de-sacs), so this
// module honestly returns null when no historical pair is available rather
// than fabricating a comparison.
//
// The vision-compare prompt knows to use this pair specifically for
// facade/door/gate/paint/window changes, separate from the satellite-based
// roof/footprint/pool reasoning.

import type { StreetViewImage } from '../types';
import { fetchMapillaryHistorical } from './mapillary';

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

export async function fetchHistoricalStreetView(
  parcelLat: number,
  parcelLng: number,
  _currentImages: StreetViewImage[],
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

  const allFrames = m.allFrames.map((f) => toFrame(f)).filter((f): f is HistoricalStreetViewFrame => f !== null);

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
