// End to end through the REAL report path, because Codex R1's finding was a
// wiring gap and not a logic error.
//
// My R1 unit tests all passed while the district office was unreachable in
// production, because they constructed `municipality: 'UNINCORPORATED'`
// themselves and the real resolver never produces that string. A unit test of
// a helper cannot catch a helper nobody calls. That is the same mistake a
// previous round caught in the parcel work, and I made it again here, so this
// file drives `runDiagnostic` and asserts on what a reader is actually handed.
//
// The jurisdiction identity therefore comes from the SOURCE RESPONSE - the
// Census place endpoint answering with zero features - never from a string
// this test supplies.

import { describe, it, expect, afterEach } from 'vitest';
import { runDiagnostic } from '@/lib/orchestrator';
import { buildGlance } from '@/lib/glance';

const ADDRESS = '4700 NW 15 Ct, Fort Lauderdale, FL';
const POINT = { lat: 26.1455, lng: -80.1746 };

type PlacesMode =
  | 'none'
  | 'named'
  | 'fail'
  /** HTTP 200, JSON, but no features array at all. Codex R2-01. */
  | 'no-features'
  /** A matched Florida feature carrying neither BASENAME nor NAME. Codex R2-01. */
  | 'unnamed-match'
  /** A matched feature with an EMPTY attributes object. Codex R3-01. */
  | 'empty-attributes'
  /** A matched feature with NO attributes key at all. */
  | 'no-attributes'
  /** A matched feature whose STATE is blank. */
  | 'blank-state'
  /** Readable records, none of them in Florida. */
  | 'other-state';

/**
 * Answer every host the report touches for a Broward address.
 *
 * `places` is the only knob that matters here:
 *   'none'  the boundary source ANSWERS with zero features - the parcel is
 *           positively inside no incorporated place
 *   'named' it answers with a place, using the CENSUS spelling
 *   'fail'  it does not answer at all
 *
 * The third is the one that must never become a district finding.
 */
function installStub(mode: PlacesMode, placeName = 'Lauderdale-by-the-Sea') {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);

    if (url.includes('geocoding.geo.census.gov')) {
      return new Response(
        JSON.stringify({
          result: {
            addressMatches: [
              { matchedAddress: '4700 NW 15 CT, FORT LAUDERDALE, FL, 33313', coordinates: { x: POINT.lng, y: POINT.lat } },
            ],
          },
        }),
        { status: 200 },
      );
    }

    if (url.includes('geo.fcc.gov')) {
      return new Response(JSON.stringify({ results: [{ county_name: 'Broward County' }] }), { status: 200 });
    }

    if (url.includes('Places_CouSub_ConCity_SubMCD')) {
      if (mode === 'fail') return new Response('upstream down', { status: 503 });
      // Codex R2-01's two bodies, verbatim. Both are HTTP 200 and valid JSON,
      // and both used to certify district jurisdiction.
      if (mode === 'no-features') {
        return new Response(JSON.stringify({ status: 'unavailable' }), { status: 200 });
      }
      if (mode === 'unnamed-match') {
        return new Response(
          JSON.stringify({ features: [{ attributes: { STATE: '12' } }] }),
          { status: 200 },
        );
      }
      // Codex R3-01's body, verbatim: a matched record the STATE filter used
      // to remove, leaving an empty list that looked like "no place here".
      if (mode === 'empty-attributes') {
        return new Response(JSON.stringify({ features: [{ attributes: {} }] }), { status: 200 });
      }
      // The two shapes adjacent to it, which I should have found myself
      // rather than waiting for a fourth round to report them.
      if (mode === 'no-attributes') {
        return new Response(JSON.stringify({ features: [{ geometry: null }] }), { status: 200 });
      }
      if (mode === 'blank-state') {
        return new Response(
          JSON.stringify({ features: [{ attributes: { BASENAME: 'Margate', STATE: '   ' } }] }),
          { status: 200 },
        );
      }
      if (mode === 'other-state') {
        return new Response(
          JSON.stringify({ features: [{ attributes: { BASENAME: 'Somewhere', STATE: '13' } }] }),
          { status: 200 },
        );
      }
      if (mode === 'named') {
        return new Response(
          JSON.stringify({ features: [{ attributes: { BASENAME: placeName, NAME: `${placeName} town`, STATE: '12' } }] }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ features: [] }), { status: 200 });
    }

    // An unrelated municipal source must not certify code coverage.
    if (url.includes('gis.fortlauderdale.gov')) {
      return new Response(JSON.stringify({ error: { code: 499, message: 'unavailable' } }), { status: 200 });
    }

    return new Response(JSON.stringify({ features: [] }), { status: 200 });
  }) as any;
  return () => { globalThis.fetch = real; };
}

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

