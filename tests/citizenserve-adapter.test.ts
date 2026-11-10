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
  CITIZENSERVE_SHARDS,
  DEFAULT_SHARD,
  relinkToShard,
  searchUrlOn,
  parseCaseRows,
  unreadableRowsNote,
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
    const { cases } = parseCaseRows(rows);
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
    const { cases } = parseCaseRows(rows);
    expect(cases[0].fileNumber).toBeNull();
    expect(cases[0].address).toBe('6211 NW 44TH PL');
  });

  it('keeps the inspector narrative, which is the useful part', () => {
    expect(parseCaseRows(rows).cases[1].description).toMatch(/elevated accessory structure/);
  });

  it('drops a genuinely empty filler row without calling it unreadable', () => {
    // No text at all: nothing was lost, so this is not a parse failure.
    const r = parseCaseRows([['', '', '', '', '', '', '']]);
    expect(r.cases).toEqual([]);
    expect(r.unreadable).toBe(0);
  });

  it('invents no fine or lien amount, because the portal shows none', () => {
    expect(JSON.stringify(parseCaseRows(rows).cases)).not.toMatch(/\$\s*[\d,]+/);
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

// ---------------------------------------------------------------------------
// Codex citizenserve round 1, F-01 (HIGH). A populated grid became a
// confirmed zero.
//
// The row filter kept a row only when the ADDRESS cell had content, chosen
// because File# is blank on several live Alachua rows. But address can be
// blank too, and then a real open case was discarded in silence. The grid was
// populated, so the empty-grid guard never ran; the search still reported as
// executed; and the email printed "Code-enforcement cases (0): none found"
// over an open dangerous-building case.
//
// This is the same shape as the Palm Beach permit finding one round earlier:
// drop rows, then report the survivor count as the truth. Twice in two
// adapters is why the parser now fails closed instead of filtering quietly.
// ---------------------------------------------------------------------------
describe('F-01: a populated grid is never a confirmed zero', () => {
  // Codex's trigger, verbatim.
  const BLANK_ADDRESS_ROW = [
    'CE-123',
    '',
    'Unsafe structure',
    'Open',
    '01/01/2026',
    '',
    'Active dangerous building case',
  ];

  it('keeps an open case whose address cell is blank', () => {
    const { cases, unreadable } = parseCaseRows([BLANK_ADDRESS_ROW]);
    expect(cases).toHaveLength(1);
    expect(cases[0].fileNumber).toBe('CE-123');
    expect(cases[0].status).toBe('Open');
    expect(cases[0].description).toMatch(/dangerous building/i);
    expect(unreadable).toBe(0);
  });

  it('keeps Codex control row too, so the fix is not one-sided', () => {
    const control = ['CE-123', '100 MAIN ST', 'Unsafe structure', 'Open', '01/01/2026', '', 'x'];
    expect(parseCaseRows([control]).cases).toHaveLength(1);
  });

  it('survives on either identifying field, not one chosen field', () => {
    const noFileNo = ['', '6211 NW 44TH PL', 'Work without Permit', 'Open', '', '', ''];
    const noAddress = ['CE-9', '', 'Work without Permit', 'Open', '', '', ''];
    expect(parseCaseRows([noFileNo]).cases).toHaveLength(1);
    expect(parseCaseRows([noAddress]).cases).toHaveLength(1);
  });

  it('COUNTS a populated row that identifies no case, instead of dropping it', () => {
    // Text present, but nothing naming a case or a property. This is a parse
    // failure on a populated row, not an absence of cases.
    const odd = ['', '', '', 'Open', '01/01/2026', '', ''];
    const r = parseCaseRows([odd]);
    expect(r.cases).toEqual([]);
    expect(r.unreadable).toBe(1);
  });

  it('counts the lost rows alongside the ones it read', () => {
    const good = ['CE-1', '1 MAIN ST', 'T', 'Open', '', '', ''];
    const lost = ['', '', '', 'Open', '', '', ''];
    const r = parseCaseRows([good, lost, lost]);
    expect(r.cases).toHaveLength(1);
    expect(r.unreadable).toBe(2);
  });

  it('tells the reader a row was lost rather than that nothing ran', () => {
    const n = unreadableRowsNote(2, 'Alachua County');
    expect(n).toMatch(/Alachua County/);
    expect(n).toMatch(/2 result rows/);
    expect(n).toMatch(/incomplete/i);
    expect(n).toMatch(/nothing here is a clear result/i);
    // Singular reads correctly too; a bad plural undermines the warning.
    expect(unreadableRowsNote(1, 'Alachua County')).toMatch(/1 result row that/);
  });
});

// ---------------------------------------------------------------------------
// Codex citizenserve round 2, F-01. The links in an honest refusal pointed at
// a dead server.
//
// csLinks pinned every portal link to www6. On the day this was found, www6
// served a 2,591-byte stub with no search form while www through www5 served
// the real page. So the adapter would correctly refuse to call a property
// clear, tell the reader to open the portal and check it themselves, and hand
// them a broken link. Codex found this using the shard-health capture I had
// attached as evidence for something else.
//
// The links are not decoration. They are what a reader has left when the
// automated read fails, so they have to work.
// ---------------------------------------------------------------------------
describe('F-01: portal links follow the server that actually answered', () => {
  it('builds registry links without pinning a shard by hand', () => {
    const url = searchUrlOn(DEFAULT_SHARD, 318);
    expect(url).toContain('installationID=318');
    // www was the only shard healthy in both of the two measurements taken a
    // day apart, which is why it is the pre-flight default.
    expect(DEFAULT_SHARD).toBe('www');
    expect(url).not.toContain('www6');
  });

  it('rewrites a citizenserve link to the shard that opened', () => {
    const links = [
      { label: 'Code case search (citizenserve portal)', url: searchUrlOn('www6', 318) },
      { label: 'Property Appraiser', url: 'https://www.acpafl.org/' },
    ];
    const out = relinkToShard(links, 'www3', 318);
    expect(out[0].url).toBe(searchUrlOn('www3', 318));
    expect(out[0].url).toContain('installationID=318');
  });

  it('leaves non-citizenserve links alone', () => {
    // The Property Appraiser link is a different host entirely and is the
    // reader's route to their parcel id; rewriting it would break it.
    const links = [
      { label: 'Code case search (citizenserve portal)', url: searchUrlOn('www6', 445) },
      { label: 'Property Appraiser', url: 'https://www.sumterpa.com/' },
    ];
    const out = relinkToShard(links, 'www2', 445);
    expect(out[1].url).toBe('https://www.sumterpa.com/');
    expect(out).toHaveLength(2);
  });

  it('keeps the tenant id when moving shards', () => {
    // A relink that dropped or changed the installationID would send the
    // reader to a different government's records.
    for (const id of [221, 441, 261, 401, 237, 326, 318, 445, 389]) {
      const out = relinkToShard([{ label: 'x', url: searchUrlOn('www6', id) }], 'www5', id);
      expect(out[0].url).toBe(searchUrlOn('www5', id));
    }
  });

  it('every shard in the list is a usable substitute in a link', () => {
    for (const sh of CITIZENSERVE_SHARDS) {
      expect(searchUrlOn(sh, 318)).toMatch(/^https:\/\/www\d?\.citizenserve\.com\/Portal\/PortalController\?/);
    }
    expect(CITIZENSERVE_SHARDS).toHaveLength(8);
  });
});
