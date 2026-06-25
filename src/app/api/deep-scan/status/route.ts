import { NextRequest, NextResponse } from 'next/server';
import { getScan, scanQueueConfigured } from '@/lib/scan-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Lightweight status poll for a queued deep scan. Optional — the primary
// delivery channel is email, but the UI can show "queued / running / done".
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (!scanQueueConfigured()) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const row = await getScan(id);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({
    id: row.id,
    status: row.status,
    county: row.county,
    finishedAt: row.finished_at,
    error: row.status === 'failed' ? row.error : null,
    result: row.status === 'done' ? row.result : null,
  });
}
