// Withdrawing a Palma Verified or Palma Checked record.
//
// This one carries a seal that was shown to buyers and a badge that was
// embedded in a live listing, so the property that matters most is the first
// one tested: a withdrawn record is never live again, whatever its expiry says.

import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { isLive, liveVerifiedForFolio } from '@/lib/verified';
import { installSupabaseStub, verifiedRow, type Stub } from './supabase-stub';

let stub: Stub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

const post = async (body: any, key: string | null = 'test-staff-key') => {
  const { POST } = await import('@/app/api/verified/revoke/route');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key !== null) headers['x-admin-key'] = key;
  const req = new NextRequest('https://test.palma.invalid/api/verified/revoke', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  return { status: res.status, json: await res.json() };
};

const GOOD = {
  id: 'PV-ABCDEFG',
  by: 'A. Palma',
  reason: 'A 2019 roof permit was finalled under a different folio; the roof age shown is wrong.',
};

describe('a withdrawn record is not live', () => {
  it('is dead even when its expiry is a year away', async () => {
    const year = 1000 * 60 * 60 * 24 * 365;
    const rec = verifiedRow({ status: 'revoked', expires_at: new Date(Date.now() + year).toISOString() });
    expect(isLive(rec as any)).toBe(false);
  });

  it('is still live while verified and unexpired', async () => {
    expect(isLive(verifiedRow() as any)).toBe(true);
  });

  it('drops out of the folio lookup, which is what the listing badge reads', async () => {
    stub = installSupabaseStub([verifiedRow()]);
    expect(await liveVerifiedForFolio('3049260021120')).toBeTruthy();

    stub.restore();
    stub = installSupabaseStub([verifiedRow({ status: 'revoked' })]);
    expect(await liveVerifiedForFolio('3049260021120')).toBeNull();
  });
});

describe('who may withdraw a record', () => {
  it('refuses without the staff key, and touches nothing', async () => {
    stub = installSupabaseStub([verifiedRow()]);
    expect((await post(GOOD, null)).status).toBe(401);
    expect((await post(GOOD, 'wrong-key')).status).toBe(401);
    expect(stub.calls).toHaveLength(0);
  });
});

describe('what a withdrawal must say', () => {
  it('requires an id of the right shape', async () => {
    stub = installSupabaseStub([verifiedRow()]);
    for (const id of ['', 'PV-123', 'LS-ABCDEFGHJK', 'pv-abcdefg']) {
      expect((await post({ ...GOOD, id })).status).toBe(400);
    }
  });

  it('requires a name and a real reason, because the reason is public', async () => {
    stub = installSupabaseStub([verifiedRow()]);
    expect((await post({ ...GOOD, by: '' })).status).toBe(400);
    expect((await post({ ...GOOD, reason: 'wrong' })).status).toBe(400);
  });
});

describe('withdrawing one', () => {
  it('records who, when and why, and keeps the checks', async () => {
    stub = installSupabaseStub([verifiedRow()]);
    const { status, json } = await post(GOOD);
    expect(status).toBe(200);
    expect(json.status).toBe('revoked');

    const row = stub.rows.get('PV-ABCDEFG');
    expect(row.status).toBe('revoked');
    expect(row.revoked_by).toBe('A. Palma');
    expect(row.revoked_reason).toBe(GOOD.reason);
    expect(row.checks).toHaveLength(1); // the record is kept, not emptied
  });

  it('says what the app cannot do: a seal pasted elsewhere', async () => {
    // The endpoint has to be honest about its reach, or staff will assume the
    // listing fixed itself.
    stub = installSupabaseStub([verifiedRow()]);
    const { json } = await post(GOOD);
    expect(json.note).toMatch(/listing|flyer/i);
    expect(json.badgeClearsIn).toBeTruthy();
  });

  it('refuses an unknown record and a second withdrawal', async () => {
    stub = installSupabaseStub([]);
    expect((await post(GOOD)).status).toBe(404);

    stub.restore();
    stub = installSupabaseStub([verifiedRow({ status: 'revoked' })]);
    expect((await post(GOOD)).status).toBe(409);
  });

  it('reports a database failure rather than claiming success', async () => {
    stub = installSupabaseStub([verifiedRow()]);
    stub.failNext = { status: 503, text: 'unavailable' };
    expect((await post(GOOD)).status).not.toBe(200);
  });
});
