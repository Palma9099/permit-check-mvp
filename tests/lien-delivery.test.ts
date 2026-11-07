// What a client gets when they come back to a search.
//
// The read side is the half that protects people: the title company already
// has the PDF, so what the link says next is the whole safeguard. These tests
// pin the distinction the feature exists for, which is that "withdrawn" and
// "not found" are different answers and only one of them is honest here.

import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { getLienRecord, recordFound } from '@/lib/lien-records';
import { installSupabaseStub, lienRow, type Stub } from './supabase-stub';

let stub: Stub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

const pdf = async (id: string) => {
  const { GET } = await import('@/app/lien/[id]/pdf/route');
  const req = new NextRequest(`https://test.palma.invalid/lien/${id}/pdf`);
  const res = await GET(req, { params: { id } });
  return res;
};

describe('the PDF of a withdrawn search', () => {
  it('answers 410, not 404, because the search existed and was pulled back', async () => {
    stub = installSupabaseStub([
      lienRow({
        status: 'revoked',
        revoked_at: '2026-11-05T15:00:00.000Z',
        revoked_reason: 'A code lien recorded on 10/14/2026 was missed.',
        replaced_by: 'LS-REPLACEMEN',
      }),
    ]);
    const res = await pdf('LS-ABCDEFGHJK');
    expect(res.status).toBe(410);

    const body = await res.json();
    expect(body.error).toMatch(/withdrawn/i);
    expect(body.reason).toMatch(/code lien/i);
    expect(body.replacedBy).toBe('LS-REPLACEMEN');
    expect(body.call).toBeTruthy(); // a phone number, because they are mid-closing
  });

  it('answers 404 for a link that never existed', async () => {
    stub = installSupabaseStub([]);
    expect((await pdf('LS-NOSUCHIDXX')).status).toBe(404);
  });

  it('never serves the old PDF bytes once withdrawn', async () => {
    stub = installSupabaseStub([lienRow({ status: 'revoked' })]);
    const res = await pdf('LS-ABCDEFGHJK');
    expect(res.headers.get('content-type')).not.toMatch(/application\/pdf/);
  });
});

describe('reading a record', () => {
  it('refuses an id that is not the right shape without querying', async () => {
    stub = installSupabaseStub([lienRow()]);
    expect(await getLienRecord('nope')).toBeNull();
    expect(await getLienRecord('LS-short')).toBeNull();
    expect(stub.calls).toHaveLength(0);
  });

  it('returns a withdrawn record rather than hiding it, so pages can explain it', async () => {
    // getLienRecord deliberately does not filter by status: the page needs the
    // record in order to say it was withdrawn and why.
    stub = installSupabaseStub([lienRow({ status: 'revoked' })]);
    const rec = await getLienRecord('LS-ABCDEFGHJK');
    expect(rec?.status).toBe('revoked');
  });
});

describe('counting what the client has to resolve', () => {
  it('adds the county lines and the staff findings', () => {
    const rec = lienRow({
      search: { found: 2 },
      staff: [
        { key: 'taxes', result: 'found' },
        { key: 'records', result: 'clear' },
        { key: 'utilities', result: 'found' },
      ],
    });
    expect(recordFound(rec as any)).toBe(4);
  });

  it('is zero on a clear search', () => {
    const rec = lienRow({ search: { found: 0 }, staff: [{ key: 'taxes', result: 'clear' }] });
    expect(recordFound(rec as any)).toBe(0);
  });
});
