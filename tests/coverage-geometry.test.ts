// Codex R3-01. The straddler detector sampled a place's four bounding-box
// corners and claimed that could only over-report. It cannot: a county can
// cross the box interior without containing any corner, and the first version
// reported ZERO straddlers on a case that genuinely overlapped.
//
// A bounding box being a superset of the shape does not make corner sampling
// an intersection test. That was the reasoning error. These tests pin the
// counterexample so the shortcut cannot come back.

import { describe, it, expect } from 'vitest';
import {
  boxIntersectsPolygon,
  segmentsIntersect,
  pointInPolygon,
  ringsBox,
  type Ring,
} from '../scripts/geo.js';

/** Codex's counterexample, verbatim. County A has a notch; B fills it. */
const COUNTY_A: Ring[] = [[[0, 0], [10, 0], [10, 4], [6, 4], [6, 6], [10, 6], [10, 10], [0, 10], [0, 0]]];
const COUNTY_B: Ring[] = [[[6, 4], [10, 4], [10, 6], [6, 6], [6, 4]]];
/** A place whose centroid is in A and which genuinely overlaps B. */
const PLACE = { minx: 2, miny: 2, maxx: 8, maxy: 8 };

describe('the counterexample that disproved corner sampling', () => {
  it('has no place corner inside the notch county', () => {
    const corners = [
      [PLACE.minx, PLACE.miny], [PLACE.minx, PLACE.maxy],
      [PLACE.maxx, PLACE.miny], [PLACE.maxx, PLACE.maxy],
    ];
    // This is exactly why the old test passed while being wrong.
    for (const [x, y] of corners) expect(pointInPolygon(x, y, COUNTY_B)).toBe(false);
    expect(pointInPolygon(5, 5, COUNTY_B)).toBe(false);
  });

  it('is still detected as an intersection', () => {
    expect(boxIntersectsPolygon(PLACE, COUNTY_B)).toBe(true);
  });

  it('still sees the county the centroid sits in', () => {
    expect(boxIntersectsPolygon(PLACE, COUNTY_A)).toBe(true);
    expect(pointInPolygon(5, 5, COUNTY_A)).toBe(true);
  });
});

describe('box against polygon, the three ways they can meet', () => {
  const square: Ring[] = [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]];

  it('a polygon vertex inside the box', () => {
    expect(boxIntersectsPolygon({ minx: 3, miny: 3, maxx: 9, maxy: 9 }, square)).toBe(true);
  });

  it('an edge crossing with no vertex or corner inside', () => {
    // A thin band straight through the square: no square vertex is in the
    // band, and no band corner is in the square.
    const band = { minx: -5, miny: 1, maxx: 9, maxy: 3 };
    for (const [x, y] of square[0]) {
      const inBand = x >= band.minx && x <= band.maxx && y >= band.miny && y <= band.maxy;
      expect(inBand).toBe(false);
    }
    for (const [cx, cy] of [[band.minx, band.miny], [band.minx, band.maxy], [band.maxx, band.miny], [band.maxx, band.maxy]]) {
      expect(pointInPolygon(cx, cy, square)).toBe(false);
    }
    expect(boxIntersectsPolygon(band, square)).toBe(true);
  });

  it('a box entirely swallowed by the polygon', () => {
    expect(boxIntersectsPolygon({ minx: 1, miny: 1, maxx: 2, maxy: 2 }, square)).toBe(true);
  });

  it('says no when they genuinely do not meet', () => {
    expect(boxIntersectsPolygon({ minx: 20, miny: 20, maxx: 30, maxy: 30 }, square)).toBe(false);
  });

  it('counts a shared edge as meeting, erring toward over-reporting', () => {
    expect(boxIntersectsPolygon({ minx: 4, miny: 0, maxx: 8, maxy: 4 }, square)).toBe(true);
  });
});

describe('segment intersection', () => {
  it('finds a plain crossing', () => {
    expect(segmentsIntersect(0, 0, 4, 4, 0, 4, 4, 0)).toBe(true);
  });
  it('rejects parallel segments', () => {
    expect(segmentsIntersect(0, 0, 4, 0, 0, 1, 4, 1)).toBe(false);
  });
  it('accepts a touching endpoint', () => {
    expect(segmentsIntersect(0, 0, 4, 0, 4, 0, 4, 4)).toBe(true);
  });
  it('accepts collinear overlap', () => {
    expect(segmentsIntersect(0, 0, 4, 0, 2, 0, 6, 0)).toBe(true);
  });
});

describe('ringsBox', () => {
  it('bounds every ring, not just the first', () => {
    expect(ringsBox([[[0, 0], [1, 1]], [[-3, 2], [5, -4]]])).toEqual({ minx: -3, miny: -4, maxx: 5, maxy: 2 });
  });
  it('returns null for no points', () => {
    expect(ringsBox([])).toBeNull();
  });
});
