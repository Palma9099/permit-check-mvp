// Broward lien provider.
//
// Broward is not Miami-Dade. The county publishes its tax roll and its parcel
// and municipality boundaries as public layers, but no code-case or lien layer:
// checked 2026-11-08 against the county's own ArcGIS organisation, 734 services,
// none of them a code, lien or permit case layer. The Official Records search
// and the Tax Collector both sit behind a bot wall.
//
// "Not in GIS" is not "not published", and an earlier version of this comment
// made exactly that mistake. Broward County DOES publish parcel-keyed code
// cases and permits - on Posse, at dpepp.broward.org/BCS, searchable by folio,
// with the recorded lien's CR number on each case (verified 2026-11-09). It is
// read by the deep-scan worker, not here, because it is a browser flow rather
// than a layer query; see worker/src/scrapers/broward.ts.
//
// It does not change what this file does, because its reach is small: county
// code enforcement covers unincorporated Broward, 16,888 of the county's
// 1,944,375 people, plus Unsafe Structure cases the county hears for cities
// under interlocal agreement. For nearly every Broward address the city is
// still the code authority, which is what the rest of this file is about.
//
// Broward is also about 90% incorporated across 31 municipalities, so the
// cases that encumber a parcel are usually the CITY's, not the county's. Two
// cities publish them live, and those are pulled here by parcel:
//
//   Fort Lauderdale  open code cases + building permits
//                    (gis.fortlauderdale.gov, its own ArcGIS server)
//   Hollywood        open and expired city permits
//                    (maps.hollywoodfl.org, Accela permits layer)
//
// For any other Broward city the city lien letter is a staff step naming that
// city, resolved from the county's municipality boundaries. A source that did
// not answer is reported as "could not be checked", never as clear, and a city
// Palma cannot pull is never reported as clear either: it is listed as work a
// person completes before delivery.

import { queryLayer, queryOneWithCentroid, sq, str } from '../arcgis';
import {
  cap,
  countTotals,
  section,
  type LienCoverage,
  type LienLine,
  type LienSearch,
  type StaffStep,
} from '../lien-types';
import { getCitySource, type CitySource } from './city-sources';

const BCPA_TAXROLL =
  'https://services.arcgis.com/JMAJrTsHNLrSsWf5/ArcGIS/rest/services/PARCEL_POLY_BCPA_TAXROLL/FeatureServer/0';
const CITY_BOUNDARIES =
  'https://services.arcgis.com/JMAJrTsHNLrSsWf5/ArcGIS/rest/services/Municipality_Boundaries_with_BMSD/FeatureServer/0';

// Broward folio: 12 digits, written 50-42-34-00-0030.
export const compactBrowardFolio = (f: string) => f.replace(/\D+/g, '').padStart(12, '0').slice(-12);
const pretty = (f: string) => `${f.slice(0, 2)}-${f.slice(2, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}-${f.slice(8)}`;

function coverageFor(pull: CitySource | null): LienCoverage {
  const automated = ['Parcel, owner and legal description, from the Broward County tax roll'];
  if (pull?.codeCases) automated.push(`Open ${pull.label} city code cases`);
  if (pull?.permits) automated.push(`Open and expired ${pull.label} city permits`);
  const byHand = [
    'Property taxes, delinquent years and tax certificates',
    'Official Records liens and releases against owner and parcel',
    'Water and sewer balance',
    'Broward County code cases and county permits',
  ];
  if (!pull?.codeCases) byHand.push('City code liens and city fines');
  if (!pull?.permits) byHand.push('City permits');
  return { level: pull ? 'cases' : 'records', automated, byHand };
}

