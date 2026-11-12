/**
 * Generate src/lib/broward-code-offices.generated.ts from Broward County GIS.
 *
 *   npm run gen:broward-offices
 *
 * WHY THIS EXISTS. When a Broward parcel sits in a city this product cannot
 * read, the report said "ask the city directly" and stopped there: no name for
 * the office, no link, no phone. That is true and nearly useless. 24 of
 * Broward's 31 municipalities have no adapter, so that was most of the county.
 *
 * Broward publishes MunicipalCodeAppPts, 724,258 address points, each carrying
 * the code-enforcement office that covers it. Every one of the county's 31
 * municipalities appears, plus the unincorporated Broward Municipal Services
 * District. The contact fields are constant per municipality - 33 distinct
 * municipality values produce exactly 33 distinct contact combinations - so
 * this does not need a per-address lookup against 724k points. It needs a
 * 32-row table, which is what this script writes.
 *
 * WHAT IS DELIBERATELY LEFT OUT: the email. CODE_EMAIL is populated for all 32,
 * but roughly 18 of them are an individual staffer's mailbox (lhecht@,
 * TPalmieri@, Scott.Krajewski@, jmedina@ ...), which goes stale with staff
 * turnover and is not what belongs in a stranger's property report. One is
 * worse than stale: the Parkland row reads tracey_green@sherrif.org, and
 * sherrif.org is a real third-party domain (MX at rack-host.net) while Broward
 * Sheriff's Office is sheriff.org (MX at Outlook). Mail sent there leaves the
 * intended recipient entirely. A field that misroutes one in thirty-two
 * readers' complaints is not fit to publish, so the office NAME, its page and
 * its PHONE are published and the email is not.
 *
 * The page is a code-compliance DEPARTMENT page, not a case search. Those are
 * different things and this project has already shipped that confusion once -
 * Broward's registry "Code Enforcement" link pointed at a department homepage
 * - so the generated type names it `url` under `office` and never `portalUrl`.
 */
import { writeFileSync } from 'node:fs';

const LAYER =
  'https://services.arcgis.com/JMAJrTsHNLrSsWf5/arcgis/rest/services/MunicipalCodeAppPts/FeatureServer/0/query';

export interface BrowardOfficeRow {
  /** "broward:${MUNICIPALITY}", keyed the way the city registry keys rows. */
  key: string;
  /** The county's own name for the office, e.g. "City of Margate". */
  office: string;
  /** The office's code-compliance page. A department page, NOT a case search. */
  url: string | null;
  phone: string | null;
}

/** Strip the padding the county ships: "City of West Park " has a real space. */
const clean = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
};

/**
 * The appraiser-style municipality key for one address point.
 *
 * The key comes from the layer's own BOUNDARY city name, never from string
 * surgery on the legal office name, because the two genuinely disagree and
 * deriving the key would have silently lost two cities:
 *
 *   "Village of Lazy Lakes"         boundary LAZY LAKE          (not LAZY LAKES)
 *   "Town of Lauderdale-by-the-Sea" boundary LAUDERDALE BY THE SEA (no hyphens)
 *
 * A city whose key does not join simply never gets an office, forever, with
 * nothing failing - which is the quiet kind of wrong this project keeps
 * finding. The boundary name is also what the property appraiser reports, so
 * it is the spelling the city registry already keys on.
 *
 * "Broward Municipal Services District" is the unincorporated district, not a
 * municipality, and its boundary field reads "COUNTY REGIONAL FACILITY", which
 * is not a place name at all. It gets its own key: an unincorporated parcel has
 * no city and must never be keyed as though it did.
 */
export function municipalityKeyFor(office: string, boundaryCity: string | null): string | null {
  const name = office.trim();
  if (!name) return null;
  if (/^Broward Municipal Services District$/i.test(name)) return 'broward:UNINCORPORATED';
  const b = (boundaryCity ?? '').trim();
  if (!b) return null;
  return `broward:${b.toUpperCase()}`;
}

