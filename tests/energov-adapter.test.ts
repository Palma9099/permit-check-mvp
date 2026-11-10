// Tyler EnerGov Citizen Self Service adapter.
//
// This adapter exists because of one report. 135 W 60 ST, Hialeah came back
// "Code and liens: None open", in green, because only Miami-Dade County was
// searched and the county is not the code authority inside Hialeah. The city
// publishes its cases on EnerGov, and the one it held was not minor:
//
//   BWOP-001873-2025  "Building Without A Permit"  status: Lien
//   parcel 0421310020800
//   "Failure to obtain permits for addition to detached garage, shed, and
//    concrete slab on northwest corner of property."
//
// The fixtures below are that response, verbatim.
//
// The platform's trap is that module 5 (Code Case) is per-tenant: Hialeah has
// it on, St Lucie County has it off. Assuming it exists means searching
// nothing and reporting a clean property.
//
// The live selector check is worker/src/smoke-energov.ts.

import { describe, expect, it } from 'vitest';
import {
  MODULE,
  moduleIdsFrom,
  hasCodeModule,
  parseSearchResponse,
  isEncumbering,
  isoDay,
  noCodeModuleNote,
  coverageNote,
  truncationNote,
  evidenceFor,
  evidenceSupportsRouting,
  searchUrl,
  type EnergovTenant,
} from '../worker/src/scrapers/energov-parse.js';
import {
  ENERGOV_TENANTS,
  CITY_JURISDICTIONS,
  resolveJurisdiction,
  type EnergovJurisdiction,
} from '../worker/src/scrapers/jurisdictions.js';

const HIALEAH = ENERGOV_TENANTS.hialeah;
const ST_LUCIE = ENERGOV_TENANTS['st-lucie'];

describe('module sets are per-tenant', () => {
  it('reads Angular-style option values', () => {
    expect(moduleIdsFrom(['number:1', 'number:5', 'number:11'])).toEqual([1, 5, 11]);
  });

  it('reads plain values too', () => {
    expect(moduleIdsFrom(['1', '5'])).toEqual([1, 5]);
  });

  it('ignores a blank placeholder option', () => {
    expect(moduleIdsFrom(['', 'number:2'])).toEqual([2]);
  });

  it('sees Code Case on Hialeah and not on St Lucie', () => {
    // The gap at 5 in the St Lucie list is the whole point.
    expect(hasCodeModule(HIALEAH.modules)).toBe(true);
    expect(hasCodeModule(ST_LUCIE.modules)).toBe(false);
    expect(ST_LUCIE.modules).not.toContain(MODULE.CodeCase);
  });
});

describe('refusing a tenant with Code Case switched off', () => {
  it('says nothing was checked rather than nothing was found', () => {
    const n = noCodeModuleNote(ST_LUCIE);
    expect(n).toMatch(/checked nothing here/i);
    expect(n).toMatch(/not the same as the property being clear/i);
  });

  it('names the tenant so the reader knows who to ask', () => {
    expect(noCodeModuleNote(ST_LUCIE)).toMatch(/St Lucie County/);
  });
});

// Verbatim from Hialeah, 2026-11-09.
const REAL_RESPONSE = {
  Result: {
    EntityResults: [
      {
        CaseId: '4172d73c-da78-4b3d-b0e0-eed3c8adadfe',
        CaseNumber: 'BWOP-001873-2025',
        CaseType: 'Building Without A Permit',
        CaseStatus: 'Lien',
        ApplyDate: '2025-05-08T07:38:08',
        Address: { AddressLine1: '135 W 60 ST', City: 'Hialeah', StateName: 'FL', PostalCode: '33012', FullAddress: '135 W 60 ST Hialeah FL 33012' },
        AddressDisplay: '135 W 60 ST Hialeah FL 33012',
        MainParcel: '0421310020800',
        Description:
          'Failure to obtain permits for addition to detached garage, shed, and concrete slab on northwest corner of property.',
        ModuleName: 5,
      },
    ],
    TotalPages: 1,
    PermitsFound: 0,
    CodeCasesFound: 1,
    TotalFound: 1,
  },
  Success: true,
};

// What the portal returns when it refuses, HTTP 200, roughly one run in three.
const REFUSAL = { Result: null, Success: false, ErrorMessage: '', StatusCode: 200 };

describe('the case the report missed', () => {
  const parsed = parseSearchResponse(REAL_RESPONSE);

  it('is found', () => {
    expect(parsed.ok).toBe(true);
    expect(parsed.cases).toHaveLength(1);
    expect(parsed.counts.codeCases).toBe(1);
  });

  it('carries the facts that matter', () => {
    expect(parsed.cases[0]).toEqual({
      caseNumber: 'BWOP-001873-2025',
      caseType: 'Building Without A Permit',
      status: 'Lien',
      appliedDate: '2025-05-08',
      address: '135 W 60 ST Hialeah FL 33012',
      parcel: '0421310020800',
      description:
        'Failure to obtain permits for addition to detached garage, shed, and concrete slab on northwest corner of property.',
    });
  });

  it('keeps the parcel, so the case can be joined to a property', () => {
    // Matches the property appraiser strap 04-2131-002-0800.
    expect(parsed.cases[0].parcel).toBe('0421310020800');
  });

  it('flags a recorded lien as encumbering', () => {
    expect(isEncumbering('Lien')).toBe(true);
    expect(isEncumbering('Special Magistrate')).toBe(true);
    expect(isEncumbering('Closed')).toBe(false);
    expect(isEncumbering(null)).toBe(false);
  });

  it('invents no dollar amount, because EnerGov publishes none', () => {
    expect(JSON.stringify(parsed.cases)).not.toMatch(/\$\s*[\d,]+/);
  });
});

