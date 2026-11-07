// Withdrawing a lien search already delivered to a title company.
//
// What makes this worth testing is not the happy path. It is that a title
// company is holding the PDF: every way this endpoint can wrongly succeed, or
// wrongly look like a broken link, has a cost at a closing.

import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { installSupabaseStub, lienRow, type Stub } from './supabase-stub';

let stub: Stub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

const post = async (body: any, key: string | null = 'test-staff-key') => {
  const { POST } = await import('@/app/api/lien-search/revoke/route');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key !== null) headers['x-admin-key'] = key;
  const req = new NextRequest('https://test.palma.invalid/api/lien-search/revoke', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  return { status: res.status, json: await res.json() };
};

const GOOD = { id: 'LS-ABCDEFGHJK', by: 'A. Palma', reason: 'A code lien recorded on 10/14/2026 was missed.' };

describe('who may withdraw a lien search', () => {
  it('refuses with no staff key', async () => {
    stub = installSupabaseStub([lienRow()]);
    const { status } = await post(GOOD, null);
    expect(status).toBe(401);
  });

  it('refuses with the wrong staff key', async () => {
    stub = installSupabaseStub([lienRow()]);
    const { status } = await post(GOOD, 'not-the-key');
    expect(status).toBe(401);
  });

  it('refuses a key of a different length without comparing it', async () => {
    // adminKeyOk compares in constant time only for equal lengths; this is
    // here so that path keeps being exercised.
    stub = installSupabaseStub([lienRow()]);
    expect((await post(GOOD, 'short')).status).toBe(401);
  });

  it('never touches the database when the key is wrong', async () => {
    stub = installSupabaseStub([lienRow()]);
    await post(GOOD, null);
    expect(stub.calls).toHaveLength(0);
  });
});

describe('what a withdrawal must say', () => {
  it('requires a record id that looks like one', async () => {
    stub = installSupabaseStub([lienRow()]);
    for (const id of ['', 'LS-123', 'nonsense', 'PV-ABCDEFG', 'LS-abcdefghjk']) {
      expect((await post({ ...GOOD, id })).status).toBe(400);
    }
  });

  it('requires the name of the person withdrawing it', async () => {
    stub = installSupabaseStub([lienRow()]);
    const { status, json } = await post({ ...GOOD, by: '   ' });
    expect(status).toBe(400);
    expect(json.error).toMatch(/name/i);
  });

  it('requires a reason long enough to mean something, because the client reads it', async () => {
    stub = installSupabaseStub([lienRow()]);
    for (const reason of ['', 'oops', 'wrong']) {
      const { status, json } = await post({ ...GOOD, reason });
      expect(status).toBe(400);
      expect(json.error).toMatch(/reason/i);
    }
  });
});

describe('withdrawing one', () => {
  it('sets the status and records who, when and why', async () => {
    stub = installSupabaseStub([lienRow()]);
    const { status, json } = await post(GOOD);
    expect(status).toBe(200);
    expect(json.status).toBe('revoked');

    const row = stub.rows.get('LS-ABCDEFGHJK');
    expect(row.status).toBe('revoked');
    expect(row.revoked_by).toBe('A. Palma');
    expect(row.revoked_reason).toBe(GOOD.reason);
    expect(Date.parse(row.revoked_at)).toBeGreaterThan(0);
  });

  it('keeps the record rather than deleting it', async () => {
    // After a bad closing the question is what Palma said and when they took
    // it back. A deleted row cannot answer that.
    stub = installSupabaseStub([lienRow()]);
    await post(GOOD);
    const row = stub.rows.get('LS-ABCDEFGHJK');
    expect(row.search).toBeTruthy();
    expect(row.staff).toHaveLength(1);
    expect(row.reviewer).toBe('A. Palma');
    expect(stub.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('tells staff the client email, because they are holding the old PDF', async () => {
    stub = installSupabaseStub([lienRow()]);
    const { json } = await post(GOOD);
    expect(json.client).toBe('closer@test.invalid');
  });

  it('says so plainly when there is no client email to chase', async () => {
    stub = installSupabaseStub([lienRow({ client: null })]);
    const { json } = await post(GOOD);
    expect(json.client).toBeNull();
  });

  it('refuses a record that does not exist', async () => {
    stub = installSupabaseStub([]);
    const { status } = await post(GOOD);
    expect(status).toBe(404);
  });

  it('refuses to withdraw the same search twice', async () => {
    stub = installSupabaseStub([lienRow({ status: 'revoked', revoked_at: '2026-11-02T10:00:00.000Z' })]);
    const { status, json } = await post(GOOD);
    expect(status).toBe(409);
    expect(json.error).toMatch(/already withdrawn/i);
  });

  it('reports a database failure instead of claiming success', async () => {
    stub = installSupabaseStub([lienRow()]);
    stub.failNext = { status: 500, text: 'boom' };
    const { status } = await post(GOOD);
    expect(status).not.toBe(200);
  });
});

describe('naming a replacement search', () => {
  it('accepts one that exists and is final, and stores the pointer', async () => {
    stub = installSupabaseStub([lienRow(), lienRow({ id: 'LS-REPLACEMEN' })]);
    const { status } = await post({ ...GOOD, replacedBy: 'LS-REPLACEMEN' });
    expect(status).toBe(200);
    expect(stub.rows.get('LS-ABCDEFGHJK').replaced_by).toBe('LS-REPLACEMEN');
  });

  it('refuses a replacement that does not exist', async () => {
    // Otherwise the client is sent to a dead end at the moment they most need
    // the corrected search.
    stub = installSupabaseStub([lienRow()]);
    const { status, json } = await post({ ...GOOD, replacedBy: 'LS-MISSINGXX' });
    expect(status).toBe(400);
    expect(json.error).toMatch(/replacement/i);
  });

  it('refuses a replacement that is itself withdrawn', async () => {
    stub = installSupabaseStub([lienRow(), lienRow({ id: 'LS-REVOKEDXXX', status: 'revoked' })]);
    const { status } = await post({ ...GOOD, replacedBy: 'LS-REVOKEDXXX' });
    expect(status).toBe(400);
  });

  it('refuses a search that replaces itself', async () => {
    stub = installSupabaseStub([lienRow()]);
    const { status } = await post({ ...GOOD, replacedBy: 'LS-ABCDEFGHJK' });
    expect(status).toBe(400);
  });

  it('leaves the original live when the replacement is bad', async () => {
    stub = installSupabaseStub([lienRow()]);
    await post({ ...GOOD, replacedBy: 'LS-MISSINGXX' });
    expect(stub.rows.get('LS-ABCDEFGHJK').status).toBe('final');
  });
});
