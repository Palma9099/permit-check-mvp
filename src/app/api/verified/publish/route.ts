import { NextRequest, NextResponse } from 'next/server';
import { VERIFIED_CHECKS, adminKeyOk, publishVerified, type VerifiedCheck } from '@/lib/verified';
import { LATEST_COUNTY_SERVICE, countyExportUrl } from '@/lib/images/county-aerials';
import { displayBboxFor } from '@/lib/images/historical-aerial';
import { lotCenterByFolio } from '@/lib/miami-dade-raw';
import { SITE_ORIGIN, toneFromCode } from '@/lib/record-token';
import type { Tier } from '@/lib/verified-checks';
import { itemValue, recordFrom } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Staff only: publish a Palma Verified record. Every check must be confirmed;
// the reviewer's name goes on the record.
export async function POST(req: NextRequest) {
  if (!adminKeyOk(req.headers.get('x-admin-key'))) return NextResponse.json({ error: 'Staff key required.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const p = recordFrom(body?.record);
  if (!p || !p.f) return NextResponse.json({ error: 'That record link is not valid.' }, { status: 400 });

  const tier: Tier = body?.tier === 'instant' ? 'instant' : 'premium';
  let reviewer: string;
  let checks: VerifiedCheck[];
  if (tier === 'instant') {
    // Automated: what the signed report shows, item by item. No sign-off.
    reviewer = 'Automated records check';
    checks = p.i.map(([label, tone, value, detail], n) => ({ key: `r${n}`, label, value, tone: toneFromCode(tone), ok: tone === 'g', note: detail }));
  } else {
    reviewer = String(body?.reviewer ?? '').trim().slice(0, 80);
    if (!reviewer) return NextResponse.json({ error: 'Add the reviewer name.' }, { status: 400 });
    const given = (body?.checks ?? {}) as Record<string, { ok?: boolean; note?: string }>;
    checks = VERIFIED_CHECKS.map((c) => ({
      key: c.key,
      label: c.label,
      ok: given[c.key]?.ok === true,
      note: String(given[c.key]?.note ?? '').trim().slice(0, 240) || undefined,
    }));
    const missing = checks.filter((c) => !c.ok).map((c) => c.label);
    if (missing.length) return NextResponse.json({ error: `Not every check is confirmed: ${missing.join('; ')}.` }, { status: 400 });
  }

  const roofYear = Number(body?.roofYear);
  const center = await lotCenterByFolio(p.f).catch(() => null);
  const hero = center ? countyExportUrl(LATEST_COUNTY_SERVICE, displayBboxFor(center.lat, center.lng, null)) : null;

  try {
    const rec = await publishVerified({
      folio: p.f.replace(/\D+/g, ''),
      tier,
      address: p.a,
      reviewer,
      checks,
      summary: {
        score: p.s,
        band: p.b,
        roofYear: Number.isFinite(roofYear) && roofYear > 1900 && roofYear <= new Date().getFullYear() ? roofYear : null,
        floodZone: itemValue(p, /flood/i),
      },
      notes: String(body?.notes ?? '').trim().slice(0, 600) || null,
      hero_image: hero,
    });
    return NextResponse.json({ id: rec.id, url: `${SITE_ORIGIN}/verified/${rec.id}`, expiresAt: rec.expires_at });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