describe('a refusal is never an empty result', () => {
  it('reports Success:false as unreadable, not as zero cases', () => {
    const p = parseSearchResponse(REFUSAL);
    expect(p.ok).toBe(false);
    expect(p.cases).toEqual([]);
  });

  it('treats a missing body the same way', () => {
    expect(parseSearchResponse(null).ok).toBe(false);
    expect(parseSearchResponse({}).ok).toBe(false);
  });

  it('reads a genuine zero as ok with no cases', () => {
    const p = parseSearchResponse({ Result: { EntityResults: [], CodeCasesFound: 0, TotalFound: 0 }, Success: true });
    expect(p.ok).toBe(true);
    expect(p.cases).toEqual([]);
  });
});

describe('only code cases come back from a code search', () => {
  it('drops a permit row that an All search would include', () => {
    const mixed = {
      Result: {
        EntityResults: [
          { CaseNumber: 'P-1', ModuleName: 2, CaseType: 'Permit' },
          { CaseNumber: 'C-1', ModuleName: 5, CaseType: 'Code' },
        ],
        CodeCasesFound: 1,
        TotalFound: 2,
      },
      Success: true,
    };
    const p = parseSearchResponse(mixed);
    expect(p.cases.map((c) => c.caseNumber)).toEqual(['C-1']);
  });
});

describe('dates', () => {
  it('trims an EnerGov timestamp to the day', () => {
    expect(isoDay('2025-05-08T07:38:08')).toBe('2025-05-08');
  });

  it('leaves anything else alone and nulls the empties', () => {
    expect(isoDay('05/08/2025')).toBe('05/08/2025');
    expect(isoDay(null)).toBeNull();
    expect(isoDay('')).toBeNull();
  });
});

describe('what an empty result means', () => {
  it('a city tenant covers the whole city', () => {
    const n = coverageNote(HIALEAH, true);
    expect(n).toMatch(/whole city/i);
    expect(n).not.toMatch(/unincorporated/i);
  });

  it('a county tenant warns that a city is not covered', () => {
    const county: EnergovTenant = { ...ST_LUCIE, modules: [5] };
    expect(coverageNote(county, true)).toMatch(/unincorporated St Lucie County/);
    expect(coverageNote(county, true)).toMatch(/says nothing about the property/);
  });
});

describe('routing: a city beats its county, but only when we know the city', () => {
  it('sends a Hialeah parcel to Hialeah', () => {
    const j = resolveJurisdiction('miami-dade', 'HIALEAH') as EnergovJurisdiction;
    expect(j.platform).toBe('energov');
    expect(j.tenant.host).toContain('hialeahfl');
  });

  it('is case and space insensitive about the municipality', () => {
    expect(resolveJurisdiction('miami-dade', ' hialeah ')?.platform).toBe('energov');
  });

  it('falls back to the county when the municipality is unknown', () => {
    // Never guess a city from an address; an unknown city means county rules.
    expect(resolveJurisdiction('miami-dade', null)?.platform).not.toBe('energov');
    expect(resolveJurisdiction('miami-dade', 'SWEETWATER')?.platform).not.toBe('energov');
  });

  it('builds the portal link from the tenant host', () => {
    expect(searchUrl(HIALEAH)).toBe('https://hialeahfl-energovpub.tylerhost.net/apps/selfservice#/search');
  });

  it('gives the Hialeah jurisdiction a usable portal link', () => {
    const j = CITY_JURISDICTIONS['miami-dade:HIALEAH'] as EnergovJurisdiction;
    expect(j.portalLinks.some((l) => l.url.includes('hialeahfl-energovpub'))).toBe(true);
  });
});

describe('a paged result is never presented as the whole list', () => {
  it('says so when the portal holds more than it returned', () => {
    // Miami Beach reported 21,537 cases for a street keyword and returned 10.
    const n = truncationNote(10, 21537, 'City of Miami Beach');
    expect(n).toMatch(/21537 matching code cases/);
    expect(n).toMatch(/do not read this list as complete/i);
  });

  it('stays quiet when we read everything', () => {
    expect(truncationNote(1, 1, 'City of Hialeah')).toBeNull();
    expect(truncationNote(0, 0, 'City of Hialeah')).toBeNull();
  });
});

