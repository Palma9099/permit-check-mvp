import { NextRequest, NextResponse } from 'next/server';
import { compactFolio, folioAtPoint, paByAddress } from '@/lib/miami-dade-raw';
import { geocode } from '@/lib/geocode';
import { runLienSearch } from '@/lib/lien-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Public: run the automated part of a Miami-Dade lien search for an address or
// folio. County records only, no AI, so it is fast and free to run.
export async function POST(req: NextRequest) {
  let body: { query?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }
  const query = String(body.query ?? '').trim().slice(0, 200);
  if (!query) return NextResponse.json({ error: 'Enter an address or folio number.' }, { status: 400 });

  // A folio is 13 digits, often written 30-4926-002-1120.
  const digits = query.replace(/\D+/g, '');
  let folio: string | null = null;
  let matchNote: string | null = null;
  if (/^[\d\s-]+$/.test(query) && (digits.length === 13 || digits.length === 12)) {
    folio = compactFolio(digits);
  } else {
    // Typed address first, then the geocoder's spelling of it, then the lot
    // under a rooftop-accurate map point. A map match is flagged so the reader
    // confirms the folio before relying on it.
    const zip = query.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? null;
    folio = (await paByAddress(query, zip)).folio;
    if (!folio) {
      const g = await geocode(query).catch(() => null);
      if (g && g.county === 'miami-dade') {
        folio = (await paByAddress(g.formattedAddress, g.matchedZip ?? zip)).folio;
        if (!folio && g.confidence === 'high' && g.locationType === 'ROOFTOP') {
          folio = await folioAtPoint(g.lat, g.lng).catch(() => null);
          if (folio) matchNote = 'Matched by map location, not by address. Confirm the folio and address before relying on this search.';
        }
      }
    }
  }
  if (!folio) {
    return NextResponse.json(
      { error: 'That address was not found in the Miami-Dade Property Appraiser records. Try the folio number.' },
      { status: 404 },
    );
  }

  const result = await runLienSearch(folio);
  if (!result.address) {
    return NextResponse.json({ error: `No Miami-Dade parcel found for folio ${result.prettyFolio}.` }, { status: 404 });
  }
  return NextResponse.json({ ...result, matchNote });
}
