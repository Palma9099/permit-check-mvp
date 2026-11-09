// citizenserve adapter.
//
// Same promise as the rest of the suite: a source nobody checked is never
// reported as clear. citizenserve has two ways to break that promise that no
// other platform in this codebase has.
//
// First, being on citizenserve says NOTHING about whether code cases are
// public. Every Florida tenant answers at the same URL with the same search
// page, but the file types that page offers are per-tenant configuration.
// Surveyed live 2026-11-09 across the 17 confirmed Florida tenants: 10 expose
// Code, 7 do not. Walton County offers Development only; Eatonville's search
// offers nothing at all. Searching a module a county never enabled and
// reporting "no cases" is a lie, so the adapter refuses up front.
//
// Second, the platform ships the literal string "No records found" inside a
// <script> element on every results page, so page text contains it even when
// the grid is full. A one-record Alachua search reads as "No records found"
// and then prints the record.
//
// The live selector check is worker/src/smoke-citizenserve.ts.

import { describe, expect, it } from 'vitest';
import {
  fileTypesFrom,
  hasCode,
  parseCaseRows,
  coverageNote,
  noCodeModuleNote,
  describeOutcome,
  type CitizenserveAgency,
} from '../worker/src/scrapers/citizenserve-parse.js';
import {
  JURISDICTIONS,
  CITIZENSERVE_CITY_AGENCIES,
  CITIZENSERVE_NO_CODE,
  type CitizenserveJurisdiction,
} from '../worker/src/scrapers/jurisdictions.js';

const ALACHUA = JURISDICTIONS['alachua'] as CitizenserveJurisdiction;

describe('file types are per-tenant', () => {
  it('reads the options out of a search page', () => {
    const html = '<select id="filetype"><option value="-999"></option><option value="Permit">Permitting</option><option value="Code">Code Administration</option></select>';
    expect(fileTypesFrom(html)).toEqual(['Permit', 'Code']);
  });

  it('returns them in a stable order regardless of page order', () => {
    const html = '<option value="Code"><option value="Permit"><option value="Development">';
    expect(fileTypesFrom(html)).toEqual(['Permit', 'Development', 'Code']);
  });

  it('finds nothing in a page with no options', () => {
    expect(fileTypesFrom('<html><body>Portal not enabled</body></html>')).toEqual([]);
  });

  it('knows which tenants publish code cases', () => {
    expect(hasCode(['Permit', 'License', 'Development', 'Code'])).toBe(true);
    expect(hasCode(['Development'])).toBe(false); // Walton County, live
    expect(hasCode([])).toBe(false); // Eatonville, live
  });
});

describe('refusing a tenant that never published code cases', () => {
  const walton = CITIZENSERVE_NO_CODE.find((a) => a.installationID === 245)!;

  it('says nothing was checked rather than nothing was found', () => {
    const n = noCodeModuleNote(walton);
    expect(n).toMatch(/checked nothing here/i);
    expect(n).toMatch(/not the same as the property being clear/i);
  });

  it('names what the tenant does offer, so the reader can judge', () => {
    expect(noCodeModuleNote(walton)).toMatch(/Development/);
  });

  it('handles a tenant whose search offers nothing at all', () => {
    const eatonville = CITIZENSERVE_NO_CODE.find((a) => a.installationID === 391)!;
    expect(eatonville.fileTypes).toEqual([]);
    expect(noCodeModuleNote(eatonville)).toMatch(/offers nothing/i);
  });

  it('keeps the no-code list and the city list disjoint', () => {
    const noCodeIds = new Set(CITIZENSERVE_NO_CODE.map((a) => a.installationID));
    for (const c of CITIZENSERVE_CITY_AGENCIES) expect(noCodeIds.has(c.installationID)).toBe(false);
  });

  it('only lists city agencies that actually expose Code', () => {
    for (const c of CITIZENSERVE_CITY_AGENCIES) expect(hasCode(c.fileTypes)).toBe(true);
  });
});

