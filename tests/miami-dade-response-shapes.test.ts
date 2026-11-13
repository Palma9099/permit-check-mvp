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

// Codex R9's two findings. Both are the SAME false zero my R9 fixes were
// supposed to close, reached through boundaries my own tests did not cover:
// R9-01 an empty page that still carries the truncation flag, R9-02 a
// features array whose rows cannot be read. Each reproduction below is
// Codex's, written from its verdict rather than invented here.
describe('Codex R9-01: a truncated empty page is not the end of the list', () => {
  it('refuses when the server flags more rows and returns none', async () => {
    // Codex's exact case: offset 0 gives one row with the flag set, offset
    // 200 gives an EMPTY page with the flag STILL set. The old code read
    // that empty page as the terminal page and published the one row as a
    // complete list, ok=true.
    const offsets: string[] = [];
    globalThis.fetch = (async (u: any) => {
      const url = new URL(String(u));
      if (!url.pathname.includes('CodeComplianceViolation_Open_View')) {
        return json({ features: [] });
      }
      const off = url.searchParams.get('resultOffset') ?? '0';
      offsets.push(off);
      return off === '0'
        ? json({ features: [{ attributes: { CASE_NUM: 'A' } }], exceededTransferLimit: true })
        : json({ features: [], exceededTransferLimit: true });
    }) as any;
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.violationsChecked).toBe(false);
    expect(r.violations).toHaveLength(0);
    expect(offsets.slice(0, 2)).toEqual(['0', '200']);
    expect(r.notes.join(' ')).toMatch(/incomplete|could not be read/i);
  });

  it('refuses when the FIRST page is empty and still flagged', async () => {
    globalThis.fetch = (async () =>
      json({ features: [], exceededTransferLimit: true })) as any;
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.violationsChecked).toBe(false);
  });

  it('still succeeds on a genuine empty result, flag absent', async () => {
    // The honest zero must keep working, or the fix above is useless.
    globalThis.fetch = (async () => json({ features: [] })) as any;
    const r = await run();
    expect(r.ok).toBe(true);
    expect(r.violationsChecked).toBe(true);
    expect(r.violations).toHaveLength(0);
  });
});

describe('Codex R9-02: rows that cannot be read are not zero rows', () => {
  it('refuses when every layer returns an unrecognisable row', async () => {
    // Codex's exact case: all four layers answer 200 with one row whose
    // attributes have no identity field. Every source returned something,
    // none of it could be read, and the old code reported the property as
    // successfully searched and clean.
    globalThis.fetch = (async () =>
      json({ features: [{ attributes: { unexpected: 'shape' } }] })) as any;
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.violationsChecked).toBe(false);
    expect(r.violations).toHaveLength(0);
    expect(r.notes.join(' ')).toMatch(/incomplete|could not be read/i);
  });

  it('refuses a feature with no attributes object at all', async () => {
    globalThis.fetch = (async () => json({ features: [{ geometry: null }] })) as any;
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.violationsChecked).toBe(false);
  });

  it('refuses when ONE layer drifts while the others read fine', async () => {
    // The dangerous shape: three layers genuinely clean, one renamed. The
    // report must not say "searched" on the strength of the three.
    globalThis.fetch = (async (u: any) => {
      const url = new URL(String(u));
      return url.pathname.includes('Open_Building_Violations')
        ? json({ features: [{ attributes: { SOMETHING_ELSE: 'x' } }] })
        : json({ features: [] });
    }) as any;
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.violationsChecked).toBe(false);
  });
});

