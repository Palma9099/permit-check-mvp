// Plane geometry for the coverage measurement, kept in its own module with NO
// side effects so a test can import it without running the script's main().
//
// Codex R3-01: the first version sampled a place's four bounding-box corners
// against each county and claimed that could only over-report. It cannot. A
// county can cross the box interior without containing any corner, and the
// counterexample is a notch: county A shaped (0,0),(10,0),(10,4),(6,4),(6,6),
// (10,6),(10,10),(0,10) with county B filling [6,10]x[4,6], and a place box
// [2,8]x[2,8] whose centroid is in A. The place genuinely overlaps B over
// [6,8]x[4,6], and not one of its corners is in B. The old code reported zero
// straddlers.
//
// A bounding box being a superset of the shape does NOT make corner sampling
// an intersection test. That was the reasoning error, and it is the second
// time a claimed guarantee here was not implemented.

export type Ring = number[][];
export interface Box { minx: number; miny: number; maxx: number; maxy: number }

/** Even-odd ray cast over one ring of [x, y] pairs. */
export function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Esri polygons are many rings; odd crossings decide containment. */
export function pointInPolygon(x: number, y: number, rings: Ring[]): boolean {
  let inside = false;
  for (const r of rings) if (pointInRing(x, y, r)) inside = !inside;
  return inside;
}

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  Math.sign((by - ay) * (cx - bx) - (bx - ax) * (cy - by));

const onSeg = (ax: number, ay: number, bx: number, by: number, px: number, py: number) =>
  Math.min(ax, bx) <= px && px <= Math.max(ax, bx) &&
  Math.min(ay, by) <= py && py <= Math.max(ay, by);

/** Do segments AB and CD touch or cross? Collinear overlap counts. */
export function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSeg(ax, ay, bx, by, cx, cy)) return true;
  if (o2 === 0 && onSeg(ax, ay, bx, by, dx, dy)) return true;
  if (o3 === 0 && onSeg(cx, cy, dx, dy, ax, ay)) return true;
  if (o4 === 0 && onSeg(cx, cy, dx, dy, bx, by)) return true;
  return false;
}

/**
 * Does an axis-aligned box intersect a polygon? Complete for simple polygons.
 *
 * Three ways they can meet, and all three are needed. Checking only the last
 * one, as the corner version effectively did, misses a polygon that pokes
 * through the box without reaching a corner.
 *
 *   1. a polygon vertex lies inside the box
 *   2. a polygon edge crosses a box edge
 *   3. a box corner lies inside the polygon (covers the box being swallowed)
 */
export function boxIntersectsPolygon(box: Box, rings: Ring[]): boolean {
  const inBox = (x: number, y: number) =>
    x >= box.minx && x <= box.maxx && y >= box.miny && y <= box.maxy;

  for (const ring of rings) {
    for (const [x, y] of ring) if (inBox(x, y)) return true;
  }

  const edges: Array<[number, number, number, number]> = [
    [box.minx, box.miny, box.maxx, box.miny],
    [box.maxx, box.miny, box.maxx, box.maxy],
    [box.maxx, box.maxy, box.minx, box.maxy],
    [box.minx, box.maxy, box.minx, box.miny],
  ];
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j];
      const [x2, y2] = ring[i];
      for (const [ex1, ey1, ex2, ey2] of edges) {
        if (segmentsIntersect(x1, y1, x2, y2, ex1, ey1, ex2, ey2)) return true;
      }
    }
  }

  for (const [cx, cy] of [
    [box.minx, box.miny], [box.minx, box.maxy],
    [box.maxx, box.miny], [box.maxx, box.maxy],
  ]) {
    if (pointInPolygon(cx, cy, rings)) return true;
  }

  return false;
}

/** The bounding box of a set of rings, or null when there are no points. */
export function ringsBox(rings: Ring[]): Box | null {
  const xs: number[] = [], ys: number[] = [];
  for (const r of rings) for (const [x, y] of r) { xs.push(x); ys.push(y); }
  if (!xs.length) return null;
  return { minx: Math.min(...xs), miny: Math.min(...ys), maxx: Math.max(...xs), maxy: Math.max(...ys) };
}
