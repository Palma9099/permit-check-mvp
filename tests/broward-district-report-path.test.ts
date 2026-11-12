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

type PlacesMode = 'none' | 'named' | 'fail';

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
