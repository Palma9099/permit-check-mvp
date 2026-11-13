// `queryFeaturesValidated` gets its own tests because its guards must be
// load-bearing on their own.
//
// Writing the report-path tests first was not enough, and the mutation run
// proved it: removing the attributes-object check and removing the
// required-field check each left all 80 report-path tests green, because the
// shapes they let through were caught further downstream by the
// non-Florida-match branch. The outcome was right and the guard was untested,
// which is how a guard quietly stops working later when the branch that was
// covering for it moves.
//
// So these drive the function directly. Each test names the shape, not the
// consequence.

import { describe, it, expect, afterEach } from 'vitest';
import { queryFeaturesValidated, partialResultReason } from '@/lib/arcgis';

const LAYER = 'https://example.test/arcgis/rest/services/Fake/MapServer/0';
const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; });

const serve = (body: unknown, status = 200) => {
  globalThis.fetch = (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as any;
};

const run = () => queryFeaturesValidated(LAYER, { label: 'fake' }, ['STATE']);

describe('a response is validated before anything filters it', () => {
  it('returns attribute rows when every record is readable', async () => {
    serve({ features: [{ attributes: { STATE: '12', BASENAME: 'Margate' } }] });
    await expect(run()).resolves.toEqual([{ STATE: '12', BASENAME: 'Margate' }]);
  });

  it('returns an empty list for a genuinely empty answer', async () => {
    // The one shape that may become a positive finding upstream.
    serve({ features: [] });
    await expect(run()).resolves.toEqual([]);
  });

  it('rejects a 200 body with no features array', async () => {
    serve({ status: 'unavailable' });
    await expect(run()).rejects.toThrow(/no features array/i);
  });

  it('rejects a feature with no attributes key', async () => {
    serve({ features: [{ geometry: null }] });
    await expect(run()).rejects.toThrow(/no attributes/i);
  });

  it('rejects a feature whose attributes are null', async () => {
    serve({ features: [{ attributes: null }] });
    await expect(run()).rejects.toThrow(/no attributes/i);
  });

  it('rejects a feature whose attributes are an array, not an object', async () => {
    // JSON lets this through and `typeof [] === 'object'`, so the check has to
    // exclude arrays explicitly or an array reads as an empty record.
    serve({ features: [{ attributes: [] }] });
    await expect(run()).rejects.toThrow(/no attributes/i);
  });

  it('rejects a feature with EMPTY attributes, which is Codex R3-01', async () => {
    serve({ features: [{ attributes: {} }] });
    await expect(run()).rejects.toThrow(/no readable STATE/i);
  });

  it('rejects a blank required field', async () => {
    serve({ features: [{ attributes: { STATE: '   ' } }] });
    await expect(run()).rejects.toThrow(/no readable STATE/i);
  });

  it('rejects a required field that is not a string', async () => {
    // ArcGIS can type a field numerically; `str()` only accepts strings, so a
    // number here is unreadable rather than silently coerced.
    serve({ features: [{ attributes: { STATE: 12 } }] });
    await expect(run()).rejects.toThrow(/no readable STATE/i);
  });

  it('rejects when ANY record is unreadable, not only the first', async () => {
    // The dangerous shape: one good record alongside one broken one. Taking
    // the good one would publish a partial answer as a whole one.
    serve({
      features: [
        { attributes: { STATE: '12', BASENAME: 'Margate' } },
        { attributes: {} },
      ],
    });
    await expect(run()).rejects.toThrow(/no readable STATE/i);
  });

  it('still rejects an {error} body at HTTP 200', async () => {
    serve({ error: { code: 499, message: 'Token Required' } });
    await expect(run()).rejects.toThrow(/rejected/i);
  });

  it('still rejects a non-JSON body and an HTTP failure', async () => {
    serve('<html>down</html>');
    await expect(run()).rejects.toThrow(/non-JSON/i);
    serve({ features: [] }, 503);
    await expect(run()).rejects.toThrow(/HTTP 503/);
  });

  it('checks every field named, not just the first', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ features: [{ attributes: { STATE: '12' } }] }), { status: 200 })) as any;
    await expect(
      queryFeaturesValidated(LAYER, { label: 'fake' }, ['STATE', 'BASENAME']),
    ).rejects.toThrow(/no readable BASENAME/i);
  });
});

// Codex R4-01: completeness, which is a different question from readability.
//
// The validator proved every RECORD readable and discarded the envelope, so an
// explicitly truncated EMPTY answer looked like a complete empty one. These
// cover the whole partial-result contract rather than the one shape reported:
// the documented top-level flag, the geojson envelope's nested copy, and the
// pagination continuation token.
describe('a response must be complete, not merely readable', () => {
  it('rejects a truncated EMPTY answer, which is Codex R4-01', async () => {
    serve({ features: [], exceededTransferLimit: true });
    await expect(run()).rejects.toThrow(/partial result.*exceededTransferLimit/i);
  });

  it('rejects a truncated answer that DID return records', async () => {
    serve({ features: [{ attributes: { STATE: '12' } }], exceededTransferLimit: true });
    await expect(run()).rejects.toThrow(/partial result/i);
  });

  it('rejects the geojson envelope form of the same flag', async () => {
    // We only ask for f=json today. This exists so a format change cannot
    // silently reopen the hole.
    serve({ type: 'FeatureCollection', features: [], properties: { exceededTransferLimit: true } });
    await expect(run()).rejects.toThrow(/partial result.*properties/i);
  });

  it('rejects a response carrying a pagination continuation token', async () => {
    serve({ features: [], resultPaginationToken: 'abc123' });
    await expect(run()).rejects.toThrow(/partial result.*resultPaginationToken/i);
  });

  it('accepts an explicit exceededTransferLimit: false as complete', async () => {
    // Probed on both server families: the flag is omitted when complete, and
    // the docs show pagination ending on an explicit false. Treating false as
    // truncated would make the validator reject every complete answer.
    serve({ features: [], exceededTransferLimit: false });
    await expect(run()).resolves.toEqual([]);
  });

  it('accepts a complete answer that omits the flag entirely', async () => {
    serve({ features: [{ attributes: { STATE: '12' } }] });
    await expect(run()).resolves.toEqual([{ STATE: '12' }]);
  });

  it('ignores an empty or non-string pagination token', async () => {
    serve({ features: [], resultPaginationToken: '' });
    await expect(run()).resolves.toEqual([]);
    serve({ features: [], resultPaginationToken: null });
    await expect(run()).resolves.toEqual([]);
  });
});

describe('partialResultReason names which signal fired', () => {
  it('reports each signal, and nothing for a complete response', () => {
    expect(partialResultReason({ exceededTransferLimit: true })).toBe('exceededTransferLimit');
    expect(partialResultReason({ properties: { exceededTransferLimit: true } })).toBe(
      'properties.exceededTransferLimit',
    );
    expect(partialResultReason({ resultPaginationToken: 'tok' })).toBe('resultPaginationToken');
    expect(partialResultReason({ features: [], exceededTransferLimit: false })).toBeNull();
    expect(partialResultReason({ features: [] })).toBeNull();
    expect(partialResultReason(null)).toBeNull();
  });
});
