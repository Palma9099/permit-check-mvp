import { NextRequest, NextResponse } from 'next/server';
import { adminKeyOk } from '@/lib/verified';
import { getLienRecord, revokeLienRecord } from '@/lib/lien-records';
import { SITE_ORIGIN } from '@/lib/record-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const clean = (v: unknown, max = 500) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '') || null;

// Staff only: withdraw a lien search already delivered to a title company.
//
// A reason is required and is shown to the client, because the client is
// holding the PDF: a link that silently stops working reads as a broken link,
// and they will use the copy they have. The withdrawal has to say so in words
// they can act on.
export async function POST(req: NextRequest) {
  if (!adminKeyOk(req.headers.get('x-admin-key'))) {
    return NextResponse.json({ error: 'Staff key required.' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const id = clean(body?.id, 20);
  if (!id || !/^LS-[A-Z0-9]{10}$/.test(id)) {
    return NextResponse.json({ error: 'A record id like LS-7K3Q9X2M4P is required.' }, { status: 400 });
  }
  const by = clean(body?.by, 80);
  if (!by) return NextResponse.json({ error: 'Add the name of the person withdrawing it.' }, { status: 400 });
  const reason = clean(body?.reason, 500);
  if (!reason || reason.length < 12) {
    return NextResponse.json(
      { error: 'Give the client a reason, in a sentence they can act on. It is shown to them.' },
      { status: 400 },
    );
  }
  const replacedBy = clean(body?.replacedBy, 20);
  if (replacedBy && !/^LS-[A-Z0-9]{10}$/.test(replacedBy)) {
    return NextResponse.json({ error: 'The replacement id does not look like a record id.' }, { status: 400 });
  }

  // A failed lookup must not be reported as a wrong id: staff would retype it
  // and conclude the search was never published, while the bad one stays live.
  const look = await getLienRecord(id);
  if (!look.ok) {
    return NextResponse.json(
      { error: `Could not check that search: ${look.detail}. Nothing was withdrawn. Try again.` },
      { status: 503 },
    );
  }
  const existing = look.record;
  if (!existing) return NextResponse.json({ error: 'No search with that id.' }, { status: 404 });
  if (existing.status === 'revoked') {
    return NextResponse.json(
      { error: `That search was already withdrawn${existing.revoked_at ? ` on ${existing.revoked_at.slice(0, 10)}` : ''}.` },
      { status: 409 },
    );
  }
  // A replacement has to exist and be live, or the client is sent to a dead
  // end at the moment they most need the corrected search.
  if (replacedBy) {
    if (replacedBy === id) {
      return NextResponse.json({ error: 'A search cannot replace itself.' }, { status: 400 });
    }
    const rl = await getLienRecord(replacedBy);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Could not check the replacement search: ${rl.detail}. Nothing was withdrawn.` },
        { status: 503 },
      );
    }
    const replacement = rl.record;
    if (!replacement || replacement.status !== 'final') {
      return NextResponse.json(
        { error: 'The replacement search does not exist or is not final. Publish the corrected search first.' },
        { status: 400 },
      );
    }
  }

  let rec;
  try {
    rec = await revokeLienRecord(id, by, reason, replacedBy);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
  if (!rec) return NextResponse.json({ error: 'Could not withdraw that search.' }, { status: 500 });

  return NextResponse.json({
    id: rec.id,
    status: rec.status,
    revoked_at: rec.revoked_at,
    url: `${SITE_ORIGIN}/lien/${rec.id}`,
    // Telling staff who to ring is the point: the client has the old PDF.
    client: rec.client?.email ?? null,
  });
}
