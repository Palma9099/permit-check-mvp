// Naming the code office that actually covers a Broward parcel.
//
// The report used to say "Ask the city directly, or order the full lien
// search." That sentence is true and nearly useless: no name, no page, no
// phone. 24 of Broward's 31 municipalities have no adapter, so that was most
// of the county receiving advice it could not act on.
//
// Broward publishes MunicipalCodeAppPts, its own per-address code-enforcement
// office directory, and the contact fields are constant per municipality, so a
// 32-row table replaces a 724,258-point lookup.
//
// What these tests defend, in order of how badly each would hurt:
//  1. the office NEVER moves a verdict off amber - it is contact detail, not
//     coverage, and nothing here was searched
//  2. the join keys, because a key that does not match fails SILENTLY and that
//     city loses its office forever with nothing erroring
//  3. one county's office never answers for another county
//  4. the generated table cannot drift from the layer it came from
//  5. the email the layer carries is never published

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cityCodeCoverage, codeOfficeFor } from '../src/lib/city-code-portals';
import { codeVerdict, verdictBuyerNote, verdictOwnerNote, verdictTone } from '../src/lib/code-authority';
import { BROWARD_CODE_OFFICES } from '../src/lib/broward-code-offices.generated';
import { rowsFromFeatures, municipalityKeyFor } from '../scripts/gen-broward-code-offices';

const unchecked = (municipality: string | null, countyKey: string, cityGoverns = true) =>
  codeVerdict(
    {
      municipality,
      cityGoverns,
      cityChecked: false,
      countyChecked: true,
      municipalityKnown: municipality !== null,
      cityCoverage: cityCodeCoverage(municipality, countyKey) ?? undefined,
      countyName: countyKey,
    },
    0,
    0,
  );

describe('an office is contact detail, never coverage', () => {
  it('leaves the verdict amber for a city with an office and no adapter', () => {
    // The whole product rests on this: naming who decides is not asking them.
    const v = unchecked('MARGATE', 'broward');
    expect(v.kind).toBe('unchecked');
    expect(verdictTone(v)).toBe('amber');
    if (v.kind !== 'unchecked') throw new Error('unreachable');
    expect(v.deepScanReads).toBe(false);
    expect(v.office?.name).toBe('City of Margate');
  });

  it('never reports an office as a searchable portal', () => {
    // portalUrl is documented as the city's own case SEARCH. The office url is
    // a department page. This project already shipped a department homepage
    // dressed as a search once; the two must not merge.
    const cov = cityCodeCoverage('MARGATE', 'broward');
    expect(cov?.portalUrl).toBeNull();
    expect(cov?.office?.url).toBeTruthy();
  });

  it('gives the reader the office in the buyer note instead of a dead end', () => {
    const note = verdictBuyerNote(unchecked('MARGATE', 'broward'));
    expect(note).toContain('City of Margate');
    expect(note).toContain('954-972-1232');
    // The old dead-end wording must be gone for a city we can name.
    expect(note).not.toMatch(/Ask Margate directly/);
    // And it must still refuse to read as clean.
    expect(note).toContain('NOT a clean result');
  });

  it('still leads with the deep scan for a city that HAS an adapter', () => {
    // Hollywood has both. The better option must lead; the office must not
    // displace an answer we can actually get.
    const v = unchecked('HOLLYWOOD', 'broward');
    if (v.kind !== 'unchecked') throw new Error('unreachable');
    expect(v.deepScanReads).toBe(true);
    expect(v.office?.name).toBe('City of Hollywood');
    expect(verdictBuyerNote(v)).toContain('A deep scan reads');
  });

  it('names the district office for an unincorporated Broward parcel', () => {
    const v = codeVerdict(
      {
        municipality: 'UNINCORPORATED',
        cityGoverns: false,
        cityChecked: false,
        countyChecked: false,
        municipalityKnown: true,
        cityCoverage: cityCodeCoverage('UNINCORPORATED', 'broward') ?? undefined,
        countyName: 'broward',
      },
      0,
      0,
    );
    if (v.kind !== 'unchecked') throw new Error('unreachable');
    expect(v.office?.name).toBe('Broward Municipal Services District');
    expect(verdictOwnerNote(v)).toContain('Broward Municipal Services District');
    expect(verdictTone(v)).toBe('amber');
  });
});

