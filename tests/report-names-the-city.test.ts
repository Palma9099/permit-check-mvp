// End to end through the REAL report path, because the defect this covers was
// a wiring gap, not a logic error.
//
// `governingMunicipality` and the verdict copy are unit-tested in
// report-resolves-municipality.test.ts. Those tests all passed while production
// was still broken, because nothing called the resolver from the report. A unit
// test of a helper cannot catch a helper nobody calls - that is exactly the bug
// Codex found in R1 of the previous round, and exactly the bug here. So this
// file drives `runDiagnostic` itself and asserts on what a reader is handed.

import { describe, it, expect, afterEach } from 'vitest';
import { runDiagnostic } from '@/lib/orchestrator';
import { buildGlance } from '@/lib/glance';

const TAMPA = { lat: 27.9478, lng: -82.4584 };
const ADDRESS = '315 E Kennedy Blvd, Tampa, FL';

interface Stub {
  calls: string[];
  restore: () => void;
}

/**
 * Answer every host the report touches for a Tampa address.
 *
 * `places` fails the incorporated-place boundary source independently, because
 * what matters is not only that a good lookup names the city but that a failed
 * one stays unknown instead of becoming a guess.
 */
function installStub(opts: { places?: 'ok' | 'fail' } = {}): Stub {
  const real = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    calls.push(url);

    if (url.includes('geocoding.geo.census.gov')) {
      return new Response(
        JSON.stringify({
          result: {
            addressMatches: [
              {
                matchedAddress: '315 E KENNEDY BLVD, TAMPA, FL, 33602',
                coordinates: { x: TAMPA.lng, y: TAMPA.lat },
              },
            ],
          },
        }),
        { status: 200 },
      );
    }

    if (url.includes('geo.fcc.gov')) {
      return new Response(
        JSON.stringify({ results: [{ county_name: 'Hillsborough County' }] }),
        { status: 200 },
      );
    }

    // The incorporated-place boundaries - the only source that can name the
    // city here, because no Florida county roll but Miami-Dade's carries one.
    if (url.includes('Places_CouSub_ConCity_SubMCD')) {
      if (opts.places === 'fail') return new Response('upstream down', { status: 503 });
      return new Response(
        JSON.stringify({
          features: [{ attributes: { BASENAME: 'Tampa', NAME: 'Tampa city', STATE: '12' } }],
        }),
        { status: 200 },
      );
    }

    // Parcels, permits, flood, imagery, AI cache: empty is a fine answer. The
    // report is built to survive every one of them being quiet.
    return new Response(JSON.stringify({ features: [] }), { status: 200 });
  }) as any;

  return { calls, restore: () => { globalThis.fetch = real; } };
}

let active: Stub | null = null;
afterEach(() => {
  active?.restore();
  active = null;
});

function codeItem(report: any) {
  const item = buildGlance(report).find((i) => i.key === 'code');
  if (!item) throw new Error('no code item in the glance');
  return item;
}

describe('the report names the city that enforces code', () => {
  it('resolves Tampa, which no Hillsborough record carries', async () => {
    const stub = installStub();
    active = stub;

    const report = await runDiagnostic({ address: ADDRESS });

    // Before this fix the live site returned null here for every address
    // outside Miami-Dade. Verified against production on 2026-11-10.
    expect(report.property.municipality).toBe('Tampa');

    // And it asked the boundary source at the parcel point, not the postal city.
    const boundary = stub.calls.find((u) => u.includes('Places_CouSub_ConCity_SubMCD'));
    expect(boundary).toBeTruthy();
    expect(boundary).toContain('27.9478');
    expect(boundary).toContain('-82.4584');
  }, 60000);

  it('tells a Tampa reader the scan reaches Tampa, and links its own portal', async () => {
    active = installStub();

    const report = await runDiagnostic({ address: ADDRESS });
    const item = codeItem(report);

    expect(item.info.buyer).toContain('Tampa');
    expect(item.info.buyer).toContain('deep scan');
    // Tampa runs code enforcement on Accela; the link is the city's own
    // Enforcement tab, read from the generated coverage data, not guessed.
    expect(item.info.buyer).toContain('aca-prod.accela.com/TAMPA');
    // The sentence production actually served, which named nobody at all.
    expect(item.info.buyer).not.toContain('could not establish which authority');
  }, 60000);

  it('does not turn naming the authority into a clean result', async () => {
    active = installStub();

    const report = await runDiagnostic({ address: ADDRESS });
    const item = codeItem(report);

    // Knowing WHO to ask is not asking. This is the product's one rule.
    expect(item.tone).toBe('amber');
    expect(item.value).toBe('Not checked');
    expect(report.codeEnforcement.cityCodeChecked).toBe(false);
  }, 60000);

  it('stays unknown, not unincorporated, when the boundary source fails', async () => {
    active = installStub({ places: 'fail' });

    const report = await runDiagnostic({ address: ADDRESS });
    const item = codeItem(report);

    expect(report.property.municipality).toBeNull();
    // Still amber, and now honest about having identified nobody rather than
    // naming a city it never confirmed.
    expect(item.tone).toBe('amber');
    expect(item.info.buyer).toContain('We could not establish which authority');
    expect(item.info.buyer).not.toContain('Tampa');
    expect(item.info.buyer).not.toContain('deep scan');
  }, 60000);
});
