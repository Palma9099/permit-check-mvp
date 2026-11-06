import { NextRequest, NextResponse } from 'next/server';
import { compactFolio } from '@/lib/miami-dade-raw';
import { runLienSearch } from '@/lib/lien-search';
import { lienSearchPdf } from '@/lib/pdf-lien-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The preliminary lien search as a PDF, re-run fresh from county records.
export async function GET(req: NextRequest) {
  const digits = (req.nextUrl.searchParams.get('folio') ?? '').replace(/\D+/g, '');
  if (digits.length < 12 || digits.length > 13) return NextResponse.json({ error: 'A 13-digit folio is required.' }, { status: 400 });
  const r = await runLienSearch(compactFolio(digits));
  if (!r.address) return NextResponse.json({ error: 'No Miami-Dade parcel found for that folio.' }, { status: 404 });
  const pdf = await lienSearchPdf(r);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="Palma-lien-search-${r.folio}.pdf"`,
      'cache-control': 'no-store',
    },
  });
}