describe('the join keys, which fail silently when wrong', () => {
  // Both of these came from deriving the key off the legal office name. The
  // county's boundary field disagrees with its own legal name, so the derived
  // key missed and the city would have had no office forever, with nothing
  // erroring to say so.
  it('matches Lazy Lake, which the county calls "Lazy Lakes"', () => {
    expect(codeOfficeFor('LAZY LAKE', 'broward')?.name).toBe('Village of Lazy Lakes');
    expect(codeOfficeFor('LAZY LAKES', 'broward')).toBeNull();
  });

  it('matches Lauderdale By The Sea, whose legal name is hyphenated', () => {
    expect(codeOfficeFor('LAUDERDALE BY THE SEA', 'broward')?.name).toBe(
      'Town of Lauderdale-by-the-Sea',
    );
    expect(codeOfficeFor('LAUDERDALE-BY-THE-SEA', 'broward')).toBeNull();
  });

  it('keys the unincorporated district on its own key, not a city name', () => {
    // Its boundary field reads "COUNTY REGIONAL FACILITY", which is not a
    // place. Keying it as a city would hand an unincorporated parcel a
    // municipal authority.
    expect(municipalityKeyFor('Broward Municipal Services District', 'COUNTY REGIONAL FACILITY')).toBe(
      'broward:UNINCORPORATED',
    );
    expect(codeOfficeFor('COUNTY REGIONAL FACILITY', 'broward')).toBeNull();
  });

  it('every city with an adapter also resolves an office', () => {
    // If a registry city stopped joining, its report would quietly lose the
    // contact while still claiming coverage.
    for (const key of ['COOPER CITY', 'FORT LAUDERDALE', 'HOLLYWOOD', 'MIRAMAR', 'OAKLAND PARK', 'PEMBROKE PINES', 'WEST PARK']) {
      expect(codeOfficeFor(key, 'broward'), key).not.toBeNull();
    }
  });

  it('tolerates the padding the county ships', () => {
    // CODE_MUNICIPALITY arrives as "City of West Park " with a real trailing
    // space, the same class of trap as Miami-Dade's padded folios.
    expect(codeOfficeFor('  west park  ', 'broward')?.name).toBe('City of West Park');
  });
});

describe('one county never answers for another', () => {
  it('refuses a Broward city name asked under another county', () => {
    // Two Florida counties can hold places of the same name. Naming the wrong
    // office is worse than naming none: it sends a reader to a government
    // that cannot help and tells them it is the one that decides.
    expect(codeOfficeFor('MARGATE', 'miami-dade')).toBeNull();
    expect(codeOfficeFor('MARGATE', null)).toBeNull();
    expect(codeOfficeFor(null, 'broward')).toBeNull();
  });

  it('leaves a non-Broward city with no office at all', () => {
    const cov = cityCodeCoverage('TAMPA', 'hillsborough');
    expect(cov?.deepScanReads).toBe(true);
    expect(cov?.office).toBeUndefined();
  });

  it('leaves a city with neither adapter nor office exactly as it was', () => {
    const v = unchecked('SOME PLACE', 'lee');
    if (v.kind !== 'unchecked') throw new Error('unreachable');
    expect(v.office).toBeNull();
    expect(verdictBuyerNote(v)).toContain('Ask Some Place directly');
  });
});

describe('the generated table cannot drift from its source', () => {
  it('rebuilds byte-for-byte from the frozen layer capture', () => {
    // The generated file is a second copy of county data, which is the exact
    // thing that caused the stale-portal-list bug. What makes it safe is not
    // the generator; it is that this test rebuilds the table from the capture
    // and fails when the two disagree.
    const fx = JSON.parse(
      readFileSync(new URL('./fixtures/broward-code-offices-layer.json', import.meta.url), 'utf8'),
    ) as { features: any[] };
    expect(rowsFromFeatures(fx.features)).toEqual(BROWARD_CODE_OFFICES);
  });

  it('covers all 31 Broward municipalities plus the unincorporated district', () => {
    expect(BROWARD_CODE_OFFICES).toHaveLength(32);
    expect(BROWARD_CODE_OFFICES.filter((r) => r.key === 'broward:UNINCORPORATED')).toHaveLength(1);
  });

  it('gives every office a page and a phone', () => {
    for (const r of BROWARD_CODE_OFFICES) {
      expect(r.url, r.key).toBeTruthy();
      expect(r.phone, r.key).toBeTruthy();
    }
  });

  it('refuses to pick when one municipality carries two different contacts', () => {
    // The 32-row table is only valid because the contacts are constant per
    // municipality. If the county ever changes that, the generator must stop
    // rather than silently keep whichever row it saw first.
    const conflicting = [
      { attributes: { CODE_MUNICIPALITY: 'City of Margate', PTS_CITYNAME_BOUNDARY: 'MARGATE', CODE_WEBSITE: 'https://a', CODE_PHONE: '1' } },
      { attributes: { CODE_MUNICIPALITY: 'City of Margate', PTS_CITYNAME_BOUNDARY: 'MARGATE', CODE_WEBSITE: 'https://b', CODE_PHONE: '2' } },
    ];
    expect(() => rowsFromFeatures(conflicting)).toThrow(/two different contacts/i);
  });

  it('publishes no email address', () => {
    // The layer carries CODE_EMAIL for all 32. About 18 are an individual
    // staffer's mailbox, and the Parkland row reads tracey_green@sherrif.org -
    // a real third-party domain, while Broward Sheriff's Office is
    // sheriff.org. Mail sent there reaches a stranger, so the field is not
    // published at all.
    const src = readFileSync(
      new URL('../src/lib/broward-code-offices.generated.ts', import.meta.url),
      'utf8',
    );
    expect(src).not.toContain('mailto');
    expect(src).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    for (const r of BROWARD_CODE_OFFICES) {
      expect(JSON.stringify(r)).not.toContain('@');
    }
  });
});
