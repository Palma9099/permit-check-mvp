// Broward County BCS (Posse) adapter.
//
// Same promise as the rest of the suite: a source nobody checked is never
// reported as clear. Broward makes that unusually easy to get wrong.
//
// The county's code enforcement covers unincorporated Broward - 16,888 of
// 1,944,375 people - so an empty county result is the normal answer for 99% of
// the county and says nothing about the property. Unlike Palm Beach, a Broward
// folio does not encode incorporation, so the authority has to come from the
// parcel point. It must never come from the postal city: this data is full of
// unincorporated parcels carrying "FORT LAUDERDALE" addresses.
//
// Two parsing traps found against the live portal are pinned here as well,
// because both produced confidently wrong output rather than an error.
//
// The live selector check is worker/src/smoke-broward.ts.

import { describe, expect, it } from 'vitest';
import {
  parcelKeyFor,
  authorityFromCityName,
  fieldFrom,
  parseCaseDetail,
  parseActivities,
  lienSummary,
  cleanDate,
  pickGrid,
  exactIndex,
  runBrowardScrape,
} from '../worker/src/scrapers/broward.js';
import { JURISDICTIONS, type BrowardJurisdiction } from '../worker/src/scrapers/jurisdictions.js';
import type { ScraperCtx } from '../worker/src/scrapers/types.js';

const BROWARD = JURISDICTIONS['broward'] as BrowardJurisdiction;

const noPage = new Proxy(
  {},
  {
    get() {
      throw new Error('adapter touched the browser when it should have returned early');
    },
  },
) as any;

const ctx = (folio: string | null): ScraperCtx => ({
  page: noPage,
  address: null,
  folio,
  lat: null,
  lng: null,
  log: () => {},
});

describe('parcel key', () => {
  it('sends a 12-digit app folio to the Parcel ID field', () => {
    // This is what compactBrowardFolio produces and what the portal's Parcel ID
    // example (504215010130) looks like.
    expect(parcelKeyFor('504113111610')).toEqual({ kind: 'parcelId', value: '504113111610' });
  });

  it('sends a 10-digit folio to the Folio field, dashed as the portal writes it', () => {
    expect(parcelKeyFor('0113111610')).toEqual({ kind: 'folio', value: '0113-11-1610' });
  });

  it('ignores punctuation in the input', () => {
    expect(parcelKeyFor('5041-13-11-1610')).toEqual({ kind: 'parcelId', value: '504113111610' });
  });

  it('refuses a Palm Beach PCN rather than searching the wrong parcel', () => {
    expect(parcelKeyFor('00414310000004180')).toBeNull();
    expect(parcelKeyFor('00-41-43-10-00-000-4180')).toBeNull();
  });

  it('refuses empty and short input', () => {
    expect(parcelKeyFor(null)).toBeNull();
    expect(parcelKeyFor('')).toBeNull();
    expect(parcelKeyFor('5041')).toBeNull();
  });
});

describe('who the code authority is', () => {
  it('reads unincorporated Broward in both forms the layer uses', () => {
    expect(authorityFromCityName('UNINCORPORATED')).toEqual({ kind: 'county' });
    expect(authorityFromCityName('BMSD- BROADVIEW PARK')).toEqual({ kind: 'county' });
  });

  it('names a municipality', () => {
    expect(authorityFromCityName('FORT LAUDERDALE')).toEqual({ kind: 'city', name: 'FORT LAUDERDALE' });
    expect(authorityFromCityName('WESTON')).toEqual({ kind: 'city', name: 'WESTON' });
  });

  it('treats a missing answer as unknown, never as unincorporated', () => {
    // Defaulting a failed boundary lookup to "unincorporated" would quietly
    // drop the city, which in Broward is almost the whole answer.
    expect(authorityFromCityName(null)).toEqual({ kind: 'unknown' });
    expect(authorityFromCityName('')).toEqual({ kind: 'unknown' });
    expect(authorityFromCityName('   ')).toEqual({ kind: 'unknown' });
  });
});

describe('refusing to imply a clean property', () => {
  it('asks for a Broward folio instead of searching on one it cannot use', async () => {
    const r = await runBrowardScrape(ctx('00414310000004180'), BROWARD);
    expect(r.ok).toBe(false);
    expect(r.notes.join(' ')).toMatch(/not a Broward parcel number/i);
  });

  it('asks for a folio when none was supplied', async () => {
    const r = await runBrowardScrape(ctx(null), BROWARD);
    expect(r.ok).toBe(false);
    expect(r.notes.join(' ')).toMatch(/keyed by parcel number/i);
  });

  it('still hands back the county links so a refusal is actionable', async () => {
    const r = await runBrowardScrape(ctx(null), BROWARD);
    expect(r.portalLinks.some((l) => /bcpa\.net/i.test(l.url))).toBe(true);
    expect(r.portalLinks.some((l) => /officialrecords\.broward\.org/i.test(l.url))).toBe(true);
  });
});

