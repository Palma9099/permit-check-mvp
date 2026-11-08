// Lien coverage outside Miami-Dade.
//
// The product's one promise is that a source nobody checked is never reported
// as clear. Going from one county to sixty-seven multiplies the ways to break
// that promise, so these tests pin the distinctions rather than the wording:
// "nothing found" and "nothing checked" are different answers; "not in a city"
// and "could not tell which city" are different answers; and a parcel number
// that matches in the wrong county is not a match at all.

import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { getLienProvider, lienCounties, openLiens, runLienSearch } from '@/lib/lien-search';
import {
  BCPA,
  BROWARD_CITIES,
  CENSUS_PLACES,
  FDOR,
  FTL_CODE,
  FTL_PARCELS,
  FTL_PERMITS,
  HWD_PERMITS,
  bcpaRow,
  installArcgisStub,
  MD_ARCGIS,
  MD_PA,
  MD_PERMIT_LAYER,
  mdPaRecord,
  MIAMI_CITY_PERMITS,
  type ArcgisStub,
} from './arcgis-stub';

let stub: ArcgisStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

// The first matching route wins, the way the real layers are addressed, so an
// override has to REPLACE the empty default rather than sit behind it.
const inFortLauderdale = (over: Record<string, any> = {}) => {
  const base = [
    { match: BCPA, rows: [bcpaRow()], centroid: { lat: 26.1, lng: -80.16 } },
    { match: BROWARD_CITIES, rows: [{ CITYNAME: 'FORT LAUDERDALE' }] },
    { match: FTL_PARCELS, rows: [{ FOLIO: '504217080010', PARCELID: '0217080010' }] },
    { match: FTL_CODE, rows: [] as any[] },
    { match: FTL_PERMITS, rows: [] as any[] },
  ];
  return base.map((r) => (over[r.match] ? { match: r.match, ...over[r.match] } : r));
};

describe('which counties can be searched', () => {
  it('covers every Florida county, not just the ones that publish cases', () => {
    const all = lienCounties();
    expect(all.length).toBe(67);
    expect(all.every((c) => c.name.length > 0)).toBe(true);
  });

  it('marks only the counties whose own GIS publishes cases as case-level', () => {
    expect(getLienProvider('miami-dade')?.level).toBe('cases');
    expect(getLienProvider('broward')?.level).toBe('cases');
    // Palm Beach publishes no parcel-keyed case layer, so it must not claim to.
    expect(getLienProvider('palm-beach')?.level).toBe('records');
    expect(getLienProvider('monroe')?.level).toBe('records');
  });

  it('refuses a county it has never heard of instead of guessing', () => {
    expect(getLienProvider('fulton')).toBeNull();
    expect(getLienProvider('')).toBeNull();
    expect(getLienProvider(null)).toBeNull();
  });
});

describe('the free report only claims what a live source answered', () => {
  it('returns null for a county with no live lien source, which is not "no liens"', async () => {
    // No fetch is stubbed on purpose: a records-level county must not reach
    // for a source at all, so any request here would be the bug.
    const got = await openLiens('123456789012', 'palm-beach');
    expect(got).toBeNull();
  });

  it('returns null in a Broward city whose cases are not published', async () => {
    stub = installArcgisStub([
      { match: BCPA, rows: [bcpaRow()], centroid: { lat: 26.0, lng: -80.2 } },
      { match: BROWARD_CITIES, rows: [{ CITYNAME: 'PEMBROKE PINES' }] },
    ]);
    // Pembroke Pines publishes nothing, so nothing was checked. Null, so the
    // card does not render, rather than an empty list that reads as clear.
    expect(await openLiens('504217080010', 'broward')).toBeNull();
  });

  it('names what it checked when it does answer, so a partial check cannot read as a sweep', async () => {
    stub = installArcgisStub(
      inFortLauderdale({
        [FTL_CODE]: { rows: [{ CASENUM: 'CE24-0001', PARCELID: '0217080010', CASESTATUS: 'O', INITDATE: 1700000000000 }] },
      }),
    );
    const got = await openLiens('504217080010', 'broward');
    expect(got).not.toBeNull();
    expect(got!.scope).toMatch(/fort lauderdale/i);
    expect(got!.lines).toHaveLength(1);
    expect(got!.lines[0].tone).toBe('red');
  });

  it('throws when a live source is reachable but fails, rather than reporting none', async () => {
    stub = installArcgisStub([
      { match: BCPA, rows: [bcpaRow()], centroid: { lat: 26.1, lng: -80.16 } },
      { match: BROWARD_CITIES, rows: [{ CITYNAME: 'FORT LAUDERDALE' }] },
      { match: FTL_PARCELS, rows: [{ FOLIO: '504217080010', PARCELID: '0217080010' }] },
      // The real failure mode: HTTP 200 with an ArcGIS error body.
      { match: FTL_CODE, errorBody: { code: 499, message: 'Token Required' } },
    ]);
    await expect(openLiens('504217080010', 'broward')).rejects.toThrow(/token required/i);
  });
});

