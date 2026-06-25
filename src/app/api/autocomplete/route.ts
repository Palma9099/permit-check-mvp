import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Server-side proxy for Google Places Autocomplete. Keeps the Maps key on the
// server (never shipped to the client) and biases results to Florida addresses.
//
// Graceful degradation: if GOOGLE_MAPS_API_KEY is not set, or Google returns
// anything other than OK, we return an empty list. The UI then behaves exactly
// as it did before (a plain free-text address field), so this can never break
// the form — it only adds suggestions when they're available.

interface Suggestion {
  description: string;
  placeId: string;
}

export async function GET(req: NextRequest) {
  const input = (req.nextUrl.searchParams.get('input') ?? '').trim();
  if (input.length < 3) {
    return NextResponse.json({ suggestions: [] as Suggestion[] });
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return NextResponse.json({ suggestions: [] as Suggestion[] });
  }

  const url =
    'https://maps.googleapis.com/maps/api/place/autocomplete/json' +
    `?input=${encodeURIComponent(input)}` +
    '&components=country:us' +
    // Bias toward South Florida (roughly Miami → West Palm) without hard-
    // restricting, so a user can still find any FL address.
    '&location=26.4,-80.2&radius=120000' +
    '&types=address' +
    `&key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return NextResponse.json({ suggestions: [] as Suggestion[] });
    const data: any = await res.json();
    if (data.status !== 'OK' || !Array.isArray(data.predictions)) {
      return NextResponse.json({ suggestions: [] as Suggestion[] });
    }
    const suggestions: Suggestion[] = data.predictions
      .map((p: any) => ({
        description: String(p?.description ?? ''),
        placeId: String(p?.place_id ?? ''),
      }))
      // Keep Florida results only — defensive, since the bias is soft.
      .filter((s: Suggestion) => s.description && /,\s*FL\b/i.test(s.description))
      .slice(0, 6);
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] as Suggestion[] });
  }
}
