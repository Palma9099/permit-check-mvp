// The instant report could not name the city that enforces code.
//
// PR #17 made the 36 city code adapters reachable and taught the report to say
// so. Live production proved it only ever fired in Miami-Dade:
//
//   315 E Kennedy Blvd, Tampa    -> property.municipality = null
//   501 Palm Ave, Hialeah        -> property.municipality = "HIALEAH"
//
// Only `miami-dade-adapter.ts` fills that field. `statewide-adapter.ts` returns
// null, correctly - the FL DOR cadastral roll has no municipality column. So
// `cityGoverns` was false for every address outside one county, and a City of
// Tampa buyer was told nobody could even be identified, while the deep scan
// reads Tampa's own code records on request.
//
// The boundary lookup already existed and was already wired into the deep-scan
// enqueue and the lien provider. The code axis was the one path that never
// learned the city. These tests pin the resolver's rules, the copy that an
// unidentified authority gets, and the end-to-end advice a Tampa reader sees.

import { describe, it, expect } from 'vitest';
import { governingMunicipality } from '@/lib/lien-providers/municipality';
import {
  codeVerdict,
  verdictBuyerNote,
  verdictOwnerNote,
  verdictDetail,
  verdictTone,
  cityGoverns,
  municipalityKnown,
  countyLabel,
  type CodeAuthority,
} from '@/lib/code-authority';
import { cityCodeCoverage } from '@/lib/city-code-portals';

const TAMPA = { lat: 27.9478, lng: -82.4584 };

describe('the resolver that lets the report name a city', () => {
  it('keeps the county record when it names a municipality', async () => {
    let called = false;
    const got = await governingMunicipality('HIALEAH', TAMPA, async () => {
      called = true;
      return 'Somewhere Else';
    });
    // The Property Appraiser is the primary source for its own parcels. An
    // inference must not overwrite it, and must not even be attempted.
    expect(got).toBe('HIALEAH');
    expect(called).toBe(false);
  });

  it('fills a blank record from the parcel point', async () => {
    const got = await governingMunicipality(null, TAMPA, async (lat, lng) => {
      expect(lat).toBe(TAMPA.lat);
      expect(lng).toBe(TAMPA.lng);
      return 'Tampa';
    });
    expect(got).toBe('Tampa');
  });

  it('treats an empty string in the record as a blank, not as an answer', async () => {
    expect(await governingMunicipality('   ', TAMPA, async () => 'Tampa')).toBe('Tampa');
  });

  it('stays null when the boundary source throws', async () => {
    // municipalityAt throws when the source does not answer. A thrown lookup
    // must never surface as "unincorporated".
    const got = await governingMunicipality(null, TAMPA, async () => {
      throw new Error('tigerweb down');
    });
    expect(got).toBeNull();
    expect(municipalityKnown(got)).toBe(false);
  });

  it('stays null for a parcel outside every city', async () => {
    expect(await governingMunicipality(null, TAMPA, async () => null)).toBeNull();
  });

  it('does not invent a point when none is known', async () => {
    let called = false;
    const got = await governingMunicipality(null, null, async () => {
      called = true;
      return 'Tampa';
    });
    expect(got).toBeNull();
    expect(called).toBe(false);
  });

  it('refuses a non-finite point rather than querying with NaN', async () => {
    let called = false;
    const got = await governingMunicipality(null, { lat: NaN, lng: -82.4 }, async () => {
      called = true;
      return 'Tampa';
    });
    expect(got).toBeNull();
    expect(called).toBe(false);
  });
});

/** The CodeAuthority the report builds once the city is known. */
function authorityFor(municipality: string | null): CodeAuthority {
  return {
    municipality,
    cityGoverns: cityGoverns(municipality),
    cityChecked: false,
    countyChecked: true,
    municipalityKnown: municipalityKnown(municipality),
    cityCoverage: cityCodeCoverage(municipality, 'hillsborough'),
  };
}

describe('what a Tampa reader is told, end to end', () => {
  it('names Tampa and offers the scan once the city is resolved', () => {
    const v = codeVerdict(authorityFor('Tampa'), 0, 0);
    const buyer = verdictBuyerNote(v);

    expect(buyer).toContain('Tampa');
    expect(buyer).toContain('deep scan');
    // This is the exact sentence production served before the fix.
    expect(buyer).not.toContain('could not establish which authority');
    expect(verdictOwnerNote(v)).toContain('Tampa');
  });

  it('still reads amber, because naming the authority is not searching it', () => {
    // The verdict must not improve just because we now know who to ask.
    expect(verdictTone(codeVerdict(authorityFor('Tampa'), 0, 0))).toBe('amber');
    expect(verdictTone(codeVerdict(authorityFor(null), 0, 0))).toBe('amber');
    expect(codeVerdict(authorityFor('Tampa'), 0, 0).kind).toBe('unchecked');
  });

  it('a found violation still outranks any of this', () => {
    expect(codeVerdict(authorityFor('Tampa'), 1, 0).kind).toBe('hits');
    expect(verdictTone(codeVerdict(authorityFor('Tampa'), 0, 2))).toBe('red');
  });
});