describe('registry', () => {
  it('does not point Broward at Accela', () => {
    // aca-prod.accela.com/BROWARD/ returns 404 and always did.
    expect(BROWARD.platform).toBe('broward-bcs');
    expect(JSON.stringify(BROWARD)).not.toMatch(/accela/i);
  });
});

describe('cleanDate', () => {
  it('drops the portal placeholder instead of passing it off as a date', () => {
    // The permit grid literally prints "mmm dd, yyyy" where a date is absent.
    expect(cleanDate('mmm dd, yyyy')).toBeNull();
    expect(cleanDate('MMM DD, YYYY')).toBeNull();
  });

  it('keeps real dates', () => {
    expect(cleanDate('Jan 31, 2006')).toBe('Jan 31, 2006');
    expect(cleanDate('09/15/2010')).toBe('09/15/2010');
  });
});

describe('fieldFrom', () => {
  // The bug this pins: `Label:\s*(.*)` walks past an empty field, because \s
  // matches a newline, and captures the next line. A case with no complaint
  // text reported its Date Established line as the complaint.
  const text = ['Complaint / Violation:', 'Date Established: 09/15/2010', 'Inspector: Nicholas Rousseau'].join('\n');

  it('reads an empty field as empty, not as the next line', () => {
    expect(fieldFrom(text, 'Complaint / Violation')).toBeNull();
  });

  it('still reads the following labels correctly', () => {
    expect(fieldFrom(text, 'Date Established')).toBe('09/15/2010');
    expect(fieldFrom(text, 'Inspector')).toBe('Nicholas Rousseau');
  });

  it('keeps colons inside a value', () => {
    expect(fieldFrom('Section: CITATION: 39-275(6)b', 'Section')).toBe('CITATION: 39-275(6)b');
  });

  it('does not let a short label match a longer one', () => {
    const t = 'Complaint / Violation: BULK ON SWALE';
    expect(fieldFrom(t, 'Violation')).toBeNull();
  });

  it('tolerates the tabs the portal renders between label and value', () => {
    expect(fieldFrom('Status:\t\tLien Recorded', 'Status')).toBe('Lien Recorded');
  });
});

describe('pickGrid', () => {
  // On a Posse page the outer page chrome is itself a <table> whose first row
  // flattens the whole document, and a substring match on "case" hits the page
  // heading "BCS Enforcement Cases". Both produced a grid where every column
  // read back as the case number.
  const chrome = {
    headers: ['', 'Broward.org | Government', 'BCS Enforcement Cases', 'Case #', 'Street Address', '10-1011'],
    rows: [['Broward.org | Government'], ['', '', '', '10-1011', '1455 SW 49 TER', '']],
  };
  const grid = {
    headers: ['', 'Case #', 'Street Address', 'City, State and ZIP', 'Established', 'Enforcement Type', 'Status'],
    rows: [
      ['', '10-1011', '1455 SW 49 TER', 'UNINCORPORATED FL 0', '09/15/2010', 'Code Compliance', 'Closed'],
      ['', '24-0071', '1455 SW 49 TER', 'UNINCORPORATED FL 33317', '01/18/2024', 'Code Compliance', 'Lien Recorded'],
    ],
  };

  it('skips the page chrome and finds the real grid', () => {
    const got = pickGrid([chrome, grid], ['case #'], /^\d\d-\d{3,5}$/);
    expect(got).not.toBeNull();
    expect(got!.idIndex).toBe(1);
    expect(got!.rows).toHaveLength(2);
  });

  it('prefers the grid holding the most id-shaped rows, whatever the order', () => {
    // A nested wrapper can pass the width test by accident, so row count has to
    // break the tie - and the real grid always holds more.
    expect(pickGrid([chrome, grid], ['case #'], /^\d\d-\d{3,5}$/)!.rows).toHaveLength(2);
    expect(pickGrid([grid, chrome], ['case #'], /^\d\d-\d{3,5}$/)!.rows).toHaveLength(2);
  });

  it('returns null rather than a wrong table when nothing holds id-shaped rows', () => {
    const noIds = { headers: grid.headers, rows: [['', 'n/a', '', '', '', '', '']] };
    expect(pickGrid([noIds], ['case #'], /^\d\d-\d{3,5}$/)).toBeNull();
  });

  it('drops rows whose width does not match the header', () => {
    const ragged = { headers: grid.headers, rows: [...grid.rows, ['stray']] };
    expect(pickGrid([ragged], ['case #'], /^\d\d-\d{3,5}$/)!.rows).toHaveLength(2);
  });
});

