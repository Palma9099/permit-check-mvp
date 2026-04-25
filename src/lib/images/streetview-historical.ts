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

export interface HistoricalStreetViewResult {
  then: HistoricalStreetViewFrame | null;
  now: HistoricalStreetViewFrame | null;
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

  const toFrame = (img: typeof m.then): HistoricalStreetViewFrame | null => {
    if (!img) return null;
    return {
      captureDate: img.capturedAt,
      captureYear: img.capturedYear,
      imageUrl: img.imageUrl,
      heading: Math.round(img.compassAngle),
      label: `Mapillary pano · ${img.capturedAt.slice(0, 10)} · facing ${Math.round(img.bearingToSubject)}°`,
    };
  };

  const allFrames = m.allFrames.map(toFrame).filter((f): f is HistoricalStreetViewFrame => f !== null);

  return {
    then: toFrame(m.then),
    now: toFrame(m.now),
    allFrames,
    source: m.source,
    failureReason: m.failureReason,
  };
}
