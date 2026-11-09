// Palm Beach County ePZB adapter.
//
// Same promise as the rest of the suite: a source nobody checked is never
// reported as clear. Palm Beach gives that promise two sharp edges.
//
// First, the county's records cover UNINCORPORATED Palm Beach only - 649,776 of
// its 1,492,191 people. Run a Boca Raton parcel through it and you get zero
// cases, and zero there means "wrong government", not "clean". The county
// publishes the test: PCNs that begin with 00 are unincorporated.
//
// Second, the county's building portal serves its permit search free to an
// ordinary browser but refuses automated sessions. We do not work around that,
// so the permit half can come back unchecked - and unchecked has to say so.
//
// These run offline. The live selector check is worker/src/smoke-pbc.ts.

import { describe, expect, it } from 'vitest';
// Imported from pbc-parse, never from pbc.ts: the latter imports playwright,
// which is a worker dependency and does not exist at the repo root. Vercel
// installs root dependencies only, so reaching across that boundary builds
// locally and fails the deploy. The browser flow itself is covered by
// worker/src/smoke-pbc.ts.
import {
  normalizePcn,
  isUnincorporatedPcn,
  parseCaseDetailText,
  pcnRefusal,
} from '../worker/src/scrapers/pbc-parse.js';
import { JURISDICTIONS, type PbcJurisdiction } from '../worker/src/scrapers/jurisdictions.js';

const PBC = JURISDICTIONS['palm-beach'] as PbcJurisdiction;

describe('PCN normalization', () => {
  it('formats 17 bare digits into the dashed form both portals accept', () => {
    expect(normalizePcn('00414310000004180')).toBe('00-41-43-10-00-000-4180');
  });

  it('leaves an already-dashed PCN alone', () => {
    expect(normalizePcn('00-41-43-10-00-000-4180')).toBe('00-41-43-10-00-000-4180');
  });

  it('rejects a Broward folio that landed in the folio field', () => {
    // 12 digits, not 17. Matching it loosely would search the wrong parcel.
    expect(normalizePcn('504113111610')).toBeNull();
  });

  it('rejects empty and malformed input rather than guessing', () => {
    expect(normalizePcn(null)).toBeNull();
    expect(normalizePcn('')).toBeNull();
    expect(normalizePcn('00-41-43')).toBeNull();
    expect(normalizePcn('004143100000041809')).toBeNull();
  });
});

describe('unincorporated test', () => {
  it('treats a 00 prefix as unincorporated county', () => {
    expect(isUnincorporatedPcn('00-41-43-10-00-000-4180')).toBe(true);
    expect(isUnincorporatedPcn('00-40-43-11-00-000-1960')).toBe(true);
  });

  it('treats any other prefix as a municipality', () => {
    expect(isUnincorporatedPcn('06-42-47-30-01-000-0010')).toBe(false);
    expect(isUnincorporatedPcn('38-43-44-12-00-000-0001')).toBe(false);
  });
});

describe('refusing to imply a clean property', () => {
  it('refuses a municipal parcel, and says zero would not mean clean', () => {
    const r = pcnRefusal('06-42-47-30-01-000-0010');
    expect(r).not.toBeNull();
    expect(r!.notes.join(' ')).toMatch(/NOT the same as the property being clear/i);
    expect(r!.notes.join(' ')).toMatch(/unincorporated/i);
  });

  it('asks for a PCN instead of searching on a folio it cannot use', () => {
    expect(pcnRefusal('504113111610')!.notes.join(' ')).toMatch(/not a Palm Beach parcel control number/i);
  });

  it('asks for a PCN when none was supplied', () => {
    expect(pcnRefusal(null)!.notes.join(' ')).toMatch(/parcel control number/i);
  });

  it('lets a good unincorporated PCN through', () => {
    expect(pcnRefusal('00-41-43-10-00-000-4180')).toBeNull();
  });

  it('the jurisdiction still carries links so a refusal is actionable', () => {
    expect(PBC.portalLinks.length).toBeGreaterThan(0);
    expect(PBC.portalLinks.some((l) => /pbcpao\.gov/i.test(l.url))).toBe(true);
  });
});