// Found by the Broward envelope sweep rather than by a reviewer: this adapter
// checked only `exceededTransferLimit`, so a response signalling more rows any
// other way would have stopped paging early and published a prefix as a
// complete list - R8-02's defect through a signal it did not cover.
describe('every way a response can say it is incomplete', () => {
  it('fails closed on a continuation token, and the stub REQUIRES the token', async () => {
    // Codex R5-01 rejected my previous version of this test, correctly: its
    // stub returned the second record whenever the offset changed to 200,
    // without ever checking that the token was sent, so it rewarded code that
    // detected the token and threw it away. The outcome matched my code
    // instead of the protocol.
    //
    // This stub serves record B ONLY to a request that actually carries
    // resultPaginationToken=next-B. A guessed offset gets an empty page, so
    // offset paging CANNOT satisfy it, and the read must refuse rather than
    // publish A as a complete search. B carries a recorded lien, which is
    // what makes the silent prefix dangerous.
    const sentTokens: string[] = [];
    const offsets: string[] = [];
    globalThis.fetch = (async (u: any) => {
      const url = new URL(String(u));
      if (!url.pathname.includes('CodeComplianceViolation_Open_View')) {
        return json({ features: [] });
      }
      const tok = url.searchParams.get('resultPaginationToken');
      offsets.push(url.searchParams.get('resultOffset') ?? '0');
      if (tok) {
        sentTokens.push(tok);
        return tok === 'next-B'
          ? json({ features: [{ attributes: { CASE_NUM: 'B', LN_RECBOOK: '12345', LN_RECPAGE: '678' } }] })
          : json({ features: [] });
      }
      // A SHORT first page, well under the 200-row request, carrying a token.
      // Offset paging would stop here and call one record the whole answer.
      return url.searchParams.get('resultOffset') === '0'
        ? json({ features: [{ attributes: { CASE_NUM: 'A' } }], resultPaginationToken: 'next-B' })
        : json({ features: [] });
    }) as any;

    const r = await run();
    // Fail closed: no clean result, and nothing published.
    expect(r.ok).toBe(false);
    expect(r.violationsChecked).toBe(false);
    expect(r.violations).toHaveLength(0);
    expect(r.notes.join(' ')).toMatch(/incomplete|could not be read/i);
    // And the point of the test: the adapter never obtained B by guessing.
    expect(sentTokens).toEqual([]);
    expect(r.violations.map((v) => v.caseNumber)).not.toContain('A');
  });

  it('refuses a token even when the first page fills the whole request', async () => {
    // The other shape: a full 200-row page WITH a token. Offset paging would
    // march on to 400 and could skip whatever the token actually points at.
    globalThis.fetch = (async (u: any) => {
      const url = new URL(String(u));
      if (!url.pathname.includes('CodeComplianceViolation_Open_View')) {
        return json({ features: [] });
      }
      // Only the FIRST page is served. Offset paging would read the empty
      // second page as the end and publish these 200 rows as the complete
      // list, while the token says there is more somewhere it never asked.
      return url.searchParams.get('resultOffset') === '0'
        ? json({
            features: Array.from({ length: 200 }, (_, i) => ({ attributes: { CASE_NUM: `C${i}` } })),
            resultPaginationToken: 'more',
          })
        : json({ features: [] });
    }) as any;
    const r = await run();
    expect(r.ok).toBe(false);
    expect(r.violationsChecked).toBe(false);
    expect(r.violations).toHaveLength(0);
  });

  it('ignores an empty or non-string token, which is not a continuation', async () => {
    globalThis.fetch = (async () => json({ features: [], resultPaginationToken: '' })) as any;
    let r = await run();
    expect(r.ok).toBe(true);
    expect(r.violationsChecked).toBe(true);
    globalThis.fetch = (async () => json({ features: [], resultPaginationToken: null })) as any;
    r = await run();
    expect(r.ok).toBe(true);
    expect(r.violationsChecked).toBe(true);
  });

  it('pages on the geojson envelope form of the flag', async () => {
    const offsets: string[] = [];
    globalThis.fetch = (async (u: any) => {
      const url = new URL(String(u));
      if (!url.pathname.includes('CodeComplianceViolation_Open_View')) {
        return json({ features: [] });
      }
      const off = url.searchParams.get('resultOffset') ?? '0';
      offsets.push(off);
      return off === '0'
        ? json({ features: [{ attributes: { CASE_NUM: 'A' } }], properties: { exceededTransferLimit: true } })
        : json({ features: [] });
    }) as any;
    const r = await run();
    // It must ASK for the next page. The second page is complete and empty,
    // so the read then finishes honestly with the one case it found - my
    // first version of this test asserted a failure here and was simply
    // wrong about the behaviour.
    expect(offsets.slice(0, 2)).toEqual(['0', '200']);
    expect(r.ok).toBe(true);
    expect(r.violationsChecked).toBe(true);
    expect(r.violations.map((v) => v.caseNumber)).toEqual(['A']);
  });

  it('treats an explicit exceededTransferLimit: false as the end', async () => {
    // Over-reading completeness would make every folio unreadable.
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return json({ features: [], exceededTransferLimit: false });
    }) as any;
    const r = await run();
    expect(r.ok).toBe(true);
    expect(r.violationsChecked).toBe(true);
    expect(calls).toBe(4);
  });
});
