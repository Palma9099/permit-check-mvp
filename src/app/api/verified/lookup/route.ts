import { NextRequest, NextResponse } from 'next/server';
import { liveVerifiedForFolio } from '@/lib/verified';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public: is this folio Palma Verified right now? Used by the report hero.
export async function GET(req: NextRequest) {
  const folio = req.nextUrl.searchParams.get('folio') ?? '';
  const look = await liveVerifiedForFolio(folio);
  // A failure is not "this home has no record". Answering {} would cache that
  // false negative for a minute against a home the owner paid to certify, so
  // say 503 and let the hero leave the chip off.
  if (!look.ok) {
    return NextResponse.json({ error: look.detail }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  const v = look.record;
  return NextResponse.json(v ? { id: v.id, tier: v.tier, expiresAt: v.expires_at } : {}, { headers: { 'cache-control': 'public, max-age=60' } });
}
