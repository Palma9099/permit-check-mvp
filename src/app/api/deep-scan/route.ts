import { NextRequest, NextResponse } from 'next/server';
import { geocode, reverseCounty } from '@/lib/geocode';
import { enqueueScan, scanQueueConfigured } from '@/lib/scan-queue';
import { municipalityAt } from '@/lib/lien-providers/municipality';

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

  // Geocode so the worker knows the county. The worker does NOT re-resolve it:
  // `runScrapeForJob` dispatches on the county it is handed and returns "no
  // county adapter" when that is empty. An earlier comment here claimed
  // otherwise, which is how the gap below survived.
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
      /* ignore - handled by the county fallback below */
    }
  }

  // The Census geocoder does not return a county at all (`geocodeCensus`
  // hardcodes county: null - its oneline endpoint has no reliable county
  // field), and it is the fallback whenever the Google key is absent or Google
  // fails. `resolveJurisdiction` needs BOTH county and municipality to select
  // a city, so on that path a valid Tampa address resolved to nothing at all:
  // municipality "Tampa", county null, no adapter, "no county adapter" back to
  // the reader.
  //
  // `reverseCounty` was written for exactly this ("when Census is the only
  // geocoder available we still need a county") and was never wired in here.
  // A failure leaves county null, which is unknown, not a guess.
  if (!county && lat != null && lng != null) {
    try {
      county = await reverseCounty(lat, lng);
    } catch {
      county = null;
    }
  }

  // Which municipality the PARCEL POINT sits in, which is what picks the city's
  // own code adapter over its county's. Without this the worker fell back to
  // the county every time, and in most Florida counties that search covers
  // unincorporated land only - so a City of Tampa address was answered by
  // Hillsborough County's unincorporated search, which holds none of Tampa.
  //
  // Resolved from Census incorporated-place boundaries at the point, NEVER from
  // the postal city in the typed address: mail addressed to "Miami, FL" is
  // usually not in the City of Miami.
  //
  // One distinction this column cannot carry: `municipalityAt` returns null for
  // a parcel genuinely outside every city, and throws when the boundary source
  // does not answer. Both end up as null here, so the worker cannot tell "this
  // really is unincorporated, and the county IS the authority" from "we never
  // found out". That is survivable only because the county adapters disclose
  // the gap themselves - `coverageNote` says finding nothing in an
  // unincorporated-only search says nothing about a parcel inside a city - so
  // neither case can produce a clean result it has not earned. What we never do
  // is guess a city to fill the column.
  let municipality: string | null = null;
  if (lat != null && lng != null) {
    try {
      municipality = await municipalityAt(lat, lng);
    } catch {
      municipality = null;
    }
  }

  try {
    const { id } = await enqueueScan({
      email,
      address: address || null,
      folio: folio || null,
      county,
      municipality,
      lat,
      lng,
    });
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