describe('registry', () => {
  it('does not point Palm Beach at Accela', () => {
    // aca-prod.accela.com/PBC/ returns 404 and always did; the code came from an
    // aggregator's coverage page. Palm Beach runs ePZB.
    expect(PBC.platform).toBe('pbc-epzb');
    expect(JSON.stringify(PBC)).not.toMatch(/accela/i);
  });
});

// Verbatim from case C-2023-07120016 at 12571 Orange Grove Blvd, read
// 2026-11-09. Keeping the real text means a parser change has to survive the
// real page, not a tidied-up version of it.
const CASE_TEXT = `Code Compliance - Compliance Detail
C-2023-07120016Fine
Complaint Date: 7/12/2023

 Situs Address
Address
12571 Orange Grove Blvd, West Palm Beach, FL 33411
Owner
Lazaro R Roque
PCN
00-41-43-10-00-000-4180
Zoning
Agricultural Residential District
 Respondents
Name
Lazaro Roque
Lazaro Martinez
 Violations
Status
Closed
Violation
3/18/2022 | Construction work without Permits
Details
Any owner or authorized agent who intends to construct... More specifically a cement block and wire fence in the front yard with two pairs of metal gates has been erected or installed without a valid building permit.
Codes
PBCAFBC20-105.1: PBC Amendments to FBC 7th Edition (2020)
Closed
9/9/2026 | The respondent has obtained the permit.
Status
Closed
Violation
12/29/2021 | Expired Permit
Details
Every permit issued shall become invalid... More specifically, permit #B2021-0174444-0000 for 4 ft and 6 ft metal fence and gates has become inactive or expired.
Codes
PBCAFBC20-105.4.1: PBC Amendments to FBC 7th Edition (2020)
Closed
9/9/2026 | The respondent has obtained the permit.
Status
Closed
Violation
1/4/2022 | Openly stored trash and debris
Details
It shall be unlawful... More specifically construction debris near the shed.
Codes
PBCPMC-Section 14-35 (a): Palm Beach County Property Maintenance Code
Closed
7/14/2023 | Cited in error.

ePZB Code Compliance`;

describe('case detail parsing', () => {
  const d = parseCaseDetailText(CASE_TEXT);

  it('reads the parcel identity fields', () => {
    expect(d.pcn).toBe('00-41-43-10-00-000-4180');
    expect(d.owner).toBe('Lazaro R Roque');
    expect(d.zoning).toBe('Agricultural Residential District');
  });

  it('collects every cited code section verbatim, without duplicates', () => {
    expect(d.codes).toContain('PBCAFBC20-105.1: PBC Amendments to FBC 7th Edition (2020)');
    expect(d.codes).toContain('PBCAFBC20-105.4.1: PBC Amendments to FBC 7th Edition (2020)');
    expect(d.codes).toContain('PBCPMC-Section 14-35 (a): Palm Beach County Property Maintenance Code');
    expect(new Set(d.codes).size).toBe(d.codes.length);
  });

  it('keeps the narrative that names the actual structure', () => {
    // This sentence is the whole reason to open the case: it says what was
    // built, which is what an engineer needs to scope the after-the-fact work.
    expect(d.details).toMatch(/cement block and wire fence/);
    expect(d.details).toMatch(/permit #B2021-0174444-0000/);
  });

  it('takes the earliest violation date as the opened date', () => {
    expect(d.openedDate).toBe('12/29/2021');
  });

  it('takes the most recent resolution as the last action', () => {
    expect(d.lastAction).toBe('Cited in error.');
  });

  it('invents nothing when the page is empty', () => {
    const empty = parseCaseDetailText('');
    expect(empty.codes).toEqual([]);
    expect(empty.details).toBeNull();
    expect(empty.pcn).toBeNull();
    expect(empty.openedDate).toBeNull();
    expect(empty.lastAction).toBeNull();
  });

  it('never invents a dollar amount, because the free tier never prints one', () => {
    // Status reads "Fine" but the figure is behind the county's $65 certified
    // search. Anything that looked like an amount here would be fabricated.
    expect(JSON.stringify(d)).not.toMatch(/\$\s*[\d,]+/);
  });
});