describe('a Broward search', () => {
  it('pulls the city cases it can and reports a finding as a finding', async () => {
    stub = installArcgisStub(
      inFortLauderdale({
        [FTL_CODE]: { rows: [{ CASENUM: 'CE24-0001', PARCELID: '0217080010', CASESTATUS: 'O', INITDATE: 1700000000000 }] },
        [FTL_PERMITS]: {
          rows: [{ PERMITID: 'B23-1234', PERMITTYPE: 'Roofing', PERMITSTAT: 'Expired', APPROVEDT: 1690000000000 }],
        },
      }),
    );
    const r = await runLienSearch('50-42-17-08-0010', 'broward');
    expect(r.county).toBe('broward');
    expect(r.countyName).toBe('Broward County');
    expect(r.prettyFolio).toBe('50-42-17-08-0010');
    expect(r.address).toBe('1400 SW 29 TER');
    expect(r.owner).toBe('TORRES,JUANA & PEREZ,WALTER ENRIQUE');
    expect(r.municipality).toBe('Fort Lauderdale');
    expect(r.found).toBe(2);
    expect(r.failed).toBe(0);
    expect(r.coverage.level).toBe('cases');
    // The expired permit is the one that blocks a closing.
    const permits = r.sections.find((s) => s.key === 'permits');
    expect(permits?.lines[0].tone).toBe('red');
    expect(permits?.lines[0].title).toMatch(/expired/i);
  });

  it('keeps the tax, records and county steps on every search, since they are bot-walled', async () => {
    stub = installArcgisStub(inFortLauderdale());
    const r = await runLienSearch('504217080010', 'broward');
    const keys = r.staffSteps.map((s) => s.key);
    expect(keys).toContain('taxes');
    expect(keys).toContain('records');
    expect(keys).toContain('utilities');
    expect(keys).toContain('countyCode');
    // Fort Lauderdale's cases AND permits are both pulled, so no city letter.
    expect(keys).not.toContain('city');
  });

  it('adds the city lien letter for a city whose cases are not published', async () => {
    stub = installArcgisStub([
      { match: BCPA, rows: [bcpaRow({ FOLIO_NUMBER: '514106010010' })], centroid: { lat: 26.0, lng: -80.2 } },
      { match: BROWARD_CITIES, rows: [{ CITYNAME: 'PEMBROKE PINES' }] },
    ]);
    const r = await runLienSearch('514106010010', 'broward');
    const city = r.staffSteps.find((s) => s.key === 'city');
    expect(city?.title).toMatch(/pembroke pines/i);
    expect(city?.how).toMatch(/code liens/i);
    expect(r.coverage.level).toBe('records');
    expect(r.sections).toHaveLength(0);
  });

  it('asks for a city letter when it cannot tell which city, instead of assuming unincorporated', async () => {
    stub = installArcgisStub([
      { match: BCPA, rows: [bcpaRow()], centroid: { lat: 26.1, lng: -80.16 } },
      { match: BROWARD_CITIES, status: 500 },
    ]);
    const r = await runLienSearch('504217080010', 'broward');
    expect(r.unincorporated).toBe(false);
    const city = r.staffSteps.find((s) => s.key === 'city');
    expect(city).toBeTruthy();
    expect(city?.how).toMatch(/could not be determined/i);
  });

  it('reports no parcel rather than an empty clear search when the tax roll fails', async () => {
    stub = installArcgisStub([{ match: BCPA, errorBody: { code: 499, message: 'Token Required' } }]);
    const r = await runLienSearch('504217080010', 'broward');
    // The caller turns a null address into "no parcel found", never into
    // "clear": there is nothing to be clear about.
    expect(r.address).toBeNull();
    expect(r.sections).toHaveLength(0);
  });

  it('pulls Hollywood permits by folio, where that is the one live city source', async () => {
    stub = installArcgisStub([
      { match: BCPA, rows: [bcpaRow({ FOLIO_NUMBER: '504223000030' })], centroid: { lat: 26.01, lng: -80.14 } },
      { match: BROWARD_CITIES, rows: [{ CITYNAME: 'HOLLYWOOD' }] },
      {
        match: HWD_PERMITS,
        rows: [{ RECORD_ID: 'COM-ELEC-26-000099', RECORD_TYPE: 'Commercial Electrical Permit', RECORD_STATUS: 'Permit Expired', RECORD_OPEN_DATE: 1771977600000 }],
      },
    ]);
    const r = await runLienSearch('504223000030', 'broward');
    const permits = r.sections.find((s) => s.key === 'permits');
    expect(permits?.lines[0].tone).toBe('red');
    // Hollywood publishes permits but not code cases, so the letter still goes.
    const city = r.staffSteps.find((s) => s.key === 'city');
    expect(city?.how).toMatch(/code liens and fines/i);
  });
});

