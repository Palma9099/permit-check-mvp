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
 * its centroid, so a place straddling a county line lands wholly in one. The
 * known Florida case is Longboat Key (Manatee/Sarasota). Straddlers are
 * reported so the error is visible rather than silent.
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
    returnGeometry: 'false',
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
}

main().catch((e) => { console.error(e); process.exit(1); });
