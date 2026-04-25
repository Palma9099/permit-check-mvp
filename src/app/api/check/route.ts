import { NextRequest, NextResponse } from 'next/server';
import { runDiagnostic } from '@/lib/orchestrator';
import type { UserUploadedThen } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 6 MB cap on the uploaded historical photo. Vercel serverless function body
// limit is around 4.5 MB by default; we keep client-side scaling under that.
const MAX_USER_PHOTO_BYTES = 6 * 1024 * 1024;

export async function POST(req: NextRequest) {
  let body: {
    address?: string;
    folio?: string;
    userThenPhoto?: UserUploadedThen | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Body must be JSON of shape { address?: string; folio?: string; userThenPhoto?: { dataUrl, captureDate?, caption? } }' },
      { status: 400 },
    );
  }
  if (!body.address && !body.folio) {
    return NextResponse.json(
      { error: 'Provide either an address or a folio.' },
      { status: 400 },
    );
  }
  // Validate the uploaded photo if present.
  let userThenPhoto: UserUploadedThen | null = null;
  if (body.userThenPhoto?.dataUrl) {
    const url = body.userThenPhoto.dataUrl;
    if (!/^data:image\/(?:jpeg|jpg|png|webp|gif);base64,/i.test(url)) {
      return NextResponse.json(
        { error: 'userThenPhoto.dataUrl must be a base64 image data URL (jpeg/png/webp/gif).' },
        { status: 400 },
      );
    }
    if (url.length > MAX_USER_PHOTO_BYTES) {
      return NextResponse.json(
        { error: `Uploaded photo too large (>${Math.floor(MAX_USER_PHOTO_BYTES / 1024 / 1024)} MB after base64 encoding). Try a smaller image.` },
        { status: 413 },
      );
    }
    userThenPhoto = {
      dataUrl: url,
      captureDate: body.userThenPhoto.captureDate ?? null,
      caption: body.userThenPhoto.caption ?? null,
    };
  }
  try {
    const report = await runDiagnostic({
      address: body.address,
      folio: body.folio,
      userThenPhoto,
    });
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
