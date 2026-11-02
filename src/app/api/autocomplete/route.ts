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

  const wantDebug = req.nextUrl.searchParams.get('debug') === '1';
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    console.error('[autocomplete] GOOGLE_MAPS_API_KEY is not set');
    return NextResponse.json({ suggestions: [] as Suggestion[], ...(wantDebug && { debug: 'no key' }) });
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
    if (!res.ok) {
      console.error(`[autocomplete] Google HTTP ${res.status}`);
      return NextResponse.json({ suggestions: [] as Suggestion[], ...(wantDebug && { debug: `http ${res.status}` }) });
    }
    const data: any = await res.json();
    if (data.status !== 'OK' || !Array.isArray(data.predictions)) {
      // ZERO_RESULTS is normal; anything else (REQUEST_DENIED, OVER_QUERY_LIMIT...) is a config problem.
      if (data.status !== 'ZERO_RESULTS') {
        console.error(`[autocomplete] Google status ${data.status}: ${data.error_message ?? ''}`);
      }
      return NextResponse.json({
        suggestions: [] as Suggestion[],
        ...(wantDebug && { debug: { status: data.status, error: data.error_message ?? null } }),
      });
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
  } catch (e) {
    console.error('[autocomplete] fetch failed', e);
    return NextResponse.json({ suggestions: [] as Suggestion[], ...(wantDebug && { debug: 'fetch failed' }) });
  }
}