describe('exactIndex', () => {
  it('tells "Permit" apart from "Permit Number"', () => {
    const headers = ['Permit Number', 'Permit', 'Type', 'Status', 'Issue Date', 'Contractor'];
    expect(exactIndex(headers, ['permit'])).toBe(1);
  });

  it('returns -1 when nothing matches exactly', () => {
    expect(exactIndex(['Permit Number'], ['permit'])).toBe(-1);
  });
});

// Verbatim from case 24-0071 (1455 SW 49 TER, Broadview Park), read 2026-11-09.
// Tabs preserved, because that is what the portal renders between label and value.
const CASE_DETAIL = `Case Details
\tStatus:\t\tLien Recorded
\tEnforcement Type:\t\tCode Compliance
\tCase Type:\t\tZONING
\tComplainant Type:\t\tHomeowner's Association
\tProperty Type:\t\t(None)
\tExpired Permit Number:
\tComplaint / Violation:\t\tBULK ON SWALE MORE THAN 24 HOURS BEFORE SCHEDULED PICKUP.
\tDate Established:\t\t01/18/2024
\tCorrection Deadline:\t\t01/18/2024
\tInspector:\t\tNicholas Rousseau
\t(954) 357-9790
\tViolation Location
\tFolio Number:\t\t0113-11-1610
\tAddress:\t\t1455 SW 49 TER
\tUNINCORPORATED FL 33317
\tJurisdiction:\t\tUnincorporated
\tLegal Description:\t\tBROADVIEW PARK 36-33 BLOT 18 BLK 13
\tParcel Owner
\tOwner:\t\tMCFARLAND,BRIAN
\tMailing Address:\t\t1455 SW 49 TER`;

const ACTIVITIES = `Activities
\tNOV - Notice of Violation
\tNOV Issued:\t01/18/2024
\tSection:\tCITATION: 39-275(6)b
\tViolation:\tPLACING BULK TRASH ON SWALE MORE THAN 24 HOURS PRIOR TO SCHEDULED COLLECTION.
\tLien Recording Information
\tCR Number:\t119572537
\tRecording Book:
\tRecording Page:
\tRecording Date:\t05/14/2024`;

describe('case detail parsing', () => {
  const d = parseCaseDetail(CASE_DETAIL);

  it('reads the case facts', () => {
    expect(d.status).toBe('Lien Recorded');
    expect(d.caseType).toBe('ZONING');
    expect(d.complaint).toBe('BULK ON SWALE MORE THAN 24 HOURS BEFORE SCHEDULED PICKUP.');
    expect(d.established).toBe('01/18/2024');
    expect(d.inspector).toBe('Nicholas Rousseau');
  });

  it('reads the parcel identity, including the jurisdiction field', () => {
    // This field, not the city column, is how a case's real authority is known.
    expect(d.jurisdiction).toBe('Unincorporated');
    expect(d.folio).toBe('0113-11-1610');
    expect(d.owner).toBe('MCFARLAND,BRIAN');
    expect(d.legal).toBe('BROADVIEW PARK 36-33 BLOT 18 BLK 13');
  });

  it('leaves an unset field null', () => {
    const empty = parseCaseDetail('');
    expect(empty.status).toBeNull();
    expect(empty.jurisdiction).toBeNull();
    expect(empty.owner).toBeNull();
  });
});

describe('activities and the recorded lien', () => {
  const a = parseActivities(ACTIVITIES);

  it('reads the cited section whole, colon and all', () => {
    expect(a.section).toBe('CITATION: 39-275(6)b');
  });

  it('reads the recorded-lien instrument number', () => {
    expect(a.crNumber).toBe('119572537');
    expect(a.recordingDate).toBe('05/14/2024');
  });

  it('does not let the blank Recording Book swallow the line after it', () => {
    // "Recording Book:" is empty on this case and "Recording Page:" follows it.
    // The old regex captured the next line, which would have reported the page
    // number as the book.
    expect(fieldFrom(ACTIVITIES, 'Recording Book')).toBeNull();
    expect(fieldFrom(ACTIVITIES, 'Recording Page')).toBeNull();
  });

  it('summarises the lien so a person can pull the recorded document', () => {
    expect(lienSummary(a)).toBe('Lien recorded 05/14/2024 (Broward Official Records CR 119572537)');
  });

  it('reports no lien when there is none, rather than an empty-looking one', () => {
    expect(
      lienSummary({ novIssued: null, section: null, violation: null, crNumber: null, recordingDate: null }),
    ).toBeNull();
  });

  it('never invents a dollar amount, because the county does not publish one', () => {
    // The status says a lien was recorded; the figure is only in the recorded
    // document at Official Records.
    expect(JSON.stringify(a)).not.toMatch(/\$\s*[\d,]+/);
    expect(lienSummary(a)).not.toMatch(/\$/);
  });
});
