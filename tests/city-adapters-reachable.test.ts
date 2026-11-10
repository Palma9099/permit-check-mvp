// The product read 36 cities and could not be asked to read any of them.
//
// Three separate links in one chain were broken, and each one on its own
// produced the same visible result: a city address answered as if nobody could
// look it up.
//
//   1. `scan_jobs` had no municipality column, so every deep-scan job arrived
//      without one and `resolveJurisdiction` fell back to the county. For a
//      City of Tampa address that ran HILLSBOROUGH COUNTY's code search, which
//      covers unincorporated Hillsborough only and holds none of Tampa.
//   2. The deep-scan route never resolved a municipality at all.
//   3. `code-authority.ts` kept its own hand-written list of city portals with
//      ONE entry in it, so the report told readers to go ask Tampa about
//      records this product reads on request.
//
// These tests hold each link, and the first group holds the line that matters
// most: knowing we COULD read a city is not having read it. The verdict stays
// unchecked and amber either way.

import { describe, it, expect } from 'vitest';
import {
  codeVerdict,
  verdictTone,
  verdictValue,
  verdictBuyerNote,
  verdictOwnerNote,
  type CodeAuthority,
} from '../src/lib/code-authority';
import { cityCodeCoverage, citiesWithCodeCoverage } from '../src/lib/city-code-portals';
import { CITY_CODE_COVERAGE } from '../src/lib/city-code-coverage.generated';
import { buildCoverage } from '../scripts/gen-city-code-coverage';
import { resolveJurisdiction } from '../worker/src/scrapers/jurisdictions.js';
import { enqueueScan } from '../src/lib/scan-queue';
import { installSupabaseStub } from './supabase-stub';

/** A city parcel the fast path did not read: the case this whole module is about. */
function cityUnread(municipality: string, countyKey: string | null): CodeAuthority {
  return {
    municipality,
    cityGoverns: true,
    cityChecked: false,
    countyChecked: true,
    municipalityKnown: true,
    cityCoverage: cityCodeCoverage(municipality, countyKey),
  };
}

describe('coverage changes the advice, never the verdict', () => {
  it('a city we can read is still NOT clear until someone reads it', () => {
    const v = codeVerdict(cityUnread('TAMPA', 'hillsborough'), 0, 0);

    // The whole point. An adapter existing is not a search happening.
    expect(v.kind).toBe('unchecked');
    expect(verdictTone(v)).toBe('amber');
    expect(verdictValue(v)).toBe('Not checked');
    expect(verdictBuyerNote(v)).toContain('NOT a clean result');
    expect(verdictBuyerNote(v)).toContain('nobody has looked');
  });

  it('full coverage can never reach the green branch', () => {
    // Belt and braces: drive the covered authority through the clear path's
    // own precondition and confirm it is the SEARCH, not the coverage, that
    // earns green.
    const unread = codeVerdict(cityUnread('TAMPA', 'hillsborough'), 0, 0);
    expect(verdictTone(unread)).toBe('amber');

    const read = codeVerdict({ ...cityUnread('TAMPA', 'hillsborough'), cityChecked: true }, 0, 0);
    expect(read.kind).toBe('clear');
    expect(verdictTone(read)).toBe('green');
  });

  it('a hit outranks coverage', () => {
    const v = codeVerdict(cityUnread('TAMPA', 'hillsborough'), 1, 0);
    expect(v.kind).toBe('hits');
    expect(verdictTone(v)).toBe('red');
  });
});

describe('what the reader is told to do next', () => {
  it('stops sending readers away from an answer we hold', () => {
    const v = codeVerdict(cityUnread('TAMPA', 'hillsborough'), 0, 0);
    const buyer = verdictBuyerNote(v);

    // The old text for Tampa, verbatim, was "Ask Tampa directly, or order the
    // full lien search" - advice to go do by hand what the deep scan does.
    expect(buyer).not.toContain('Ask Tampa directly');
    expect(buyer).toContain('deep scan');
    expect(verdictOwnerNote(v)).toContain('deep scan');
  });

  it('offers the city its own portal link, not a county stand-in', () => {
    const v = codeVerdict(cityUnread('TAMPA', 'hillsborough'), 0, 0);
    if (v.kind !== 'unchecked') throw new Error('expected unchecked');
    expect(v.portalUrl).toBeTruthy();
    expect(v.portalUrl).toContain('TAMPA');
    expect(verdictBuyerNote(v)).toContain(v.portalUrl as string);
  });

  it('a city with no adapter still says so plainly', () => {
    // Plant City is a real Hillsborough municipality with no adapter. It must
    // read as a dead end, because for us it is one.
    const v = codeVerdict(cityUnread('PLANT CITY', 'hillsborough'), 0, 0);
    if (v.kind !== 'unchecked') throw new Error('expected unchecked');
    expect(v.deepScanReads).toBe(false);
    expect(v.portalUrl).toBeNull();
    expect(verdictBuyerNote(v)).toContain('Ask Plant City directly');
    expect(verdictBuyerNote(v)).not.toContain('deep scan');
  });

  it('never claims a scan reaches an authority we never identified', () => {
    const v = codeVerdict(
      {
        municipality: null,
        cityGoverns: false,
        cityChecked: false,
        countyChecked: true,
        municipalityKnown: false,
        cityCoverage: null,
      },
      0,
      0,
    );
    if (v.kind !== 'unchecked') throw new Error('expected unchecked');
    expect(v.deepScanReads).toBe(false);
    expect(verdictBuyerNote(v)).not.toContain('deep scan');
  });
});