describe('what an empty county result means', () => {
  const county: CitizenserveAgency = {
    installationID: 318,
    name: 'Alachua County',
    kind: 'county',
    fileTypes: ['Code'],
  };
  const city: CitizenserveAgency = {
    installationID: 403,
    name: 'Titusville',
    kind: 'city',
    fileTypes: ['Code'],
  };

  it('warns that a county portal does not hold a city\'s cases', () => {
    const n = coverageNote(county, true);
    expect(n).toMatch(/unincorporated/i);
    expect(n).toMatch(/says nothing about the property/i);
  });

  it('tells a county hit that it is only part of the picture', () => {
    expect(coverageNote(county, false)).toMatch(/only part of the picture/i);
  });

  it('treats a city result as covering the whole city', () => {
    expect(coverageNote(city, true)).toMatch(/whole city/i);
    expect(coverageNote(city, true)).not.toMatch(/unincorporated/i);
  });
});

describe('result rows', () => {
  // Verbatim shape from Alachua County, read 2026-11-09. Note the first row:
  // live data has cases with a BLANK File# column, so rows are kept on having
  // an address, not on having a file number.
  const rows = [
    ['', '6211 NW 44TH PL', 'Work without Permit', 'Open', '02/22/2022', '', 'Unsecured Solar Panels with wire strung across yard'],
    ['23-013194', '100 SW 122ND ST', 'Work without Permit', 'Open', '02/20/2023', '', 'SM23-046 Work without permits, building some sort of elevated accessory structure in back yard by shed.'],
    ['', '', '', '', '', '', ''],
  ];

  it('maps the grid onto cases', () => {
    const cases = parseCaseRows(rows);
    expect(cases).toHaveLength(2);
    expect(cases[1]).toMatchObject({
      fileNumber: '23-013194',
      address: '100 SW 122ND ST',
      type: 'Work without Permit',
      status: 'Open',
      openDate: '02/20/2023',
      closeDate: null,
    });
  });

  it('keeps a case whose File# is blank, because live data has them', () => {
    const cases = parseCaseRows(rows);
    expect(cases[0].fileNumber).toBeNull();
    expect(cases[0].address).toBe('6211 NW 44TH PL');
  });

  it('keeps the inspector narrative, which is the useful part', () => {
    expect(parseCaseRows(rows)[1].description).toMatch(/elevated accessory structure/);
  });

  it('drops a filler row with no address', () => {
    expect(parseCaseRows([['', '', '', '', '', '', '']])).toEqual([]);
  });

  it('invents no fine or lien amount, because the portal shows none', () => {
    expect(JSON.stringify(parseCaseRows(rows))).not.toMatch(/\$\s*[\d,]+/);
  });
});

describe('a search that did not run is never a clean property', () => {
  it('reports a failed read as not ok', () => {
    const o = describeOutcome(false, []);
    expect(o.ok).toBe(false);
    expect(o.note).toMatch(/did not run our search/i);
  });

  it('reports a genuine zero as ok with no cases', () => {
    expect(describeOutcome(true, [])).toEqual({ ok: true, note: null });
  });
});

describe('registry', () => {
  it('registers Alachua as a citizenserve county agency', () => {
    expect(ALACHUA.platform).toBe('citizenserve');
    expect(ALACHUA.agency.installationID).toBe(318);
    expect(ALACHUA.agency.kind).toBe('county');
    expect(hasCode(ALACHUA.agency.fileTypes)).toBe(true);
  });

  it('only registers counties that expose Code', () => {
    for (const key of ['alachua', 'sumter', 'franklin']) {
      const j = JURISDICTIONS[key] as CitizenserveJurisdiction;
      expect(j.platform).toBe('citizenserve');
      expect(hasCode(j.agency.fileTypes)).toBe(true);
    }
  });

  it('carries a portal link so a refusal is still actionable', () => {
    expect(ALACHUA.portalLinks.some((l) => /installationID=318/.test(l.url))).toBe(true);
  });

  it('does not register any tenant from the no-code list', () => {
    const registered = Object.values(JURISDICTIONS)
      .filter((j): j is CitizenserveJurisdiction => j.platform === 'citizenserve')
      .map((j) => j.agency.installationID);
    for (const a of CITIZENSERVE_NO_CODE) expect(registered).not.toContain(a.installationID);
  });
});