describe('a records-level county search', () => {
  const fdorRow = (over: Record<string, any> = {}) => ({
    CO_NO: 60, // Palm Beach
    PARCEL_ID: '00424725050020010',
    OWN_NAME: 'SAMPLE OWNER',
    PHY_ADDR1: '100 MAIN ST',
    PHY_CITY: 'WEST PALM BEACH',
    S_LEGAL: 'SAMPLE SUB LT 1',
    ...over,
  });

  it('confirms the parcel live and hands every record to a person', async () => {
    stub = installArcgisStub([
      { match: FDOR, rows: [fdorRow()], centroid: { lat: 26.71, lng: -80.05 } },
      { match: CENSUS_PLACES, rows: [{ BASENAME: 'West Palm Beach', NAME: 'West Palm Beach city', STATE: '12' }] },
    ]);
    const r = await runLienSearch('00424725050020010', 'palm-beach');
    expect(r.countyName).toBe('Palm Beach County');
    expect(r.owner).toMatch(/sample owner/i);
    expect(r.municipality).toBe('West Palm Beach');
    expect(r.coverage.level).toBe('records');
    expect(r.sections).toHaveLength(0);
    // Nothing was pulled, so nothing may read as clear: found and failed are
    // both zero and the staff steps carry the whole search.
    expect(r.found).toBe(0);
    expect(r.failed).toBe(0);
    expect(r.staffSteps.map((s) => s.key)).toContain('countyPermits');
    expect(r.staffSteps.find((s) => s.key === 'city')?.title).toMatch(/west palm beach/i);
  });

  it('rejects a parcel number that matched in a different county', async () => {
    stub = installArcgisStub([
      // The statewide roll holds every county's ids, so this one really can
      // come back from a Palm Beach search.
      { match: FDOR, rows: [fdorRow({ CO_NO: 16 })], centroid: { lat: 26.1, lng: -80.16 } },
    ]);
    const r = await runLienSearch('00424725050020010', 'palm-beach');
    expect(r.address).toBeNull();
    expect(r.owner).toBeNull();
  });

  it('treats an out-of-Florida place hit as no municipality', async () => {
    stub = installArcgisStub([
      { match: FDOR, rows: [fdorRow({ CO_NO: 54, PARCEL_ID: '00123456000000' })], centroid: { lat: 24.55, lng: -81.78 } },
      // A boundary query can return a neighbouring state's place; it is not
      // the authority for a Florida parcel.
      { match: CENSUS_PLACES, rows: [{ BASENAME: 'Somewhere', NAME: 'Somewhere city', STATE: '13' }] },
    ]);
    const r = await runLienSearch('00123456000000', 'monroe');
    expect(r.municipality).toBeNull();
    expect(r.unincorporated).toBe(true);
  });
});

describe('searches delivered before the product was multi-county', () => {
  it('reads back as Miami-Dade instead of rendering blanks on a client\'s record', async () => {
    const { installSupabaseStub, lienRow } = await import('./supabase-stub');
    const sb = installSupabaseStub([lienRow()]); // its stored search has no county
    try {
      const { getLienRecord } = await import('@/lib/lien-records');
      const got = await getLienRecord('LS-ABCDEFGHJK');
      expect(got.ok).toBe(true);
      const s = (got as any).record.search;
      expect(s.county).toBe('miami-dade');
      expect(s.countyName).toBe('Miami-Dade County');
      expect(s.parcelLabel).toBe('Folio');
      expect(s.coverage.level).toBe('cases');
    } finally {
      sb.restore();
    }
  });
});

