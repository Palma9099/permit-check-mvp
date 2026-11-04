// AI check on Miami-Dade's yearly county aerials (3 inches per pixel), the
// view from above that shows what the street cannot: rear additions, pools,
// patio covers, screen enclosures, sheds and the whole roof. Same dating logic
// as the Street View check (series-compare.ts).

import type { Permit, VisualComparison } from './types';
import { MODEL } from './vision-compare';
import { compareSeries, type SeriesSpec } from './series-compare';
import type { HistoricalAerialFrame } from './images/historical-aerial';

export const AERIAL_SPEC: SeriesSpec = {
  areas: ['Roof', 'Rear addition', 'Pool', 'Patio / cover', 'Screen enclosure', 'Shed / detached', 'Fence', 'Driveway', 'Solar'],
  intro:
    'You look at dated aerial photos of ONE property, taken straight down, numbered in date order. The first image (not numbered) is today\'s satellite photo with the subject lot outlined in red; each numbered photo is centred on that same lot, so the subject lot is the one in the middle. Judge only what is inside that lot.',
  reading: [
    'The photos come from different flights. Small shifts in position, scale, sun angle, shadows, haze and colour balance are NOT changes.',
    'Trees and shrubs growing or being cut, cars, boats, trampolines, furniture and water colour are NOT changes.',
    'A roof counts as changed only if its material or pattern clearly changes (for example tile to shingle, or a clearly new, even surface replacing a weathered one), not if only its shade differs.',
    'A structure counts as new only if it is clearly absent in the earlier photo and clearly present in the later one.',
  ],
  permitKinds: 'roof replaced, addition or enclosed space, pool, patio cover or carport, screen enclosure, shed, new fence or wall, driveway rebuilt, solar panels',
  where: 'Yard and roof',
};

export async function compareCountyAerials(opts: {
  frames: HistoricalAerialFrame[];
  keyImageUrl: string | null;
  // No surveyed lot line was found; the red box is centred on the address.
  outlineApprox?: boolean;
  permits: Permit[];
  yearBuilt: number | null;
  permitsUnknown?: boolean;
}): Promise<VisualComparison> {
  const res = await compareSeries(AERIAL_SPEC, {
    frames: opts.frames.map((f) => ({ imageUrl: f.imageUrl, label: String(f.captureYear) })),
    permits: opts.permits,
    yearBuilt: opts.yearBuilt,
    permitsUnknown: opts.permitsUnknown,
    keyImage: opts.keyImageUrl
      ? {
          imageUrl: opts.keyImageUrl,
          text: opts.outlineApprox
            ? "Key image: today's satellite photo. The red box is only centred on the address (no surveyed lot line), so judge the one house in the middle and its own yard."
            : "Key image: today's satellite photo, subject lot outlined in red. Use it only to find the lot in the numbered photos.",
        }
      : null,
  });
  return {
    performed: res.performed,
    modelUsed: MODEL,
    summary: res.performed ? res.summary : 'Aerial comparison did not run.',
    observations: res.observations,
    failureReason: res.failureReason,
    thenCaptureDate: opts.frames[0]?.captureDate ?? null,
    nowCaptureDate: opts.frames[opts.frames.length - 1]?.captureDate ?? null,
    runsAgreed: res.runsAgreed,
  };
}
