// City case and permit layers, by county and city.
//
// Florida counties mostly do not publish the cases that encumber a parcel:
// outside Miami-Dade the code authority is usually the city, and a county
// lien search that stops at the county line misses the half that matters.
// A handful of cities publish theirs as queryable layers. Those are here.
//
// Every entry was checked against the city's own GIS this session. A city that
// publishes nothing is simply absent, and its provider turns that into a named
// staff step rather than silence: not published is not the same as clear.
//
// Adding a city is one row. Each fetcher takes the county's parcel number and
// MUST throw when its source does not answer, so section() can mark it "could
// not be checked" instead of clear.

import { epochDay, queryLayer, sq, str } from '../arcgis';
import { cap, dt, type LienLine } from '../lien-types';

export interface CitySource {
  /** County key this city sits in. */
  county: string;
  /** City name as the county's own boundary layer spells it, upper case. */
  cityKey: string;
  /** How the city is written in the search. */
  label: string;
  codeCases?: (parcelId: string) => Promise<LienLine[]>;
  permits?: (parcelId: string) => Promise<LienLine[]>;
  codeSource?: string;
  permitSource?: string;
}

const EXPIRED = /expire/i;

// ---------------------------------------------------------------- Broward --

const FTL = 'https://gis.fortlauderdale.gov/arcgis/rest/services';
const FTL_PARCELS = `${FTL}/Accela/Accela/MapServer/2`;
const FTL_CODE_CASES = `${FTL}/CodeCaseTracker/CodeCase/MapServer/0`;
const FTL_PERMITS = `${FTL}/BuildingPermitTracker/BuildingPermitTracker/MapServer/0`;
const HWD_PERMITS_OPEN = 'https://maps.hollywoodfl.org/arcgis/rest/services/Accela_Permits_Map/MapServer/0';

// Fort Lauderdale keys its own layers on a parcel id that is the county folio
// without its leading two digits. Rather than compute that, the city's own
// parcel layer is asked, which also confirms the lot really is in the city.
async function ftlParcelId(folio: string): Promise<string | null> {
  const rows = await queryLayer(FTL_PARCELS, {
    where: `FOLIO=${sq(folio)}`,
    outFields: 'FOLIO,PARCELID',
    resultRecordCount: 1,
    label: 'ftl-parcel',
  });
  return str(rows[0]?.PARCELID) || null;
}

// A Fort Lauderdale permit status meaning the permit is finished and no longer
// encumbers the parcel. Anything else is reported as still open, which is the
// safe direction for a lien search: over-report, never miss.
const FTL_PERMIT_DONE = /^(complete|closed|void|withdrawn|purged|disapproved)/i;

const FORT_LAUDERDALE: CitySource = {
  county: 'broward',
  cityKey: 'FORT LAUDERDALE',
  label: 'Fort Lauderdale',
  codeSource: 'City of Fort Lauderdale Code Case Tracker (city GIS)',
  permitSource: 'City of Fort Lauderdale Building Permit Tracker (city GIS)',
  async codeCases(folio) {
    const pid = await ftlParcelId(folio);
    if (!pid) return [];
    const rows = await queryLayer(FTL_CODE_CASES, {
      where: `PARCELID=${sq(pid)} AND CASESTATUS='O'`,
      outFields: 'CASENUM,PARCELID,CASETYPE,CASESTATUS,INITDATE',
      resultRecordCount: 200,
      label: 'ftl-code',
    });
    return rows.map((r) => ({
      title: `Open city code case ${str(r.CASENUM) || 'number not shown'}`,
      detail: `${str(r.CASETYPE) ? cap(str(r.CASETYPE)) : 'Fort Lauderdale code case'}, opened ${dt(
        epochDay(r.INITDATE),
      )}. Still open with the city. Unpaid city fines can be recorded as a lien, so confirm the balance with Fort Lauderdale Code Compliance.`,
      tone: 'red' as const,
    }));
  },
  async permits(folio) {
    const pid = await ftlParcelId(folio);
    if (!pid) return [];
    const rows = await queryLayer(FTL_PERMITS, {
      where: `PARCELID=${sq(pid)}`,
      outFields: 'PERMITID,PERMITTYPE,PERMITSTAT,PERMITDESC,SUBMITDT,APPROVEDT,COSTATUS',
      resultRecordCount: 200,
      label: 'ftl-permits',
    });
    return rows
      .filter((r) => !FTL_PERMIT_DONE.test(str(r.PERMITSTAT)) && !/final co issued/i.test(str(r.COSTATUS)))
      .map((r) => {
        const stat = str(r.PERMITSTAT) || 'status not shown';
        const expired = EXPIRED.test(stat);
        const issued = epochDay(r.APPROVEDT) ?? epochDay(r.SUBMITDT);
        return {
          title: `${expired ? 'Expired' : 'Open'} city permit ${str(r.PERMITID)}`.trim(),
          detail: `${cap(str(r.PERMITDESC) || str(r.PERMITTYPE) || 'Permit')}. ${
            issued ? `Dated ${dt(issued)}. ` : ''
          }City shows "${stat}"${str(r.COSTATUS) ? `, ${str(r.COSTATUS)}` : ''}.`,
          tone: expired ? ('red' as const) : ('amber' as const),
        };
      });
  },
};