describe('the coverage lookup asks the registry, and asks it precisely', () => {
  it('reads Tampa, which the hand-written list never did', () => {
    const cov = cityCodeCoverage('TAMPA', 'hillsborough');
    expect(cov).not.toBeNull();
    expect(cov!.deepScanReads).toBe(true);
    expect(cov!.platform).toBe('accela');
  });

  it('refuses to answer without a county instead of guessing', () => {
    // Two Florida counties can hold places of the same name, so a city name
    // alone is not a key. Longboat Key is in the registry twice.
    expect(cityCodeCoverage('TAMPA', null)).toBeNull();
    expect(cityCodeCoverage('TAMPA', '')).toBeNull();
    expect(cityCodeCoverage(null, 'hillsborough')).toBeNull();
  });

  it('keeps a county-straddling town separate under each county', () => {
    const manatee = cityCodeCoverage('LONGBOAT KEY', 'manatee');
    const sarasota = cityCodeCoverage('LONGBOAT KEY', 'sarasota');
    expect(manatee).not.toBeNull();
    expect(sarasota).not.toBeNull();
  });

  it('is case and whitespace tolerant, because appraisers are not tidy', () => {
    expect(cityCodeCoverage('  tampa ', ' Hillsborough ')).not.toBeNull();
  });

  it('every city it advertises has a real link behind it', () => {
    // A city routed with a null portal would hand the reader an honest refusal
    // and nothing to do about it. That happened once already: csLinks was
    // pinned to a dead citizenserve shard, so a refusal came with a broken
    // link attached.
    const keys = citiesWithCodeCoverage();
    expect(keys.length).toBeGreaterThan(30);
    const dead: string[] = [];
    for (const key of keys) {
      const [county, muni] = key.split(':');
      const cov = cityCodeCoverage(muni, county);
      if (!cov || !cov.portalUrl || !/^https:\/\//.test(cov.portalUrl)) dead.push(key);
    }
    expect(dead).toEqual([]);
  });
});

describe('the committed coverage data still matches the registry', () => {
  // This is the test that makes a generated copy safe to keep. The file it
  // replaced was a hand-written list that sat at one entry while the registry
  // grew to 36, and the only reason that could happen is that nothing compared
  // them. This compares them.
  it('is byte-for-byte what the registry produces today', () => {
    expect(CITY_CODE_COVERAGE).toEqual(buildCoverage());
  });

  it('would notice a city added to the registry but not regenerated', () => {
    // Proving the comparison has teeth, rather than asserting it does: a city
    // the registry knows and the committed file does not must break the test
    // above, so simulate exactly that drift.
    const drifted = buildCoverage().filter((r) => r.key !== 'hillsborough:TAMPA');
    expect(CITY_CODE_COVERAGE).not.toEqual(drifted);
  });
});

describe('the worker can be asked for the city, not just the county', () => {
  it('a municipality picks the city adapter', () => {
    const city = resolveJurisdiction('hillsborough', 'TAMPA');
    expect(city?.name).toBe('City of Tampa');
  });

  it('without one it falls back to the county, which is the bug this fixes', () => {
    // Documenting the fallback, not endorsing it: Hillsborough County's search
    // covers unincorporated county only. Every deep-scan job used to land here.
    const county = resolveJurisdiction('hillsborough', null);
    expect(county?.name).toBe('Hillsborough County');
    expect(county?.name).not.toBe('City of Tampa');
  });

  it('every city in the coverage list is reachable by its own key', () => {
    for (const key of citiesWithCodeCoverage()) {
      const [countyKey, muni] = key.split(':');
      const jur = resolveJurisdiction(countyKey, muni);
      expect(jur, `no adapter resolved for ${key}`).toBeTruthy();
      expect(jur!.name, `${key} resolved to a county adapter`).not.toMatch(/\bCounty$/);
    }
  });
});

describe('the queue carries the municipality to the worker', () => {
  it('sends it on the insert', async () => {
    const stub = installSupabaseStub();
    try {
      await enqueueScan({
        email: 'buyer@example.invalid',
        address: '315 E Kennedy Blvd, Tampa, FL',
        county: 'hillsborough',
        municipality: 'TAMPA',
        lat: 27.9478,
        lng: -82.4584,
      });
      const post = stub.calls.find((c) => c.method === 'POST' && /scan_jobs/.test(c.url));
      expect(post, 'no insert was sent').toBeTruthy();
      // The assertion that would have caught the original bug.
      expect(post!.body.municipality).toBe('TAMPA');
      expect(post!.body.county).toBe('hillsborough');
    } finally {
      stub.restore();
    }
  });

  it('sends null rather than inventing one', async () => {
    const stub = installSupabaseStub();
    try {
      await enqueueScan({ email: 'buyer@example.invalid', address: 'somewhere, FL', county: 'hillsborough' });
      const post = stub.calls.find((c) => c.method === 'POST' && /scan_jobs/.test(c.url));
      expect(post!.body.municipality).toBeNull();
    } finally {
      stub.restore();
    }
  });
});
