// A stand-in for the county and city ArcGIS layers the lien providers query.
//
// Every provider talks to ArcGIS over plain fetch, so the honest way to test
// them is to answer that fetch. Routes are matched on a substring of the URL,
// which is how the providers themselves are addressed: one layer per source.
//
// Two behaviours are deliberate, because they are the ones the product rules
// turn on:
//   - `errorBody` answers HTTP 200 with an {error} payload, which is what
//     ArcGIS really does for a layer that needs a token. A provider that reads
//     that as "no rows" would report a locked source as clear.
//   - An unrouted URL fails loudly rather than returning [], so a test can
//     never pass because a provider quietly asked for nothing.

export interface Route {
  /** Substring of the request URL this route answers. */
  match: string;
  /** Attribute rows to return. */
  rows?: any[];
  /** Polygon centroid, for a parcel lookup with returnCentroid. */
  centroid?: { lat: number; lng: number };
  /** Answer 200 with an ArcGIS {error} body. */
  errorBody?: { code: number; message: string };
  /** Answer a plain HTTP failure. */
  status?: number;
  /** Make fetch itself throw, the way a dropped connection does. */
  throws?: string;
  /** An arbitrary body, for a source that is not a feature layer (the
   *  Miami-Dade Property Appraiser proxy answers its own shape). */
  json?: unknown;
}

export interface ArcgisStub {
  urls: string[];
  routes: Route[];
  restore: () => void;
}

export function installArcgisStub(routes: Route[]): ArcgisStub {
  const real = globalThis.fetch;
  const stub: ArcgisStub = {
    urls: [],
    routes,
    restore: () => {
      globalThis.fetch = real;
    },
  };

  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    stub.urls.push(url);
    const r = stub.routes.find((x) => url.includes(x.match));
    if (!r) throw new Error(`arcgis-stub: no route for ${url}`);
    if (r.throws) throw new TypeError(r.throws);
    if (r.status) return new Response('upstream said no', { status: r.status });
    if (r.errorBody) return Response.json({ error: r.errorBody });
    if (r.json !== undefined) return Response.json(r.json);
    return Response.json({
      features: (r.rows ?? []).map((attributes) => ({
        attributes,
        ...(r.centroid ? { centroid: { x: r.centroid.lng, y: r.centroid.lat } } : {}),
      })),
    });
  }) as any;

  return stub;
}

// The Broward layers, by the part of their URL the providers hit.
export const BCPA = 'PARCEL_POLY_BCPA_TAXROLL';
export const BROWARD_CITIES = 'Municipality_Boundaries_with_BMSD';
export const FTL_PARCELS = 'Accela/Accela/MapServer/2';
export const FTL_CODE = 'CodeCaseTracker/CodeCase/MapServer/0';
export const FTL_PERMITS = 'BuildingPermitTracker';
export const HWD_PERMITS = 'Accela_Permits_Map/MapServer/0';
export const CENSUS_PLACES = 'tigerweb.geo.census.gov';
export const FDOR = 'Florida_Statewide_Cadastral';

// Miami-Dade, by the part of the URL each source is reached at.
export const MD_PA = 'apps.miamidadepa.gov';
export const MD_ARCGIS = '8Pc9XBTAsYuxx9Ny';
export const MD_PERMIT_LAYER = 'gisweb.miamidade.gov';
export const MIAMI_CITY_PERMITS = 'Building_Permits_Since_2014';

/** The Property Appraiser proxy's answer for one folio. */
export const mdPaRecord = (municipality: string) => ({
  PropertyInfo: { Municipality: municipality },
  SiteAddress: [{ Address: '123 TEST ST' }],
  OwnerInfos: [{ Name: 'TEST OWNER' }],
  LegalDescription: { Description: 'TEST SUB LOT 1' },
});

/** One Broward tax-roll row, in the shape the layer really returns. */
export const bcpaRow = (over: Record<string, any> = {}) => ({
  FOLIO_NUMBER: '504217080010',
  NAME_LINE_1: 'TORRES,JUANA',
  NAME_LINE_2: 'PEREZ,WALTER ENRIQUE',
  SITUS_STREET_NUMBER: '1400',
  SITUS_STREET_DIRECTION: 'SW',
  SITUS_STREET_NAME: '29',
  SITUS_STREET_TYPE: 'TER',
  LEGAL_LINE_1: 'CHULA VISTA 4TH ADD 34-6 B',
  USE_TYPE: '01',
  ...over,
});