const codeItem = (report: any) => {
  const item = buildGlance(report).find((i: any) => i.key === 'code');
  if (!item) throw new Error('no code item in the glance');
  return item;
};

describe('a confirmed unincorporated Broward parcel reaches its district office', () => {
  it('names the district office, its page and its phone', async () => {
    // Codex's exact reproduction: the place endpoint answers with zero
    // features and the county roll carries no municipality, as Broward's
    // adapter does. Before the fix this rendered "We could not establish
    // which authority enforces code at this address".
    restore = installStub('none');
    const report = await runDiagnostic({ address: ADDRESS });
    expect(report.county.name).toContain('Broward');
    expect(report.property.municipality).toBeNull();
    expect(report.property.unincorporatedConfirmed).toBe(true);

    const item = codeItem(report);
    expect(item.info.buyer).toContain('Broward Municipal Services District');
    expect(item.info.buyer).toContain('954-357-9793');
    expect(item.info.buyer).not.toContain('could not establish which authority');
  });

  it('still refuses to call it clean', async () => {
    // Naming who decides is not asking them. Nothing was searched.
    restore = installStub('none');
    const item = codeItem(await runDiagnostic({ address: ADDRESS }));
    expect(item.tone).toBe('amber');
  });

  it('does NOT invent a district when the boundary source fails', async () => {
    // The whole safety rule. A failed lookup must stay unknown: it is not
    // evidence of unincorporated land, and handing this reader the county
    // office would name an authority nobody established.
    restore = installStub('fail');
    const report = await runDiagnostic({ address: ADDRESS });
    expect(report.property.municipality).toBeNull();
    expect(report.property.unincorporatedConfirmed).toBe(false);

    const item = codeItem(report);
    expect(item.tone).toBe('amber');
    expect(item.info.buyer).not.toContain('Broward Municipal Services District');
    expect(item.info.buyer).toContain('could not establish which authority');
  });
});

describe('the city-to-office join uses the spelling the REPORT produces', () => {
  it('matches Lauderdale-by-the-Sea, whose Census spelling is hyphenated', async () => {
    // The office table is keyed on Broward's boundary spelling
    // ("LAUDERDALE BY THE SEA") while the report consumes the Census name
    // ("Lauderdale-by-the-Sea"). Uppercasing does not close that gap, so this
    // town had no office on the real path. The name here comes from the
    // stubbed SOURCE response, not from a key this test chose.
    restore = installStub('named', 'Lauderdale-by-the-Sea');
    const report = await runDiagnostic({ address: ADDRESS });
    expect(report.property.municipality).toBe('Lauderdale-by-the-Sea');
    expect(report.property.unincorporatedConfirmed).toBe(false);

    const item = codeItem(report);
    expect(item.info.buyer).toContain('Town of Lauderdale-by-the-Sea');
    expect(item.info.buyer).toContain('954-640-4220');
    expect(item.tone).toBe('amber');
  });

  it('matches a plainly spelled city the same way', async () => {
    restore = installStub('named', 'Margate');
    const item = codeItem(await runDiagnostic({ address: ADDRESS }));
    expect(item.info.buyer).toContain('City of Margate');
    expect(item.info.buyer).toContain('954-972-1232');
  });

  it('leaves a Census place with no Broward office alone', async () => {
    // A place name the office table does not carry must produce no office
    // rather than a near-miss match from the same county.
    restore = installStub('named', 'Opa-locka');
    const item = codeItem(await runDiagnostic({ address: ADDRESS }));
    expect(item.info.buyer).not.toMatch(/Contact .* code compliance/);
  });
});