describe('the Self Service path is per-tenant', () => {
  it('defaults to the Tyler-hosted path', () => {
    expect(searchUrl(ENERGOV_TENANTS['coral-gables'])).toBe(
      'https://coralgablesfl-energovpub.tylerhost.net/apps/selfservice#/search',
    );
  });

  it('honours a self-hosted tenant on its own domain and path', () => {
    // Miami Beach runs EnerGov itself, not on tylerhost.net.
    expect(searchUrl(ENERGOV_TENANTS['miami-beach'])).toBe(
      'https://energovcss.miamibeachfl.gov/energovprod/selfservice#/search',
    );
  });

  it('handles the energovWEB host suffix', () => {
    expect(ENERGOV_TENANTS.doral.host).toContain('energovweb');
  });
});

describe('the three Miami-Dade cities route and are usable', () => {
  const cities = [
    ['MIAMI BEACH', 'City of Miami Beach'],
    ['CORAL GABLES', 'City of Coral Gables'],
    ['DORAL', 'City of Doral'],
    ['HIALEAH', 'City of Hialeah'],
  ] as const;

  for (const [muni, name] of cities) {
    it(`${name} routes from its municipality and exposes Code Case`, () => {
      const j = resolveJurisdiction('miami-dade', muni) as EnergovJurisdiction;
      expect(j.platform).toBe('energov');
      expect(j.name).toBe(name);
      expect(hasCodeModule(j.tenant.modules)).toBe(true);
      expect(j.tenant.kind).toBe('city');
    });

    it(`${name} carries a working portal link`, () => {
      const j = resolveJurisdiction('miami-dade', muni) as EnergovJurisdiction;
      expect(j.portalLinks[0].url).toBe(searchUrl(j.tenant));
    });
  }

  it('still falls back to the county for a Miami-Dade city we have not wired', () => {
    expect(resolveJurisdiction('miami-dade', 'SWEETWATER')?.platform).not.toBe('energov');
  });
});

// ---------------------------------------------------------------------------
// Codex EnerGov round 4, F-01. A FALSE PASS IN THE TOOL BUILT TO STOP FALSE
// PASSES.
//
// After a review round was stopped on Maitland - routed while the only frozen
// transcript refused it - the rule became: a city is routed only if the
// attached transcript shows the production adapter reading it. I wrote a
// checker to enforce it and the checker read `if (usable) continue`, so one
// USABLE line won regardless of a REFUSED line for the same city. Codex
// reproduced it by appending a Pembroke Pines refusal to the transcript and
// getting "every routed city is shown reading", exit 0.
//
// That is worse than having no checker, because it launders the exact claim
// it exists to test. These tests exist so the checker's own correctness is
// pinned rather than asserted.
// ---------------------------------------------------------------------------
describe('F-01: the evidence checker cannot be talked into a pass', () => {
  const USABLE = 'USABLE   Pembroke Pines           171178  "PINES BLVD" -> 10 case(s)';
  const REFUSED = 'REFUSED  Pembroke Pines           171178  portal unreadable on this run';

  it('supports a city the transcript shows reading', () => {
    expect(evidenceFor(USABLE, 'City of Pembroke Pines')).toBe('supported');
    expect(evidenceSupportsRouting('supported')).toBe(true);
  });

  it('refuses a city the transcript refuses', () => {
    expect(evidenceFor(REFUSED, 'City of Pembroke Pines')).toBe('refused');
    expect(evidenceSupportsRouting('refused')).toBe(false);
  });

  it('refuses a city absent from the transcript', () => {
    expect(evidenceFor('USABLE   Doral  75874  "NW 53 ST" -> 10 case(s)', 'City of Pembroke Pines')).toBe('absent');
    expect(evidenceSupportsRouting('absent')).toBe(false);
  });

  it('CODEX TRIGGER: both lines present does not pass', () => {
    // Exactly what was appended to the attached transcript to break it.
    const both = `${USABLE}\n${REFUSED}`;
    expect(evidenceFor(both, 'City of Pembroke Pines')).toBe('contradictory');
    expect(evidenceSupportsRouting('contradictory')).toBe(false);
  });

  it('order does not rescue it either', () => {
    const both = `${REFUSED}\n${USABLE}`;
    expect(evidenceFor(both, 'City of Pembroke Pines')).toBe('contradictory');
  });

  it('strips the City of / Town of / Village of prefix the transcript omits', () => {
    expect(evidenceFor('USABLE   Longboat Key   7505  "x" -> 0 case(s)', 'Town of Longboat Key')).toBe('supported');
    expect(evidenceFor('USABLE   Wellington     61637 "x" -> 1 case(s)', 'Village of Wellington')).toBe('supported');
  });

  it('does not match one city on another city\'s line', () => {
    // "Miami Gardens" must not be satisfied by a "Miami Beach" line.
    const line = 'USABLE   Miami Beach              82890  "WASHINGTON AVE" -> 10 case(s)';
    expect(evidenceFor(line, 'City of Miami Gardens')).toBe('absent');
  });

  it('only matches at the start of a line, so prose cannot satisfy it', () => {
    const prose = 'a note mentioning USABLE Pembroke Pines in passing should not count';
    expect(evidenceFor(prose, 'City of Pembroke Pines')).toBe('absent');
  });
});
