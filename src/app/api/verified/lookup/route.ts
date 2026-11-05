import { NextRequest, NextResponse } from 'next/server';
import { liveVerifiedForFolio } from '@/lib/verified';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public: is this folio Palma Verified right now? Used by the report hero.
export async function GET(req: NextRequest) {
  const folio = req.nextUrl.searchParams.get('folio') ?? '';
  const v = await liveVerifiedForFolio(folio);
  return NextResponse.json(v ? { id: v.id, tier: v.tier, expiresAt: v.expires_at } : {}, { headers: { 'cache-control': 'public, max-age=300' } });
}
