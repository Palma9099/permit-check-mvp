// Historical Street View — deferred.
//
// Shipping status: NOT wired into the AI vision call. The Planetary Computer
// NAIP integration gives us a rock-solid Then-vs-Now for the satellite side;
// adding a historical Street View source correctly requires picking between:
//
//   (a) Google's internal photometa endpoint (the one the Google Maps frontend
//       uses when you click the little clock icon). Returns a JSON blob with
//       historical panos and capture dates. Problems: undocumented, pb-param
//       protobuf format changes without notice, arguably violates Google TOS
//       for commercial scraping, no stable contract.
//
//   (b) Mapillary API. Documented, free, Meta-owned. Historical panos with
//       capture dates. Florida residential coverage is uneven — solid on
//       main roads, sparse on quiet cul-de-sacs. Requires MAPILLARY_TOKEN
//       env var.
//
//   (c) Accept "current-only" for the AI call and keep the existing Google
//       Street View timeline click-through link in the UI so the realtor
//       can eyeball history themselves.
//
// For now we ship (c). This file is the hook for a future (b) implementation.

import type { StreetViewImage } from '../types';

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

// Placeholder — returns an empty result with a human-readable note so the
// orchestrator and report render cleanly until Mapillary is wired in.
export async function fetchHistoricalStreetView(
  _lat: number,
  _lng: number,
  _currentImages: StreetViewImage[],
): Promise<HistoricalStreetViewResult> {
  return {
    then: null,
    now: null,
    allFrames: [],
    source: null,
    failureReason:
      'Street View historical panos are not yet wired into the AI comparison. Use the Street View timeline link below to review past panos manually.',
  };
}
