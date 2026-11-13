// What every surface says when the database does not answer.
//
// These all used to say the same thing as "there is no such record". That is
// the one answer none of them may give: it tells a title company their link
// is dead, tells a buyer a certified home was never certified, and tells
// staff they typed the id wrong while the bad record stays live.

import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { liveVerifiedForFolio } from '@/lib/verified';
import { installSupabaseStub, lienRow, verifiedRow, type Stub } from './supabase-stub';

let stub: Stub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

const DOWN = { status: 503, text: 'upstream connect error' };

const postRevoke = async (kind: 'lien-search' | 'verified', body: any) => {
  const mod =
    kind === 'lien-search'
      ? await import('@/app/api/lien-search/revoke/route')
      : await import('@/app/api/verified/revoke/route');
  const req = new NextRequest(`https://test.palma.invalid/api/${kind}/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-key': 'test-staff-key' },
    body: JSON.stringify(body),
  });
  const res = await mod.POST(req);
  return { status: res.status, json: await res.json() };
};

const GOOD_LIEN = { id: 'LS-ABCDEFGHJK', by: 'A. Palma', reason: 'A code lien recorded on 10/14/2026 was missed.' };
const GOOD_PV = { id: 'PV-ABCDEFG', by: 'A. Palma', reason: 'A 2019 roof permit was finalled under a different folio.' };

describe('withdrawing, when we cannot read the record first', () => {
  it('tells staff the check failed instead of "no search with that id"', async () => {
    stub = installSupabaseStub([lienRow()]);
    stub.failNext = DOWN;
    const { status, json } = await postRevoke('lien-search', GOOD_LIEN);
    expect(status).toBe(503);
    expect(json.error).toMatch(/could not check/i);
    expect(json.error).not.toMatch(/no search with that id/i);
  });

  it('says plainly that nothing was withdrawn, and withdraws nothing', async () => {
    stub = installSupabaseStub([lienRow()]);
    stub.failNext = DOWN;
    const { json } = await postRevoke('lien-search', GOOD_LIEN);
    expect(json.error).toMatch(/nothing was withdrawn/i);
    expect(stub.rows.get('LS-ABCDEFGHJK').status).toBe('final');
    expect(stub.calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('does the same for a Verified record', async () => {
    stub = installSupabaseStub([verifiedRow()]);
    stub.failNext = DOWN;
    const { status, json } = await postRevoke('verified', GOOD_PV);
    expect(status).toBe(503);
    expect(json.error).toMatch(/could not check/i);
    expect(stub.rows.get('PV-ABCDEFG').status).toBe('verified');
  });
});

describe('withdrawing, when we cannot read the REPLACEMENT', () => {
  it('does not claim the replacement is missing', async () => {
    // This one is worse than it looks: "the replacement does not exist" would
    // stop a legitimate withdrawal of a search that is actively wrong.
    stub = installSupabaseStub([lienRow(), lienRow({ id: 'LS-REPLACEMEN' })]);
    stub.failMatching = { pattern: /LS-REPLACEMEN/, ...DOWN };
    const { status, json } = await postRevoke('lien-search', { ...GOOD_LIEN, replacedBy: 'LS-REPLACEMEN' });
    expect(status).toBe(503);
    expect(json.error).toMatch(/could not check the replacement/i);
    expect(json.error).not.toMatch(/does not exist/i);
  });

  it('leaves the original live rather than half-withdrawing it', async () => {
    stub = installSupabaseStub([lienRow(), lienRow({ id: 'LS-REPLACEMEN' })]);
    stub.failMatching = { pattern: /LS-REPLACEMEN/, ...DOWN };
    await postRevoke('lien-search', { ...GOOD_LIEN, replacedBy: 'LS-REPLACEMEN' });
    expect(stub.rows.get('LS-ABCDEFGHJK').status).toBe('final');
  });
});

describe('the folio lookup behind the report chip', () => {
  const lookup = async (folio: string) => {
    const { GET } = await import('@/app/api/verified/lookup/route');
    const res = await GET(new NextRequest(`https://test.palma.invalid/api/verified/lookup?folio=${folio}`));
    return { status: res.status, cache: res.headers.get('cache-control'), json: await res.json() };
  };

  it('caches a real answer for a minute', async () => {
    stub = installSupabaseStub([verifiedRow()]);
    const { status, cache, json } = await lookup('3049260021120');
    expect(status).toBe(200);
    expect(json.id).toBe('PV-ABCDEFG');
    expect(cache).toMatch(/max-age=60/);
  });

  it('refuses to cache a failure as "this home is not verified"', async () => {
    stub = installSupabaseStub([verifiedRow()]);
    stub.failNext = DOWN;
    const { status, cache, json } = await lookup('3049260021120');
    expect(status).toBe(503);
    expect(json.id).toBeUndefined();
    expect(cache).toMatch(/no-store/);
  });

  it('still answers plainly when the home really has no record', async () => {
    stub = installSupabaseStub([]);
    const { status, json } = await lookup('3049260021120');
    expect(status).toBe(200);
    expect(json.id).toBeUndefined();
  });

  it('reports a failure to its caller rather than an empty answer', async () => {
    stub = installSupabaseStub([verifiedRow()]);
    stub.failNext = DOWN;
    expect((await liveVerifiedForFolio('3049260021120')).ok).toBe(false);
  });
});

describe('the badge sitting in a live listing', () => {
  const badge = async (id: string) => {
    const { GET } = await import('@/app/verified/[id]/badge/route');
    const res = await GET(new NextRequest(`https://test.palma.invalid/verified/${id}/badge`), { params: Promise.resolve({ id }) });
    return { cache: res.headers.get('cache-control'), svg: await res.text() };
  };

  it('says the status is unavailable, never that the record was not found', async () => {
    stub = installSupabaseStub([verifiedRow()]);
    stub.failNext = DOWN;
    const { svg } = await badge('PV-ABCDEFG');
    expect(svg).toMatch(/Status unavailable/i);
    expect(svg).not.toMatch(/not found/i);
  });

  it('does not cache that, so the badge recovers on its own', async () => {
    stub = installSupabaseStub([verifiedRow()]);
    stub.failNext = DOWN;
    expect((await badge('PV-ABCDEFG')).cache).toMatch(/no-store/);
  });

  it('still says not found when the record really is gone', async () => {
    stub = installSupabaseStub([]);
    expect((await badge('PV-ABCDEFG')).svg).toMatch(/not found/i);
  });

  it('shows the valid badge when the record is live', async () => {
    stub = installSupabaseStub([verifiedRow()]);
    const { svg } = await badge('PV-ABCDEFG');
    expect(svg).toMatch(/Valid until/i);
    expect(svg).toMatch(/Palma Verified/);
  });
});
