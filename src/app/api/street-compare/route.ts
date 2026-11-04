import { NextRequest, NextResponse } from 'next/server';
import { compareStreetHistory } from '@/lib/street-compare';
import { verifyRecordToken } from '@/lib/record-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Runs the Street View AI check for a report the site just produced. It needs
// the report's signed record link (so it cannot be used as a free AI endpoint)
// and accepts only Google Street View image addresses.
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }
  const token = typeof body?.recordToken === 'string' ? body.recordToken : '';
  const v = token ? verifyRecordToken(token) : null;
  if (!v || v.expired) return NextResponse.json({ error: 'A current report is required.' }, { status: 403 });

  const frames = (Array.isArray(body?.frames) ? body.frames : [])
    .slice(0, 4)
    .filter(
      (f: any) =>
        f && typeof f.imageUrl === 'string' && typeof f.label === 'string' && f.imageUrl.startsWith('https://maps.googleapis.com/maps/api/streetview?'),
    )
    .map((f: any) => ({ imageUrl: f.imageUrl, label: String(f.label).slice(0, 30) }));
  if (frames.length < 2) return NextResponse.json({ error: 'Need at least two Street View photos.' }, { status: 400 });

  const permits = (Array.isArray(body?.permits) ? body.permits : []).slice(0, 40).map((p: any) => ({
    issueDate: typeof p?.issueDate === 'string' ? p.issueDate.slice(0, 10) : null,
    appType: typeof p?.appType === 'string' ? p.appType.slice(0, 80) : null,
    scope: typeof p?.scope === 'string' ? p.scope.slice(0, 160) : null,
  }));
  const yearBuilt = Number.isFinite(Number(body?.yearBuilt)) ? Number(body.yearBuilt) : null;

  const result = await compareStreetHistory({ frames, permits, yearBuilt });
  return NextResponse.json(result);
}