// Codex R2-01. My R2 tri-state distinguished "the lookup threw" from "the
// lookup returned nothing", which is not the same as distinguishing a VALID
// empty result from an unreadable one. Two HTTP-200 JSON bodies still
// certified district jurisdiction and named Broward Municipal Services
// District at a parcel whose jurisdiction was never established.
//
// This is the same class I had just fixed in the Miami-Dade adapter hours
// earlier - checking that `features` is an array says nothing about whether
// its contents are records, and not checking that it exists at all says even
// less - and I did not carry it across to this module.
describe('an unreadable boundary answer never certifies a jurisdiction', () => {
  it('refuses a 200 body with no features array', async () => {
    restore = installStub('no-features');
    const report = await runDiagnostic({ address: ADDRESS });
    expect(report.property.unincorporatedConfirmed).toBe(false);
    expect(report.property.municipality).toBeNull();

    const item = codeItem(report);
    expect(item.tone).toBe('amber');
    expect(item.info.buyer).not.toContain('Broward Municipal Services District');
    expect(item.info.buyer).not.toContain('954-357-9793');
    expect(item.info.buyer).toContain('could not establish which authority');
  });

  it('refuses a matched Florida place that carries no name', async () => {
    // The layer is saying the point IS inside a place and will not say which.
    // Reading that as "inside no place" inverts the finding and could send a
    // city parcel's owner to the county office.
    restore = installStub('unnamed-match');
    const report = await runDiagnostic({ address: ADDRESS });
    expect(report.property.unincorporatedConfirmed).toBe(false);
    expect(report.property.municipality).toBeNull();

    const item = codeItem(report);
    expect(item.tone).toBe('amber');
    expect(item.info.buyer).not.toContain('Broward Municipal Services District');
    expect(item.info.buyer).toContain('could not establish which authority');
  });

  it('keeps the valid-empty control working, which is the whole point', async () => {
    // If this regressed, the fix above would just be a way of never naming
    // the district at all.
    restore = installStub('none');
    const report = await runDiagnostic({ address: ADDRESS });
    expect(report.property.unincorporatedConfirmed).toBe(true);
    expect(codeItem(report).info.buyer).toContain('Broward Municipal Services District');
  });
});

// Codex R3-01, and the redesign that answers it.
//
// Three rounds of guarding individual response shapes did not close this,
// because the defect was never a missing guard: `unincorporated` was being
// INFERRED by a caller noticing an empty list, and an empty list has two
// causes - the source had nothing, or the source said something unreadable
// that a filter then removed. R3-01 is the second cause wearing a new shape.
//
// The redesign makes the positive finding a VALUE CONSTRUCTED inside the
// validated lookup. `placeAt` proves every returned record readable before it
// filters anything, and returns {kind:'unincorporated'} only from a complete
// answer with no features at all. No caller can manufacture it by counting.
describe('unincorporated can only come from a fully validated response', () => {
  const unreadable: Array<[string, PlacesMode]> = [
    ['Codex R3-01: a matched record with empty attributes', 'empty-attributes'],
    ['a matched record with no attributes key at all', 'no-attributes'],
    ['a matched record whose STATE is blank', 'blank-state'],
    ['readable records, none of them in Florida', 'other-state'],
    ['a 200 body with no features array', 'no-features'],
    ['a matched Florida place carrying no name', 'unnamed-match'],
    ['a boundary source that does not answer', 'fail'],
  ];

  for (const [label, mode] of unreadable) {
    it(`refuses to certify a district from ${label}`, async () => {
      restore = installStub(mode);
      const report = await runDiagnostic({ address: ADDRESS });
      expect(report.property.unincorporatedConfirmed).toBe(false);
      expect(report.property.municipality).toBeNull();

      const item = codeItem(report);
      expect(item.tone).toBe('amber');
      expect(item.info.buyer).not.toContain('Broward Municipal Services District');
      expect(item.info.buyer).not.toContain('954-357-9793');
      expect(item.info.buyer).toContain('could not establish which authority');
    });
  }

  it('still certifies the district from the ONE valid empty answer', async () => {
    // Without this control the whole redesign would just be a way of never
    // naming the district at all.
    restore = installStub('none');
    const report = await runDiagnostic({ address: ADDRESS });
    expect(report.property.unincorporatedConfirmed).toBe(true);
    const buyer = codeItem(report).info.buyer;
    expect(buyer).toContain('Broward Municipal Services District');
    expect(buyer).toContain('954-357-9793');
  });

  it('still names a city from a readable Florida match', async () => {
    restore = installStub('named', 'Margate');
    const report = await runDiagnostic({ address: ADDRESS });
    expect(report.property.municipality).toBe('Margate');
    expect(report.property.unincorporatedConfirmed).toBe(false);
    expect(codeItem(report).info.buyer).toContain('City of Margate');
  });
});
