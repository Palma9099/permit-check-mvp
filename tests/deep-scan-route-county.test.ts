// Codex R1, P2: the Census geocoder path could not reach a city adapter.
//
// `geocodeCensus` hardcodes `county: null` - its oneline endpoint has no
// reliable county field - and it is the fallback whenever GOOGLE_MAPS_API_KEY
// is absent or Google fails. The deep-scan route forwarded that null straight
// into the queue alongside a correctly resolved municipality.
//
// `resolveJurisdiction` needs BOTH keys to select a city, and the worker does
// not geocode: it dispatches on what it is handed. So a valid City of Tampa
// address enqueued through the Census path produced municipality "Tampa",
// county null, no adapter at all, and "no county adapter" back to the reader.
//
// My own live checks never caught it because they ran the Google path. These
// tests drive the real route handler with Google absent.

import { describe, it, expect, afterEach } from 'vitest';
import { POST } from '../src/app/api/deep-scan/route';
import { resolveJurisdiction } from '../worker/src/scrapers/jurisdictions.js';

const TAMPA = { lat: 27.9478, lng: -82.4584 };

interface Captured {
  body: any;
}

/**
 * Answer every host the route touches on the Census path.
 *
 * `census` controls the geocoder, `fcc` the county reverse lookup, `place` the
 * incorporated-place boundary answer. Each can be made to fail independently,
 * because what matters is not only the happy path but that a failure stays
 * unknown rather than becoming a guess.
 */
function installStub(opts: { fcc?: 'ok' | 'fail'; place?: 'ok' | 'fail' } = {}) {
  const real = globalThis.fetch;
  const captured: Captured = { body: null };

  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input);

    // Google must never be reached here: no key is set in tests/setup.ts.
    if (url.includes('maps.googleapis.com')) {
      throw new Error('Google should not be called when no key is configured');
    }

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
      if (opts.fcc === 'fail') return new Response('upstream down', { status: 503 });
      return new Response(
        JSON.stringify({ results: [{ county_name: 'Hillsborough County' }] }),
        { status: 200 },
      );
    }

    if (url.includes('tigerweb.geo.census.gov')) {
      if (opts.place === 'fail') return new Response('upstream down', { status: 503 });
      return new Response(
        JSON.stringify({
          features: [{ attributes: { BASENAME: 'Tampa', NAME: 'Tampa city', STATE: '12' } }],
        }),
        { status: 200 },
      );
    }

    // The queue insert.
    if (url.includes('/scan_jobs')) {
      captured.body = init.body ? JSON.parse(init.body) : null;
      return new Response(JSON.stringify([{ id: 'job-under-test' }]), { status: 201 });
    }

    throw new Error(`unexpected host in test: ${url}`);
  }) as any;

  return { captured, restore: () => { globalThis.fetch = real; } };
}

function request(address: string) {
  return new Request('https://test.palma.invalid/api/deep-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'buyer@example.invalid', address }),
  }) as any;
}

let active: { restore: () => void } | null = null;
afterEach(() => {
  active?.restore();
  active = null;
});

describe('the Census geocoder path can still reach a city adapter', () => {
  it('resolves the county the Census geocoder does not return', async () => {
    const stub = installStub();
    active = stub;

    const res = await POST(request('315 E Kennedy Blvd, Tampa, FL'));
    expect(res.status).toBe(200);

    // Before the fix this was null, and null is what broke the chain.
    expect(stub.captured.body.county).toBe('hillsborough');
    expect(stub.captured.body.municipality).toBe('Tampa');
  });

  it('and those two values actually select the City of Tampa', async () => {
    // The assertion that makes the one above mean something. Checking the
    // enqueued fields alone would pass on a county key the worker cannot use.
    const stub = installStub();
    active = stub;

    await POST(request('315 E Kennedy Blvd, Tampa, FL'));
    const { county, municipality } = stub.captured.body;
    const jur = resolveJurisdiction(county, municipality);

    expect(jur).toBeTruthy();
    expect(jur!.name).toBe('City of Tampa');
    expect(jur!.name).not.toBe('Hillsborough County');
  });
});

describe('a failed lookup stays unknown rather than becoming a guess', () => {
  it('leaves the county null when the reverse lookup fails', async () => {
    const stub = installStub({ fcc: 'fail' });
    active = stub;

    const res = await POST(request('315 E Kennedy Blvd, Tampa, FL'));
    expect(res.status).toBe(200);
    expect(stub.captured.body.county).toBeNull();
    // The municipality still resolved; it just cannot be used without a county,
    // and the worker says "no county adapter" rather than searching the wrong
    // office. An honest refusal, which is the whole product.
    expect(stub.captured.body.municipality).toBe('Tampa');
    expect(resolveJurisdiction(stub.captured.body.county, stub.captured.body.municipality)).toBeUndefined();
  });

  it('leaves the municipality null when the boundary source fails', async () => {
    const stub = installStub({ place: 'fail' });
    active = stub;

    await POST(request('315 E Kennedy Blvd, Tampa, FL'));
    expect(stub.captured.body.municipality).toBeNull();
    // County still resolved, so the scan runs - against the COUNTY, whose own
    // coverage note discloses that it covers unincorporated land only.
    expect(stub.captured.body.county).toBe('hillsborough');
  });
});
