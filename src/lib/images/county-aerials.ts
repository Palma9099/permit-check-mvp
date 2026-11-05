// Miami-Dade County's own yearly aerial photos.
//
// The county publishes one aerial flight per year (2005 to the current year)
// on a public ArcGIS image server, most at 3 inches per pixel. The national
// NAIP photos we use elsewhere are 2 to 3 feet per pixel, too soft to tell a
// patio cover from a shadow, so for Miami-Dade these replace NAIP.
//
// Each year is its own ImageServer; exportImage returns a JPEG of any box.
// Older years (1999 to 2003) are black and white and are skipped.

import type { ParcelRing } from '../types';
import { displayBboxFor, type HistoricalAerialFrame, type HistoricalAerialResult } from './historical-aerial';

const BASE = 'https://imageserverintra.miamidade.gov/arcgis/rest/services';

// Service name per flight year, oldest first. Pixel size noted where it is
// coarser than 3 inches.
const YEARS: Array<{ year: number; service: string; inches: number }> = [
  { year: 2005, service: 'Woolpert2005', inches: 12 },
  { year: 2006, service: 'Woolpert2006', inches: 12 },
  { year: 2007, service: 'Woolpert2007', inches: 3 },
  { year: 2008, service: 'AerialsExpress2008', inches: 20 },
  { year: 2009, service: 'PhotoScience2009', inches: 12 },
  { year: 2010, service: 'Woolpert2010', inches: 3 },
  { year: 2012, service: 'Orthos2012', inches: 12 },
  { year: 2013, service: 'Aca2013', inches: 3 },
  { year: 2014, service: 'Aca2014', inches: 3 },
  { year: 2015, service: 'Sanborn2015', inches: 12 },
  { year: 2016, service: 'Pictometry2016', inches: 3 },
  { year: 2017, service: 'Kucera2017', inches: 3 },
  { year: 2018, service: 'GPI2018', inches: 3 },
  { year: 2019, service: 'GPI2019', inches: 3 },
  { year: 2020, service: 'Woolpert2020', inches: 3 },
  { year: 2021, service: 'Woolpert2021', inches: 3 },
  { year: 2022, service: 'Woolpert2022', inches: 3 },
  { year: 2023, service: 'Woolpert2023', inches: 3 },
  { year: 2024, service: 'Woolpert2024', inches: 3 },
  { year: 2025, service: 'Woolpert2025', inches: 3 },
  { year: 2026, service: 'Woolpert2026', inches: 3 },
];

// Newest county flight, for single-photo uses like the Verified page.
export const LATEST_COUNTY_SERVICE = YEARS[YEARS.length - 1].service;

export const COUNTY_AERIAL_SOURCE = 'Miami-Dade County yearly aerial photography';

export function countyExportUrl(service: string, b: { lon1: number; lat1: number; lon2: number; lat2: number }, px = 768): string {
  const q = new URLSearchParams({
    bbox: `${b.lon1},${b.lat1},${b.lon2},${b.lat2}`,
    bboxSR: '4326',
    imageSR: '3857',
    size: `${px},${px}`,
    bandIds: '0,1,2',
    format: 'jpg',
    f: 'image',
  });
  return `${BASE}/${service}/ImageServer/exportImage?${q.toString()}`;
}

// Is the newest flight reachable? One cheap metadata call, so a county outage
// falls back to NAIP instead of showing broken images.
async function serverUp(service: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/${service}/ImageServer?f=json`, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    if (!res.ok) return false;
    const j: any = await res.json();
    return !j?.error;
  } catch {
    return false;
  }
}

export async function fetchCountyAerials(lat: number, lng: number, polygon?: ParcelRing | null): Promise<HistoricalAerialResult> {
  const latest = YEARS[YEARS.length - 1];
  if (!(await serverUp(latest.service))) {
    return { then: null, now: null, allFrames: [], source: COUNTY_AERIAL_SOURCE, failureReason: 'Miami-Dade aerial server did not answer.' };
  }
  const disp = displayBboxFor(lat, lng, polygon);
  const allFrames: HistoricalAerialFrame[] = YEARS.map((y) => {
    const url = countyExportUrl(y.service, disp);
    return {
      captureDate: `${y.year}-01-01T00:00:00Z`,
      captureYear: y.year,
      itemId: y.service,
      imageUrl: url,
      gsdMeters: (y.inches * 0.0254),
      displayImageUrl: url,
      displayBbox: disp,
    };
  });
  return { then: allFrames[0], now: allFrames[allFrames.length - 1], allFrames, source: COUNTY_AERIAL_SOURCE, failureReason: null };
}

// Pick up to `n` frames spread across the years for the AI, always keeping the
// oldest and newest, and preferring the sharp 3-inch flights in between. Starts
// the year after the house was built, so construction is not read as a change.
export function spreadFrames<T extends { captureYear: number; gsdMeters?: number }>(all: T[], n = 5, fromYear?: number | null): T[] {
  const pool = all.filter((f) => !fromYear || f.captureYear >= fromYear + 1);
  const use = pool.length >= 2 ? pool : all;
  if (use.length <= n) return use;
  const first = use[0];
  const last = use[use.length - 1];
  const picked = [first];
  for (let k = 1; k < n - 1; k++) {
    const target = first.captureYear + ((last.captureYear - first.captureYear) * k) / (n - 1);
    const best = use
      .filter((f) => !picked.includes(f) && f !== last)
      .sort((a, b) => Math.abs(a.captureYear - target) + (a.gsdMeters ?? 1) * 4 - (Math.abs(b.captureYear - target) + (b.gsdMeters ?? 1) * 4))[0];
    if (best) picked.push(best);
  }
  picked.push(last);
  return picked.sort((a, b) => a.captureYear - b.captureYear);
}