describe('an authority we never identified gets a sentence that reads', () => {
  // Both unnamed branches, because they produce DIFFERENT placeholder strings
  // and my first version of this test only checked one of them and passed on
  // the restored bug.
  //
  //   nothing searched at all           -> "the code authority"
  //   county searched, city unknown     -> "the city or county that governs this address"
  //
  // Live Tampa was the FIRST of these (countyCodeChecked was false), which is
  // why asserting against the second one alone proved nothing.
  const cases: Array<[string, CodeAuthority]> = [
    ['nothing searched at all', { ...authorityFor(null), countyChecked: false }],
    ['county searched, city never identified', authorityFor(null)],
  ];

  for (const [label, authority] of cases) {
    const v = codeVerdict(authority, 0, 0);

    it(`${label}: never calls a placeholder the code authority`, () => {
      // The live sentence was "the code authority is the code authority for
      // this address". The defect is the PHRASE, whatever placeholder fills it,
      // so assert the phrase cannot appear at all when nothing was named.
      expect(verdictBuyerNote(v)).not.toContain('is the code authority for this address');
    });

    it(`${label}: says plainly that nobody was identified or searched`, () => {
      const buyer = verdictBuyerNote(v);
      expect(buyer).toContain('We could not establish which authority enforces code at this address');
      expect(buyer).toContain('NOT a clean result');
      expect(buyer).toContain('Confirm which city or county governs this address');
      // It must not claim a scan reaches an authority never identified.
      expect(buyer).not.toContain('deep scan');
      if (v.kind !== 'unchecked') throw new Error('expected unchecked');
      expect(v.authorityNamed).toBe(false);
      expect(v.deepScanReads).toBe(false);
      expect(v.portalUrl).toBeNull();
    });

    it(`${label}: does not make the unknown authority a sentence subject`, () => {
      expect(verdictDetail(v, false)).toContain('did not establish');
      expect(verdictDetail(v, false)).not.toMatch(/^the (code authority|city or county)/);
      expect(verdictOwnerNote(v)).toContain('did not establish');
      expect(verdictOwnerNote(v)).not.toMatch(/^the (code authority|city or county)/);
    });

    it(`${label}: still amber, never clear`, () => {
      expect(v.kind).toBe('unchecked');
      expect(verdictTone(v)).toBe('amber');
    });
  }

  it('marks a named authority as named and keeps its wording', () => {
    const named = codeVerdict(authorityFor('Tampa'), 0, 0);
    if (named.kind !== 'unchecked') throw new Error('expected unchecked');
    expect(named.authorityNamed).toBe(true);
    expect(verdictBuyerNote(named)).toContain('Tampa is the code authority for this address');
    expect(verdictDetail(named, false)).toMatch(/^Tampa enforces code here/);
  });
});

describe('an explicitly unincorporated parcel has a KNOWN authority', () => {
  // Codex R1 P2-2. "UNINCORPORATED" from the appraiser is positive evidence
  // that the county governs. My R1 copy called that "we could not establish
  // which authority", which is not vague but false, and false in all three
  // notes. The flag had to separate jurisdiction-known from has-a-city-name.
  function unincorporated(countyName: string | null) {
    return codeVerdict(
      {
        municipality: 'UNINCORPORATED',
        cityGoverns: cityGoverns('UNINCORPORATED'),
        municipalityKnown: municipalityKnown('UNINCORPORATED'),
        cityChecked: false,
        countyChecked: false,
        cityCoverage: null,
        countyName,
      },
      0,
      0,
    );
  }

  for (const [label, countyName, expected] of [
    ['with a county name', 'Hillsborough County', 'Hillsborough County'],
    ['without one', null, 'the county'],
  ] as const) {
    const v = unincorporated(countyName);

    it(`${label}: names the county as the authority`, () => {
      if (v.kind !== 'unchecked') throw new Error('expected unchecked');
      expect(v.authority).toBe(expected);
      // We know WHO governs. That is the whole point of the flag.
      expect(v.authorityNamed).toBe(true);
    });

    it(`${label}: never claims the authority is unknown`, () => {
      for (const text of [verdictBuyerNote(v), verdictDetail(v, false), verdictOwnerNote(v)]) {
        expect(text).not.toContain('could not establish');
        expect(text).not.toContain('did not establish');
        expect(text).not.toContain('Confirm which city or county governs');
      }
    });

    it(`${label}: says the governing county was not searched, and stays amber`, () => {
      expect(verdictBuyerNote(v)).toContain('we could not search its records');
      expect(verdictDetail(v, false)).toContain('records were not searched');
      expect(verdictOwnerNote(v)).toContain('treat this as unknown rather than clear');
      expect(verdictTone(v)).toBe('amber');
      expect(v.kind).toBe('unchecked');
    });

    it(`${label}: offers no deep scan, which reads CITY records`, () => {
      if (v.kind !== 'unchecked') throw new Error('expected unchecked');
      expect(v.deepScanReads).toBe(false);
      expect(v.portalUrl).toBeNull();
      expect(verdictBuyerNote(v)).not.toContain('deep scan');
    });

    it(`${label}: starts its sentences with a capital`, () => {
      for (const text of [verdictBuyerNote(v), verdictDetail(v, false), verdictOwnerNote(v)]) {
        expect(text.charAt(0)).toBe(text.charAt(0).toUpperCase());
      }
    });
  }

  it('an unincorporated parcel whose county WAS searched is clear', () => {
    // Nothing above should have disturbed this: the authority was asked.
    const v = codeVerdict(
      {
        municipality: 'UNINCORPORATED',
        cityGoverns: false,
        municipalityKnown: true,
        cityChecked: false,
        countyChecked: true,
        cityCoverage: null,
        countyName: 'Hillsborough County',
      },
      0,
      0,
    );
    expect(v.kind).toBe('clear');
  });
});

describe('countyLabel', () => {
  it('does not double the word County', () => {
    expect(countyLabel('Hillsborough County')).toBe('Hillsborough County');
    expect(countyLabel('Hillsborough')).toBe('Hillsborough County');
  });

  it('falls back to a true phrase when no name is known', () => {
    expect(countyLabel(null)).toBe('the county');
    expect(countyLabel('   ')).toBe('the county');
  });
});