describe('city permits inside Miami-Dade', () => {
  // The county's own layers hold county records. A parcel inside a city also
  // carries that city's permits, which the county does not have, and which
  // used to be invisible until a person wrote the city.
  const mdBase = (municipality: string, extra: Record<string, any> = {}) => {
    const base: Record<string, any> = {
      [MD_PA]: { json: mdPaRecord(municipality) },
      [MD_ARCGIS]: { rows: [] },
      [MD_PERMIT_LAYER]: { rows: [] },
    };
    return Object.entries({ ...base, ...extra }).map(([match, r]) => ({ match, ...(r as object) }));
  };

  it('pulls City of Miami permits and flags an expired one', async () => {
    stub = installArcgisStub(
      mdBase('MIAMI', {
        [MIAMI_CITY_PERMITS]: {
          rows: [
            {
              PermitNumber: 'BD12004467001BR001',
              FolioNumber: 141040280130,
              BuildingPermitStatusDescription: 'Expired',
              BuildingPermitStatusReasonDescription: 'Permit is Expired',
              IssuedDate: 1342010700000,
              ScopeofWork: 'BUILDING ROOFING',
            },
          ],
        },
      }),
    );
    const r = await runLienSearch('0141040280130', 'miami-dade');
    const city = r.sections.find((s) => s.key === 'cityPermits');
    expect(city?.title).toMatch(/city of miami/i);
    expect(city?.state).toBe('found');
    expect(city?.lines[0].tone).toBe('red');
    // The letter still goes, but it no longer has to ask for the permits.
    expect(r.staffSteps.find((s) => s.key === 'city')?.how).toMatch(/pulled live/i);
    expect(r.coverage.automated.join(' ')).toMatch(/City of Miami permits/i);
  });

  it('adds no city section for an unincorporated parcel', async () => {
    stub = installArcgisStub(mdBase('UNINCORPORATED COUNTY'));
    const r = await runLienSearch('3049260021120', 'miami-dade');
    expect(r.sections.find((s) => s.key === 'cityPermits')).toBeUndefined();
    expect(r.staffSteps.find((s) => s.key === 'city')).toBeUndefined();
  });

  it('marks the city section "could not be checked" when the city source fails', async () => {
    stub = installArcgisStub(
      mdBase('MIAMI', { [MIAMI_CITY_PERMITS]: { errorBody: { code: 500, message: 'Layer unavailable' } } }),
    );
    const r = await runLienSearch('0141040280130', 'miami-dade');
    const city = r.sections.find((s) => s.key === 'cityPermits');
    expect(city?.state).toBe('failed');
    expect(r.failed).toBe(1);
    // A failed source must never read as clear.
    expect(city?.summary).toMatch(/did not answer/i);
  });

  it('still asks for the full city letter in a city that publishes nothing', async () => {
    stub = installArcgisStub(mdBase('MIAMI BEACH'));
    const r = await runLienSearch('0232340010010', 'miami-dade');
    expect(r.sections.find((s) => s.key === 'cityPermits')).toBeUndefined();
    expect(r.staffSteps.find((s) => s.key === 'city')?.how).toMatch(/city permits/i);
  });
});

describe('the query actually sent to a city layer', () => {
  // A stub that answers whatever it is asked would hide the worst failure
  // here: a parcel number sent in the wrong shape matches nothing, and
  // "nothing" reads as "no city permits". So the URL itself is asserted.
  it('sends the Miami folio as an unquoted number, which is how the city stores it', async () => {
    stub = installArcgisStub([
      { match: MD_PA, json: mdPaRecord('MIAMI') },
      { match: MD_ARCGIS, rows: [] },
      { match: MD_PERMIT_LAYER, rows: [] },
      { match: MIAMI_CITY_PERMITS, rows: [] },
    ]);
    await runLienSearch('0141040280130', 'miami-dade');
    const asked = stub.urls.find((u) => u.includes(MIAMI_CITY_PERMITS));
    expect(asked).toBeTruthy();
    const where = decodeURIComponent(new URL(asked!).searchParams.get('where') ?? '');
    // The leading zero is gone and there are no quotes: FolioNumber is a
    // Double in the city's layer, so 'FolioNumber=...' with quotes errors and
    // a padded 13-digit value never matches.
    expect(where).toContain('FolioNumber=141040280130');
    expect(where).not.toContain("FolioNumber='");
    expect(where).toContain("BuildingPermitStatusDescription<>'Final'");
  });

  it('sends the Fort Lauderdale parcel id the city layer uses, not the county folio', async () => {
    stub = installArcgisStub([
      { match: BCPA, rows: [bcpaRow()], centroid: { lat: 26.1, lng: -80.16 } },
      { match: BROWARD_CITIES, rows: [{ CITYNAME: 'FORT LAUDERDALE' }] },
      { match: FTL_PARCELS, rows: [{ FOLIO: '504217080010', PARCELID: '0217080010' }] },
      { match: FTL_CODE, rows: [] },
      { match: FTL_PERMITS, rows: [] },
    ]);
    await runLienSearch('504217080010', 'broward');
    const asked = stub.urls.find((u) => u.includes(FTL_CODE));
    const where = decodeURIComponent(new URL(asked!).searchParams.get('where') ?? '');
    // The city's id, resolved through the city's own parcel layer, never the
    // 12-digit county folio.
    expect(where).toContain("PARCELID='0217080010'");
    expect(where).toContain("CASESTATUS='O'");
  });
});

