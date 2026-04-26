// Thin wrapper around the unified Street View engine.
//
// The engine in streetview.ts produces both current frames AND historical
// THEN/NOW pairs from one pano list. Some callers (the orchestrator's
// existing wiring, vision-compare, the report renderer) expect the
// historical pair as a separate result object. This file shapes the
// engine's output into that format.

import type { StreetViewImage } from '../types';
import { buildStreetViewEngine } from './streetview';

export interface HistoricalStreetViewFrame {
  captureDate: string;
  captureYear: number;
  imageUrl: string;
  heading: number;
  label: string;
}

export interface HistoricalStreetViewSidePair {
  sideLabel: string;
  approxBearingFromCenter: number;
  then: HistoricalStreetViewFrame | null;
  now: HistoricalStreetViewFrame | null;
}

export interface HistoricalStreetViewResult {
  then: HistoricalStreetViewFrame | null;
  now: HistoricalStreetViewFrame | null;
  sides: HistoricalStreetViewSidePair[];
  allFrames: HistoricalStreetViewFrame[];
  source: string | null;
  failureReason: string | null;
}

export async function fetchHistoricalStreetView(
  parcelLat: number,
  parcelLng: number,
  _currentImages: StreetViewImage[],
  aim?: { lat: number; lng: number },
): Promise<HistoricalStreetViewResult> {
  const result = await buildStreetViewEngine({
    searchLat: parcelLat,
    searchLng: parcelLng,
    aimLat: aim?.lat ?? parcelLat,
    aimLng: aim?.lng ?? parcelLng,
  });

  // Pick primary side (largest-cluster) for the back-compat singletons.
  const primary =
    result.historicalSides.find((s) => s.then && s.now) ??
    result.historicalSides[0] ??
    null;

  return {
    then: primary?.then ?? null,
    now: primary?.now ?? null,
    sides: result.historicalSides,
    allFrames: result.allFrames,
    source: result.source,
    failureReason: result.failureReason,
  };
}
