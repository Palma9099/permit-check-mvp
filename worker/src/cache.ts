// Portal-result cache (worker side). After a SUCCESSFUL scrape we upsert the
// result into portal_results so a repeat lookup - and eventually the instant
// /api/check report - can reuse it without re-driving the portal.
//
// Only ok:true results are cached: a transient miss (CAPTCHA, layout drift) must
// never be persisted, or it would suppress future scrapes of that parcel. This
// is best-effort - a cache-write failure is logged and never breaks the job.

import type { ScanJob, ScrapeResult } from './types.js';

const URL_BASE = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SECRET_KEY ?? '';

// Normalize a free-text address into a stable cache key. MUST match the app-side
// normalization in src/lib/portal-cache.ts so reads find what the worker wrote.
export function addressKey(address: string | null | undefined): string | null {
  if (!address) return null;
  const k = address.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  return k || null;
}

export async function cachePortalResult(job: ScanJob, result: ScrapeResult): Promise<void> {
  if (!URL_BASE || !KEY) return;
  if (!result.ok) return; // never cache a miss

  const folio = (job.folio ?? result.folio ?? '').trim() || null;
  const addrKey = folio ? null : addressKey(job.address ?? result.matchedAddress);
  if (!folio && !addrKey) return; // nothing stable to key on

  try {
    const res = await fetch(URL_BASE + '/rest/v1/portal_results?on_conflict=cache_key', {
      method: 'POST',
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        county: job.county ?? result.county ?? 'unknown',
        folio,
        address_key: addrKey,
        ok: result.ok,
        result,
        source: result.source ?? null,
        scraped_at: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      console.error(`[worker] cache write ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  } catch (e: any) {
    console.error(`[worker] cache write failed for ${job.id}: ${e?.message ?? e}`);
  }
}