export function rowsFromFeatures(features: any[]): BrowardOfficeRow[] {
  const out = new Map<string, BrowardOfficeRow>();
  for (const f of features) {
    const a = f?.attributes ?? {};
    const office = clean(a.CODE_MUNICIPALITY);
    if (!office) continue;
    const key = municipalityKeyFor(office, clean(a.PTS_CITYNAME_BOUNDARY));
    if (!key) continue;
    const row: BrowardOfficeRow = {
      key,
      office,
      url: clean(a.CODE_WEBSITE),
      phone: clean(a.CODE_PHONE),
    };
    const prev = out.get(key);
    if (prev && (prev.url !== row.url || prev.phone !== row.phone)) {
      // The whole design rests on the contacts being constant per
      // municipality. If that ever stops being true, stop rather than pick.
      throw new Error(
        `${key} carries two different contacts: ${prev.phone}/${prev.url} vs ${row.phone}/${row.url}`,
      );
    }
    out.set(key, row);
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}

async function fetchDistinct(): Promise<any[]> {
  const u = new URL(LAYER);
  for (const [k, v] of Object.entries({
    where: '1=1',
    outFields: 'CODE_MUNICIPALITY,PTS_CITYNAME_BOUNDARY,CODE_WEBSITE,CODE_PHONE',
    returnDistinctValues: 'true',
    returnGeometry: 'false',
    resultRecordCount: '400',
    f: 'json',
  })) u.searchParams.set(k, v);

  const res = await fetch(u.toString(), { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: any = await res.json();
  if (data?.error) throw new Error(`arcgis-error ${data.error?.message ?? ''}`);
  if (!Array.isArray(data?.features)) throw new Error('response carried no features array');
  // A truncated distinct query would silently drop municipalities, which is
  // exactly the "half the county is missing and nobody noticed" failure.
  if (data.exceededTransferLimit === true) {
    throw new Error('distinct query was truncated; completeness not established');
  }
  return data.features;
}

async function main() {
  const features = await fetchDistinct();
  const rows = rowsFromFeatures(features);
  if (rows.length < 31) {
    throw new Error(`only ${rows.length} offices; Broward has 31 municipalities plus BMSD`);
  }
  const header = `// GENERATED FILE - DO NOT EDIT BY HAND.
//
// Source: Broward County GIS MunicipalCodeAppPts (the county's own per-address
// code-enforcement office directory), distinct on municipality.
// Regenerate: npm run gen:broward-offices
//
// 'url' is the office's code-compliance DEPARTMENT page, not a case search.
// The email the layer carries is deliberately not published - see
// scripts/gen-broward-code-offices.ts for why.
//
// tests/broward-code-offices.test.ts rebuilds this from a frozen capture of
// the layer and fails if the two have drifted, so a hand edit or a forgotten
// regenerate breaks CI rather than quietly misinforming a reader.

export interface BrowardOfficeRow {
  /** "broward:\${MUNICIPALITY}", keyed the way the city registry keys rows. */
  key: string;
  /** The county's own name for the office, e.g. "City of Margate". */
  office: string;
  /** The office's code-compliance page. A department page, NOT a case search. */
  url: string | null;
  phone: string | null;
}

export const BROWARD_CODE_OFFICES: BrowardOfficeRow[] = ${JSON.stringify(rows, null, 2)};
`;
  writeFileSync('src/lib/broward-code-offices.generated.ts', header);
  writeFileSync(
    'tests/fixtures/broward-code-offices-layer.json',
    JSON.stringify(
      {
        captured: new Date().toISOString().slice(0, 10),
        source: LAYER,
        note: 'Distinct municipality/website/phone from Broward MunicipalCodeAppPts. The drift test rebuilds the generated table from these features, so the generator and its output cannot disagree silently.',
        features,
      },
      null,
      2,
    ),
  );
  console.log(`wrote ${rows.length} Broward code offices`);
}

const invokedDirectly = /gen-broward-code-offices\.(ts|js)$/.test(process.argv[1] ?? '');
if (invokedDirectly) main().catch((e) => { console.error(e); process.exit(1); });
