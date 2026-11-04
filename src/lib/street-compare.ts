// AI check on dated Street View photos of the front of a property.
//
// The browser finds the older Street View captures (Google only lists them to
// its web map tool), then sends their image addresses here. We look for front
// changes that aerial photos miss (windows, doors, garage enclosure, front
// additions, roof slope, fence). The dating logic lives in series-compare.ts.

import type { Permit } from './types';
import { compareSeries, type SeriesComparison, type SeriesFrame, type SeriesSpec } from './series-compare';

export type StreetFrameIn = SeriesFrame;
export type StreetComparison = SeriesComparison;

export const STREET_SPEC: SeriesSpec = {
  areas: ['Front windows', 'Front door', 'Garage / carport', 'Front addition', 'Roof (front)', 'Fence / gate', 'Driveway', 'Exterior finish'],
  intro:
    'You look at dated Street View photos of ONE house, numbered in date order, all taken from about the same street position. The subject house is the one centred in the photos.',
  reading: [
    'Older photos are smaller, hazier and differently lit. Haze, glare, shadow, a different sun angle or a lower-quality image is NOT a change. Colour shifts from lighting are NOT a change.',
    'Cars, people, bins, plants and trees growing or being trimmed are NOT changes. Look past them.',
  ],
  permitKinds: 'windows or doors replaced, garage enclosed, addition, roof replaced, new or replaced fence or wall, driveway rebuilt',
  where: 'Front',
};

export function compareStreetHistory(opts: {
  frames: StreetFrameIn[];
  permits: Array<Pick<Permit, 'issueDate' | 'appType' | 'scope'>>;
  yearBuilt: number | null;
  permitsUnknown?: boolean;
}): Promise<StreetComparison> {
  return compareSeries(STREET_SPEC, { frames: opts.frames.slice(0, 4), permits: opts.permits, yearBuilt: opts.yearBuilt, permitsUnknown: opts.permitsUnknown });
}