describe('what the page says is pulled live', () => {
  // The page is built from the registry, so this test exists to catch the
  // drift that would matter most: a city or county quietly dropping out of
  // the code while the page still advertises it, or the reverse.
  it('lists exactly the counties and cities that actually have live sources', async () => {
    const { liveCoverage } = await import('@/lib/lien-search');
    const { counties, cities } = liveCoverage();
    expect(counties.map((c) => c.key).sort()).toEqual(['broward', 'miami-dade']);
    expect(cities.map((c) => c.label).sort()).toEqual(['City of Miami', 'Fort Lauderdale', 'Hollywood']);
    // Each city says which of the two things it answers, never both when it
    // only publishes one.
    const ftl = cities.find((c) => c.label === 'Fort Lauderdale')!;
    expect(ftl.what.sort()).toEqual(['code cases', 'permits']);
    expect(cities.find((c) => c.label === 'Hollywood')!.what).toEqual(['permits']);
    expect(cities.find((c) => c.label === 'City of Miami')!.what).toEqual(['permits']);
  });
});

describe('a bare parcel number with no county named', () => {
  // The dangerous outcome is not "not found", it is finding the WRONG
  // property: a 12-digit Broward folio padded to 13 is a valid-looking
  // Miami-Dade folio, and could match a different lot in a different county.
  const post = async (body: Record<string, unknown>) => {
    const { POST } = await import('@/app/api/lien-search/route');
    const req = new NextRequest('https://test.palma.invalid/api/lien-search', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
    return POST(req);
  };

  it('reads a 12-digit number as a Broward folio, not a padded Miami-Dade one', async () => {
    stub = installArcgisStub([
      { match: BCPA, rows: [bcpaRow()], centroid: { lat: 26.1, lng: -80.16 } },
      { match: BROWARD_CITIES, rows: [{ CITYNAME: 'FORT LAUDERDALE' }] },
      { match: FTL_PARCELS, rows: [{ FOLIO: '504217080010', PARCELID: '0217080010' }] },
      { match: FTL_CODE, rows: [] },
      { match: FTL_PERMITS, rows: [] },
    ]);
    const res = await post({ query: '504217080010' });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.county).toBe('broward');
    expect(body.address).toBe('1400 SW 29 TER');
  });

  it('still reads a 13-digit number as Miami-Dade', async () => {
    stub = installArcgisStub([
      { match: MD_PA, json: mdPaRecord('UNINCORPORATED COUNTY') },
      { match: MD_ARCGIS, rows: [] },
      { match: MD_PERMIT_LAYER, rows: [] },
    ]);
    const res = await post({ query: '3049260021120' });
    const body = await res.json();
    expect(body.county).toBe('miami-dade');
  });

  it('lets an explicitly named county win over the shape', async () => {
    stub = installArcgisStub([
      { match: FDOR, rows: [{ CO_NO: 54, PARCEL_ID: '504217080010', OWN_NAME: 'KEYS OWNER', PHY_ADDR1: '1 OVERSEAS HWY' }], centroid: { lat: 24.5, lng: -81.7 } },
      { match: CENSUS_PLACES, rows: [] },
    ]);
    const res = await post({ query: '504217080010', county: 'monroe' });
    const body = await res.json();
    expect(body.county).toBe('monroe');
    expect(body.owner).toMatch(/keys owner/i);
  });
});
