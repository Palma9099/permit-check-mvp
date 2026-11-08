import { NextRequest, NextResponse } from 'next/server';
import { compactFolio } from '@/lib/miami-dade-raw';
import { DEFAULT_LIEN_COUNTY, getLienProvider, runLienSearch } from '@/lib/lien-search';
import { lienSearchPdf } from '@/lib/pdf-lien-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The preliminary lien search as a PDF, re-run fresh from county records.
// ?county= picks the county; without it the parcel number is read as a
// Miami-Dade folio, which is what it has always meant here.
export async function GET(req: NextRequest) {
  // As typed, so another county's parcel id keeps the spaces it is stored with.
  const raw = (req.nextUrl.searchParams.get('folio') ?? '').trim();
  const digits = raw.replace(/\D+/g, '');
  const countyKey = (req.nextUrl.searchParams.get('county') ?? '').trim() || DEFAULT_LIEN_COUNTY;
  const provider = getLienProvider(countyKey);
  if (!provider) return NextResponse.json({ error: `No lien search is set up for "${countyKey}".` }, { status: 400 });
  if (digits.length < 10 || digits.length > 24) {
    return NextResponse.json({ error: `A ${provider.countyName} ${provider.parcelLabel.toLowerCase()} is required.` }, { status: 400 });
  }
  const r = await runLienSearch(countyKey === 'miami-dade' ? compactFolio(digits) : raw, countyKey);
  if (!r.address) return NextResponse.json({ error: `No ${provider.countyName} parcel found for that ${provider.parcelLabel.toLowerCase()}.` }, { status: 404 });
  const pdf = await lienSearchPdf(r);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="Palma-lien-search-${r.folio}.pdf"`,
      'cache-control': 'no-store',
    },
  });
}