async function cityNameAt(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const rows = await queryLayer(CITY_BOUNDARIES, {
    point: { lat, lng },
    outFields: 'CITYNAME',
    resultRecordCount: 1,
    label: 'broward-city',
  });
  // No city boundary contains the point. The query completed, so the parcel
  // is positively in unincorporated Broward.
  if (!rows.length) return null;
  const name = str(rows[0]?.CITYNAME);
  // Codex R2-01 was about the Census layer, but this is the same inversion in
  // Broward's own boundary layer, one file over, and fixing only the reported
  // site would be fixing the instance instead of the class. A matched boundary
  // with a blank CITYNAME says the point IS inside a city and will not say
  // which; returning null told the caller "unincorporated", which here drops
  // the city lien letter - the step most likely to hold up a closing.
  if (!name) {
    throw new Error('broward-city matched a boundary with no CITYNAME; jurisdiction not established');
  }
  return name;
}

const legalOf = (a: any) =>
  Array.from({ length: 14 }, (_, i) => str(a[`LEGAL_LINE_${i + 1}`]))
    .filter(Boolean)
    .join(', ') || null;

const situsOf = (a: any) => {
  const parts = [
    str(a.SITUS_STREET_NUMBER),
    str(a.SITUS_STREET_DIRECTION),
    str(a.SITUS_STREET_NAME),
    str(a.SITUS_STREET_TYPE),
    str(a.SITUS_STREET_POST_DIR),
    str(a.SITUS_UNIT_NUMBER) ? `# ${str(a.SITUS_UNIT_NUMBER)}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
};

const ownerOf = (a: any) =>
  [str(a.NAME_LINE_1), str(a.NAME_LINE_2)].filter(Boolean).join(' & ') || null;

const PARCEL_FIELDS = [
  'FOLIO_NUMBER', 'NAME_LINE_1', 'NAME_LINE_2', 'USE_TYPE',
  'SITUS_STREET_NUMBER', 'SITUS_STREET_DIRECTION', 'SITUS_STREET_NAME',
  'SITUS_STREET_TYPE', 'SITUS_STREET_POST_DIR', 'SITUS_UNIT_NUMBER',
  ...Array.from({ length: 14 }, (_, i) => `LEGAL_LINE_${i + 1}`),
].join(',');

/** The folio of the Broward lot under a map point, or null. */
export async function browardFolioAtPoint(lat: number, lng: number): Promise<string | null> {
  const rows = await queryLayer(BCPA_TAXROLL, {
    point: { lat, lng },
    outFields: 'FOLIO_NUMBER',
    resultRecordCount: 1,
    label: 'bcpa-point',
  });
  const f = str(rows[0]?.FOLIO_NUMBER);
  return f ? compactBrowardFolio(f) : null;
}

/** The city lines still standing, for the free property check. Throws when a
 *  source does not answer, so the caller never reports "none". */
export async function browardOpenLiens(folioIn: string): Promise<{ lines: LienLine[]; scope: string }> {
  const folio = compactBrowardFolio(folioIn);
  const parcel = await queryOneWithCentroid(BCPA_TAXROLL, {
    where: `FOLIO_NUMBER=${sq(folio)}`,
    outFields: 'FOLIO_NUMBER',
    label: 'bcpa-parcel',
  });
  if (!parcel) return { lines: [], scope: 'no Broward parcel matched' };
  const city = await cityNameAt(parcel.lat, parcel.lng);
  const pull = getCitySource('broward', city);
  if (!pull?.codeCases) {
    // Broward County publishes no case layer, and this city publishes none
    // either: nothing was checked, so nothing may be reported as clear.
    return { lines: [], scope: '' };
  }
  return { lines: await pull.codeCases(folio), scope: `open ${pull.label} city code cases` };
}

export async function runBrowardLienSearch(folioIn: string): Promise<LienSearch> {
  const folio = compactBrowardFolio(folioIn);

  const parcel = await queryOneWithCentroid(BCPA_TAXROLL, {
    where: `FOLIO_NUMBER=${sq(folio)}`,
    outFields: PARCEL_FIELDS,
    label: 'bcpa-parcel',
  }).catch(() => null);

  // A failed boundary lookup is NOT "unincorporated". Getting that wrong
  // would silently drop the city lien letter, which in Broward is most of the
  // search, so the two are tracked apart.
  const cityLookup = parcel
    ? await cityNameAt(parcel.lat, parcel.lng).then(
        (name) => ({ ok: true as const, name }),
        () => ({ ok: false as const, name: null }),
      )
    : { ok: false as const, name: null };
  const cityName = cityLookup.name;
  const pull = getCitySource('broward', cityName);
  const unincorporated = cityLookup.ok && (!cityName || /unincorporated|bmsd/i.test(cityName));
  const city = cityName ? cap(cityName) : 'the city';

  const [codeRes, permitRes] = await Promise.allSettled([
    pull?.codeCases ? pull.codeCases(folio) : Promise.resolve<LienLine[]>([]),
    pull?.permits ? pull.permits(folio) : Promise.resolve<LienLine[]>([]),
  ]);

  const sections = [];
  if (pull?.codeCases) {
    sections.push(
      section(
        'code',
        `Open ${pull.label} code cases`,
        pull.codeSource ?? `City of ${pull.label} code cases`,
        codeRes,
        `No open ${pull.label} code cases.`,
      ),
    );
  }
  if (pull?.permits) {
    sections.push(
      section(
        'permits',
        `Open and expired ${pull.label} permits`,
        pull.permitSource ?? `City of ${pull.label} permits`,
        permitRes,
        `No open or expired ${pull.label} permits.`,
      ),
    );
  }

  // Every Broward search carries the same staff steps; the ones a city layer
  // already answered are dropped.
  const staffSteps: StaffStep[] = [
    {
      key: 'taxes',
      title: 'Property taxes',
      how: 'Current-year bill, any delinquent years and tax certificates, from the Broward County Tax Collector. Behind a bot check, so a person opens it.',
      // Same vendor and same path as the Miami-Dade tax link already in use.
      url: `https://broward.county-taxes.com/public/search/property_tax?search_query=${folio}`,
    },
    {
      key: 'records',
      title: 'Official Records',
      how: 'Recorded liens and releases against the owner and parcel, from Broward County Records, Taxes and Treasury. Behind a bot check, so a person opens it.',
      url: 'https://officialrecords.broward.org/AcclaimWeb/',
    },
    { key: 'utilities', title: 'Water and sewer', how: unincorporated ? 'Open balance or lien from Broward County Water and Wastewater Services.' : `Open balance or lien from ${city}'s utility or Broward County Water and Wastewater Services.` },
    { key: 'countyCode', title: 'Broward County code and permits', how: 'Broward County Code Enforcement and county permits, searchable by folio at dpepp.broward.org/BCS. County code enforcement covers the unincorporated Broward Municipal Services District; for an address in a city the city is the code authority. A recorded county lien carries a CR number for Official Records, where the amount lives.', url: 'https://dpepp.broward.org/BCS/Default.aspx?PossePresentation=ParcelSearchForEnforcement' },
  ];
  if (!cityLookup.ok) {
    staffSteps.push({
      key: 'city',
      title: 'City lien letter',
      how: 'Which city this parcel sits in could not be determined just now, so the city is confirmed from the parcel record and the letter is requested from it. Broward County records do not cover city cases, and in Broward the city is usually the code authority.',
    });
  } else if (!unincorporated && !(pull?.codeCases && pull?.permits)) {
    const missing = [!pull?.codeCases ? 'code liens and fines' : null, !pull?.permits ? 'open and expired city permits' : null]
      .filter(Boolean)
      .join(', ');
    staffSteps.push({
      key: 'city',
      title: `${city} lien letter`,
      how: `${city} ${missing}, and city fees. Broward County records do not cover city cases, and ${city} publishes no parcel-keyed case data, so this is requested from the city.`,
    });
  }

  const a = parcel?.attributes ?? {};
  return {
    county: 'broward',
    countyName: 'Broward County',
    parcelLabel: 'Folio',
    coverage: coverageFor(pull),
    folio,
    prettyFolio: pretty(folio),
    address: situsOf(a),
    owner: ownerOf(a),
    legal: legalOf(a),
    municipality: cityName && !unincorporated ? cap(cityName) : null,
    unincorporated,
    searchedAt: new Date().toISOString(),
    sections,
    staffSteps,
    ...countTotals(sections),
  };
}
