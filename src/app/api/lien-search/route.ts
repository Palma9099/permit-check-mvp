import { NextRequest, NextResponse } from 'next/server';
import { compactFolio, paByAddress } from '@/lib/miami-dade-raw';
import { geocode } from '@/lib/geocode';
import { DEFAULT_LIEN_COUNTY, getLienProvider, runLienSearch } from '@/lib/lien-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Public: run the automated part of a lien search for an address or parcel
// number, in whichever Florida county the address is in. County records only,
// no AI, so it is fast and free to run.
//
// Which county is resolved from the parcel point, never from the postal city:
// a mailing address in "Miami, FL" is usually not in the City of Miami, and
// county lines run through postal areas too.
export async function POST(req: NextRequest) {
  let body: { query?: string; county?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }
  const query = String(body.query ?? '').trim().slice(0, 200);
  if (!query) return NextResponse.json({ error: 'Enter an address or parcel number.' }, { status: 400 });

  const digits = query.replace(/\D+/g, '');
  // Digits, spaces and dashes only: a Miami-Dade folio, a Broward folio, or
  // another county's parcel id, which in several counties carries its spaces
  // as part of the stored value (Monroe's look like "1362 38 00483401009200").
  // A county whose ids contain letters is searched by address instead.
  const looksLikeParcel = /^[\d\s-]+$/.test(query) && digits.length >= 10 && digits.length <= 24;

  // A bare parcel number carries no county. The caller can name one; failing
  // that the two counties with live sources are told apart by the shape of
  // their folio, which is unambiguous: Miami-Dade writes 13 digits, Broward
  // 12. Guessing by padding a 12-digit Broward folio to 13 would silently
  // search a different property in Miami-Dade, which is the one outcome worth
  // ruling out here.
  if (looksLikeParcel) {
    const named = String(body.county ?? '').trim();
    const countyKey = named || (digits.length === 12 ? 'broward' : DEFAULT_LIEN_COUNTY);
    const provider = getLienProvider(countyKey);
    if (!provider) return NextResponse.json({ error: `No lien search is set up for "${countyKey}".` }, { status: 400 });
    // Pass the number through as typed outside Miami-Dade: each county's own
    // layer decides how to normalize it, and stripping the spaces here would
    // stop a Monroe parcel id from matching at all.
    const parcelId = countyKey === 'miami-dade' ? compactFolio(digits) : query;
    const result = await runLienSearch(parcelId, countyKey);
    if (!result.address) {
      return NextResponse.json(
        { error: `No ${provider.countyName} parcel found for ${provider.parcelLabel.toLowerCase()} ${result.prettyFolio}.` },
        { status: 404 },
      );
    }
    return NextResponse.json({ ...result, matchNote: null });
  }

  // An address: Miami-Dade's Property Appraiser address search first, since it
  // matches the typed house number exactly. Everything else goes through the
  // geocoder to a point, then the county's own parcel layer.
  const zip = query.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? null;
  const mdFolio = await paByAddress(query, zip).then((r) => r.folio).catch(() => null);
  if (mdFolio) {
    const result = await runLienSearch(mdFolio, 'miami-dade');
    if (result.address) return NextResponse.json({ ...result, matchNote: null });
  }

  const g = await geocode(query).catch(() => null);
  if (!g) {
    return NextResponse.json({ error: 'That address could not be located. Try the parcel number.' }, { status: 404 });
  }
  const provider = getLienProvider(g.county);
  if (!provider) {
    return NextResponse.json(
      {
        error: g.county
          ? `That address is in ${g.county}, which is outside Florida or not a county we search.`
          : 'That address is not in a Florida county we search.',
      },
      { status: 404 },
    );
  }

  // Miami-Dade gets one more try at its own address search with the
  // geocoder's spelling before falling back to the map point.
  if (provider.county === 'miami-dade') {
    const f = await paByAddress(g.formattedAddress, g.matchedZip ?? zip).then((r) => r.folio).catch(() => null);
    if (f) {
      const result = await runLienSearch(f, 'miami-dade');
      if (result.address) return NextResponse.json({ ...result, matchNote: null });
    }
  }

  // A map point is only trustworthy on a rooftop-accurate, high-confidence
  // match, and even then the reader is told to confirm the parcel.
  if (g.confidence !== 'high' || g.locationType !== 'ROOFTOP') {
    return NextResponse.json(
      { error: `That address could not be matched to a single ${provider.countyName} parcel. Try the ${provider.parcelLabel.toLowerCase()}.` },
      { status: 404 },
    );
  }
  const parcelId = await provider.parcelAtPoint(g.lat, g.lng).catch(() => null);
  if (!parcelId) {
    return NextResponse.json(
      { error: `No ${provider.countyName} parcel was found at that address. Try the ${provider.parcelLabel.toLowerCase()}.` },
      { status: 404 },
    );
  }
  const result = await runLienSearch(parcelId, provider.county);
  if (!result.address) {
    return NextResponse.json(
      { error: `No ${provider.countyName} parcel found for ${provider.parcelLabel.toLowerCase()} ${result.prettyFolio}.` },
      { status: 404 },
    );
  }
  return NextResponse.json({
    ...result,
    matchNote: `Matched by map location, not by address. Confirm the ${provider.parcelLabel.toLowerCase()} and address before relying on this search.`,
  });
}
