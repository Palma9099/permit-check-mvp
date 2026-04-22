import { NextRequest, NextResponse } from 'next/server';
import { runDiagnostic } from '@/lib/orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: { address?: string; folio?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Body must be JSON of shape { address?: string; folio?: string }' },
      { status: 400 },
    );
  }
  if (!body.address && !body.folio) {
    return NextResponse.json(
      { error: 'Provide either an address or a folio.' },
      { status: 400 },
    );
  }
  try {
    const report = await runDiagnostic({ address: body.address, folio: body.folio });
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Unknown error' },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    usage: 'POST { address?: string; folio?: string }',
  });
}