const HOLLYWOOD: CitySource = {
  county: 'broward',
  cityKey: 'HOLLYWOOD',
  label: 'Hollywood',
  permitSource: 'City of Hollywood Accela permits layer (city GIS)',
  async permits(folio) {
    const rows = await queryLayer(HWD_PERMITS_OPEN, {
      where: `FOLIO_NUMBER=${sq(folio)}`,
      outFields: 'RECORD_ID,RECORD_TYPE,RECORD_STATUS,STATUS,RECORD_OPEN_DATE,FOLIO_NUMBER',
      resultRecordCount: 200,
      label: 'hwd-permits',
    });
    return rows.map((r) => {
      const stat = str(r.RECORD_STATUS) || str(r.STATUS) || 'status not shown';
      const expired = EXPIRED.test(stat);
      return {
        title: `${expired ? 'Expired' : 'Open'} city permit ${str(r.RECORD_ID)}`.trim(),
        detail: `${str(r.RECORD_TYPE) || 'Permit'}. Opened ${dt(epochDay(r.RECORD_OPEN_DATE))}. City shows "${stat}".`,
        tone: expired ? ('red' as const) : ('amber' as const),
      };
    });
  },
};

// ------------------------------------------------------------- Miami-Dade --

const MIAMI_PERMITS =
  'https://services1.arcgis.com/CvuPhqcTQpZPT9qY/ArcGIS/rest/services/Building_Permits_Since_2014/FeatureServer/0';

// The city stores the folio as a NUMBER, so its leading zero is gone and it
// must be compared unquoted.
const folioAsNumber = (folio: string) => String(Number(folio.replace(/\D+/g, '')));

// 'Final' is the only status that means the permit is closed out. 'Hold' and
// 'Revoked' are worse than merely open, so they carry the same weight as an
// expired permit.
const MIAMI_BAD = /^(expired|revoked|hold)$/i;

const CITY_OF_MIAMI: CitySource = {
  county: 'miami-dade',
  cityKey: 'MIAMI',
  label: 'City of Miami',
  permitSource: 'City of Miami building permits (city open data, 2014 onward)',
  async permits(folio) {
    const n = folioAsNumber(folio);
    if (!n || n === '0' || n === 'NaN') return [];
    const rows = await queryLayer(MIAMI_PERMITS, {
      where: `FolioNumber=${n} AND BuildingPermitStatusDescription<>'Final'`,
      outFields:
        'PermitNumber,ApplicationNumber,FolioNumber,BuildingPermitStatusDescription,BuildingPermitStatusReasonDescription,IssuedDate,ScopeofWork,IsPermitFinal',
      resultRecordCount: 200,
      label: 'miami-permits',
    });
    return rows.map((r) => {
      const stat = str(r.BuildingPermitStatusDescription) || 'status not shown';
      const bad = MIAMI_BAD.test(stat);
      const reason = str(r.BuildingPermitStatusReasonDescription);
      const issued = epochDay(r.IssuedDate);
      return {
        title: `${bad ? stat : 'Open'} city permit ${str(r.PermitNumber) || str(r.ApplicationNumber)}`.trim(),
        detail: `${cap(str(r.ScopeofWork) || 'Permit')}. ${issued ? `Issued ${dt(issued)}. ` : ''}City shows "${stat}"${
          reason ? `: ${reason}` : ''
        }.`,
        tone: bad ? ('red' as const) : ('amber' as const),
      };
    });
  },
};

const ALL: CitySource[] = [FORT_LAUDERDALE, HOLLYWOOD, CITY_OF_MIAMI];

/**
 * The live city source for this parcel, or null when the city publishes none.
 * Null is a real answer: the caller must turn it into a named staff step, not
 * into silence.
 */
export function getCitySource(county: string, cityName: string | null): CitySource | null {
  if (!cityName) return null;
  const key = cityName.trim().toUpperCase();
  return ALL.find((c) => c.county === county && c.cityKey === key) ?? null;
}

/** Every city Palma pulls live, for the coverage copy and for tests. */
export const CITY_SOURCES = ALL;
