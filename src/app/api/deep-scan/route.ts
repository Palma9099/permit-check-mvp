import { NextRequest, NextResponse } from 'next/server';
import { geocode } from '@/lib/geocode';
import { enqueueScan, scanQueueConfigured } from '@/lib/scan-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Enqueue a long-running deep permit + violation scrape. Returns immediately;
// the worker (see /worker) processes it and emails the requester when done.
//
// Body: { email: string; address?: string; folio?: string }
export async function POST(req: NextRequest) {
  let body: { email?: string; address?: string; folio?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const email = String(body.email ?? '').trim();
  const address = String(body.address ?? '').trim();
  const folio = String(body.folio ?? '').trim();

  if (!/.+@.+\..+/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
  }
  if (!address && !folio) {
    return NextResponse.json({ error: 'Provide an address or folio.' }, { status: 400 });
  }
  if (!scanQueueConfigured()) {
    return NextResponse.json(
      { error: 'Deep scan is not configured (SUPABASE_URL / SUPABASE_SECRET_KEY missing).' },
      { status: 503 },
    );
  }

  // Best-effort geocode so the worker knows the county up front. Never blocks
  // the enqueue: if geocoding fails the worker can still resolve from address.
  let county: string | null = null;
  let lat: number | null = null;
  let lng: number | null = null;
  if (address) {
    try {
      const geo = await geocode(address);
      if (geo) {
        county = geo.county;
        lat = geo.lat;
        lng = geo.lng;
      }
    } catch {
      /* ignore — worker re-resolves */
    }
  }

  try {
    const { id } = await enqueueScan({ email, address: address || null, folio: folio || null, county, lat, lng });
    return NextResponse.json({
      ok: true,
      id,
      status: 'queued',
      message:
        'Your deep permit + violation scan is queued. It can take several minutes; we will email the full results to ' +
        email +
        ' when it is done.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Could not queue the scan.' }, { status: 500 });
  }
}
