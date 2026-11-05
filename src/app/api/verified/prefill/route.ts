import { NextRequest, NextResponse } from 'next/server';
import { adminKeyOk } from '@/lib/verified';
import { itemValue, recordFrom } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Staff only: show what is being verified before the reviewer signs off.
export async function POST(req: NextRequest) {
  if (!adminKeyOk(req.headers.get('x-admin-key'))) return NextResponse.json({ error: 'Staff key required.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const p = recordFrom(body?.record);
  if (!p) return NextResponse.json({ error: 'That record link is not valid.' }, { status: 400 });
  return NextResponse.json({
    address: p.a,
    folio: p.f,
    score: p.s,
    band: p.b,
    checkedAt: new Date(p.t * 1000).toISOString(),
    floodZone: itemValue(p, /flood/i),
    roof: itemValue(p, /roof/i),
    toResolve: p.x,
  });
}
