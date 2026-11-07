import { NextRequest, NextResponse } from 'next/server';
import { adminKeyOk, getVerified, revokeVerified } from '@/lib/verified';
import { SITE_ORIGIN } from '@/lib/record-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const clean = (v: unknown, max = 500) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '') || null;

// Staff only: withdraw a published Palma Verified or Palma Checked record.
//
// The reason is public, because the seal was public. A badge went out on a live
// listing and buyers were shown it; "No longer verified" with no explanation
// reads like an expiry, and an expiry means the record was once right.
export async function POST(req: NextRequest) {
  if (!adminKeyOk(req.headers.get('x-admin-key'))) {
    return NextResponse.json({ error: 'Staff key required.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const id = clean(body?.id, 20);
  if (!id || !/^PV-[A-Z0-9]{6,10}$/.test(id)) {
    return NextResponse.json({ error: 'A record id like PV-7K3Q9X2 is required.' }, { status: 400 });
  }
  const by = clean(body?.by, 80);
  if (!by) return NextResponse.json({ error: 'Add the name of the person withdrawing it.' }, { status: 400 });
  const reason = clean(body?.reason, 500);
  if (!reason || reason.length < 12) {
    return NextResponse.json(
      { error: 'Give a reason in a sentence. It is shown publicly on the record page.' },
      { status: 400 },
    );
  }

  const look = await getVerified(id);
  if (!look.ok) {
    return NextResponse.json(
      { error: `Could not check that record: ${look.detail}. Nothing was withdrawn. Try again.` },
      { status: 503 },
    );
  }
  const existing = look.record;
  if (!existing) return NextResponse.json({ error: 'No record with that id.' }, { status: 404 });
  if (existing.status === 'revoked') {
    return NextResponse.json(
      { error: `That record was already withdrawn${existing.revoked_at ? ` on ${existing.revoked_at.slice(0, 10)}` : ''}.` },
      { status: 409 },
    );
  }

  let rec;
  try {
    rec = await revokeVerified(id, by, reason);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
  if (!rec) return NextResponse.json({ error: 'Could not withdraw that record.' }, { status: 500 });

  return NextResponse.json({
    id: rec.id,
    status: rec.status,
    revoked_at: rec.revoked_at,
    url: `${SITE_ORIGIN}/verified/${rec.id}`,
    // The listing badge caches for 60 seconds, so it clears on its own shortly.
    badgeClearsIn: '60 seconds',
    // Said plainly because it is the part a person has to do: the seal may be
    // pasted into a listing, a flyer or an email that this app cannot reach.
    note: 'Ask the agent to remove the seal from the listing and any flyer.',
  });
}
