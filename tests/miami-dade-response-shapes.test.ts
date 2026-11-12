// Codex R8's two P1 findings, both FALSE ZEROS: an unreadable response and a
// truncated response each reported "searched, found nothing".
//
// These drive the real adapter with a stubbed fetch, because the failures live
// at the protocol boundary and never appear on the happy path. That is exactly
// why the live proof missed them.

import { describe, it, expect, afterEach } from 'vitest';
import { runMiamiDadeScrape } from '../worker/src/scrapers/miami-dade.js';
import { JURISDICTIONS } from '../worker/src/scrapers/jurisdictions.js';

const jur: any = (JURISDICTIONS as any)['miami-dade'];
const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; });

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

const run = (folio: string | null = '3040210340010', lat?: number, lng?: number) =>
  runMiamiDadeScrape(
    { page: null as any, address: '(test)', folio, lat: lat ?? null, lng: lng ?? null, municipality: null, log: () => {} },
    jur,
  );

describe('an unreadable response is not an empty one', () => {
  it('refuses a body with no features array', async () => {
    // Codex's case: four HTTP-200 bodies the adapter does not understand.
    globalThis.fetch = (async () => json({ message: 'unrecognized response' })) as any;
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.violationsChecked).toBe(false);
    expect(r.violations).toHaveLength(0);
    expect(r.notes.join(' ')).toMatch(/could not be read|incomplete/i);
  });

  it('refuses a body that is not JSON at all', async () => {
    globalThis.fetch = (async () => new Response('<html>down for maintenance</html>', { status: 200 })) as any;
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.violationsChecked).toBe(false);
  });

  it('still refuses an ArcGIS error body', async () => {
    globalThis.fetch = (async () => json({ error: { message: 'Token Required' } })) as any;
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.violationsChecked).toBe(false);
  });

  it('accepts a genuine empty result', async () => {
    // The point of the distinction: a real zero still reads as a real zero.
    globalThis.fetch = (async () => json({ features: [] })) as any;
    const r = await run();
    expect(r.ok).toBe(true);
    expect(r.violationsChecked).toBe(true);
    expect(r.violations).toHaveLength(0);
  });
});

describe('a truncated response is not a complete one', () => {
  const row = (n: number) => ({ attributes: { CASE_NUM: `C${n}`, STAT_DESC: 'Closed', CASE_DATE: 0 } });

  it('pages until the server stops truncating', async () => {
    let call = 0;
    globalThis.fetch = (async (u: any) => {
      const url = new URL(String(u));
      if (!url.pathname.includes('CodeComplianceViolation_Open_View')) return json({ features: [] });
      call++;
      // 200 rows and truncated, then a short final page.
      return call === 1
        ? json({ features: Array.from({ length: 200 }, (_, i) => row(i)), exceededTransferLimit: true })
        : json({ features: [row(999)] });
    }) as any;
    const r = await run();
    expect(r.ok).toBe(true);
    // 201 rows read, not 200 declared complete.
    expect(r.violations.length).toBe(201);
    expect(r.violations.some((v) => v.caseNumber === 'C999')).toBe(true);
  });

  it('refuses rather than publish a prefix when the end is unreachable', async () => {
    // Codex's case, taken further: the server never stops truncating.
    globalThis.fetch = (async (u: any) => {
      const url = new URL(String(u));
      if (!url.pathname.includes('CodeComplianceViolation_Open_View')) return json({ features: [] });
      return json({ features: Array.from({ length: 200 }, (_, i) => row(i)), exceededTransferLimit: true });
    }) as any;
    const r = await run();
    // A truncated list published as whole is worse than an honest failure.
    expect(r.ok).toBe(false);
    expect(r.violationsChecked).toBe(false);
    expect(r.notes.join(' ')).toMatch(/could not be read|incomplete/i);
  });

  it('asks for each page at the right offset', async () => {
    const offsets: string[] = [];
    let call = 0;
    globalThis.fetch = (async (u: any) => {
      const url = new URL(String(u));
      if (!url.pathname.includes('CodeComplianceViolation_Open_View')) return json({ features: [] });
      offsets.push(url.searchParams.get('resultOffset') ?? 'none');
      call++;
      return call === 1
        ? json({ features: Array.from({ length: 200 }, (_, i) => row(i)), exceededTransferLimit: true })
        : json({ features: [] });
    }) as any;
    await run();
    expect(offsets.slice(0, 2)).toEqual(['0', '200']);
  });
});

describe('the parcel endpoint, which had never been exercised', () => {
  it('resolves a folio from a point and searches it', async () => {
    // My folioAtPoint queried MDC_Parcels, which answers "Invalid URL", so
    // this path could never have worked and no proof had covered it.
    const seen: string[] = [];
    globalThis.fetch = (async (u: any) => {
      const url = new URL(String(u));
      seen.push(url.pathname);
      if (url.pathname.includes('ParcelsView_gdb')) {
        return json({ features: [{ attributes: { FOLIO: '3040210340010' } }] });
      }
      return json({ features: [] });
    }) as any;
    const r = await run(null, 25.729, -80.3447);
    expect(seen.some((p) => p.includes('ParcelsView_gdb'))).toBe(true);
    expect(seen.some((p) => p.includes('MDC_Parcels'))).toBe(false);
    expect(r.folio).toBe('3040210340010');
    expect(r.ok).toBe(true);
  });

  it('refuses when the point resolves to no parcel', async () => {
    globalThis.fetch = (async () => json({ features: [] })) as any;
    const r = await run(null, 25.729, -80.3447);
    expect(r.ok).toBe(false);
    expect(r.notes.join(' ')).toMatch(/filed by folio/i);
  });
});
