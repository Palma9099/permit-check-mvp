/**
 * Phase 0, population half: what a COUNTY source can actually reach.
 *
 * A county code office governs the unincorporated area. Cities inside the
 * county run their own. So crediting a county tenant with county population
 * counts every city twice: once under the county, once under the city's own
 * adapter. The Accela survey credits Hillsborough County at 1,459,762, which
 * is the whole county including Tampa (384,959), routed separately.
 *
 * This prints, per county: 2020 population, the municipal population inside
 * it, and the remainder, which is what a county adapter reaches.
 *
 * Sources, both Census TIGERweb, Census 2020 vintage:
 *   counties  State_County/MapServer/55
 *   places    Places_CouSub_ConCity_SubMCD/MapServer/25  (26 is CDPs, which
 *             have no government; layer 4 is the CURRENT vintage used for
 *             "which city is this parcel in", a different question)
 *
 * Method and its error bound: each place is assigned to the county containing
 * its CENTROID, so a place straddling a county line lands wholly in one. Its
 * residents in the other county are then missing from that county's municipal
 * subtraction, which OVERSTATES that county's unincorporated figure, and the
 * assigned county is understated by the same people.
 *
 * Codex R2 caught an earlier version of this comment claiming straddlers were
 * reported when the code only reported places assigned to no county at all.
 * They are now actually detected, by testing each place's bounding-box corners
 * against the county polygons: a place whose box reaches into another county
 * is a CANDIDATE straddler. Boxes overshoot real shapes, so this over-reports
 * rather than under-reports, which is the right direction for an error bound.
 *
 * What this still does NOT give you is the SIZE of the error, because that
 * needs each place's population split by county part, which this source does
 * not carry. So the candidate list bounds WHICH counties could move, not by
 * how much. Ordering inside a near-tie (Alachua 108,824 / Indian River
 * 108,789 / Sumter 108,709, 35 and 115 apart) is not safe on this data alone.
 */

const TIGER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb';
const COUNTIES = `${TIGER}/State_County/MapServer/55/query`;
const PLACES = `${TIGER}/Places_CouSub_ConCity_SubMCD/MapServer/25/query`;
const FL = '12';

async function query(url: string, params: Record<string, string>) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  const data: any = await res.json();
  if (data?.error) throw new Error(`${url} ${JSON.stringify(data.error)}`);
  return data;
}

/** Even-odd ray cast over one ring of [x, y] pairs. */
function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Esri polygons are many rings; odd crossings count decides containment. */
function inPolygon(x: number, y: number, rings: number[][][]): boolean {
  let inside = false;
  for (const r of rings) if (inRing(x, y, r)) inside = !inside;
  return inside;
}

async function main() {
  const counties = await query(COUNTIES, {
    where: `STATE='${FL}'`,
    outFields: 'BASENAME,POP100,COUNTY',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  });

  const places = await query(PLACES, {
    where: `STATE='${FL}'`,
    outFields: 'BASENAME,POP100,CENTLAT,CENTLON,PLACE',
    // Geometry IS needed now, to detect straddlers. Heavily generalised,
    // because only the bounding box is used and a simplified ring gives the
    // same box to well under a parcel's width.
    returnGeometry: 'true',
    maxAllowableOffset: '0.002',
    outSR: '4326',
    f: 'json',
  });

  const cs = counties.features.map((f: any) => ({
    name: String(f.attributes.BASENAME),
    pop: Number(f.attributes.POP100 ?? 0),
    rings: (f.geometry?.rings ?? []) as number[][][],
    municipal: 0,
    places: [] as string[],
  }));

  let unassigned = 0;
  let municipalTotal = 0;
  const straddlers: Array<{ name: string; pop: number; counties: string[] }> = [];

  for (const p of places.features) {
    const a = p.attributes;
    const pop = Number(a.POP100 ?? 0);
    municipalTotal += pop;
    // TIGERweb ships these as strings with a leading + on latitude.
    const lat = Number(String(a.CENTLAT).replace('+', ''));
    const lng = Number(String(a.CENTLON).replace('+', ''));
    const hit = cs.find((c: any) => inPolygon(lng, lat, c.rings));
    if (!hit) { unassigned += pop; continue; }
    hit.municipal += pop;
    hit.places.push(String(a.BASENAME));

    // Candidate straddler: does this place's bounding box reach a county other
    // than the one holding its centroid?
    const rings: number[][][] = p.geometry?.rings ?? [];
    const xs: number[] = [], ys: number[] = [];
    for (const r of rings) for (const [x, y] of r) { xs.push(x); ys.push(y); }
    if (!xs.length) continue;
    const corners: Array<[number, number]> = [
      [Math.min(...xs), Math.min(...ys)], [Math.min(...xs), Math.max(...ys)],
      [Math.max(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)],
    ];
    const touched = new Set<string>([hit.name]);
    for (const [cx, cy] of corners) {
      const c = cs.find((q: any) => inPolygon(cx, cy, q.rings));
      if (c) touched.add(c.name);
    }
    if (touched.size > 1) {
      straddlers.push({ name: String(a.BASENAME), pop, counties: [...touched] });
    }
  }

  cs.sort((a: any, b: any) => (b.pop - b.municipal) - (a.pop - a.municipal));

  const n = (v: number) => v.toLocaleString('en-US');
  console.log('county                 total        municipal    UNINCORPORATED   cities');
  for (const c of cs) {
    const un = c.pop - c.municipal;
    console.log(
      `${c.name.padEnd(20)} ${n(c.pop).padStart(10)} ${n(c.municipal).padStart(12)} ${n(un).padStart(14)}   ${c.places.length}`,
    );
  }

  const totalPop = cs.reduce((s: number, c: any) => s + c.pop, 0);
  console.log('');
  console.log('Florida total          ', n(totalPop));
  console.log('municipal (412 places) ', n(municipalTotal));
  console.log('unincorporated         ', n(totalPop - municipalTotal));
  if (unassigned) console.log('UNASSIGNED place pop   ', n(unassigned), '(centroid fell in no county)');

  console.log('');
  console.log(`CANDIDATE STRADDLERS: ${straddlers.length} place(s) whose bounding box reaches more than one county.`);
  console.log('Each is counted wholly in its centroid county, so the OTHER counties listed are');
  console.log('overstated by that place\'s residents on their side of the line. Boxes overshoot,');
  console.log('so this list over-reports. It bounds WHICH counties can move, not by how much:');
  console.log('a per-county population split is not in this source.');
  for (const s2 of straddlers.sort((a, b) => b.pop - a.pop)) {
    console.log(`  ${s2.name.padEnd(24)} ${n(s2.pop).padStart(9)}   ${s2.counties.join(' / ')}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
