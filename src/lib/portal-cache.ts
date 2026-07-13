// Portal-result cache (app side, read). Looks up a fresh deep-scan result for a
// parcel so the instant /api/check report and the /api/deep-scan enqueue can
// reuse portal data the worker already read - no re-scrape. Writes happen only
// in the worker (worker/src/cache.ts); this side is read-only.
//
// Keys must match the worker's exactly: folio when known, else a normalized
// address. See migrations/0002_portal_results.sql for the generated cache_key.

import type { DeepScanResult } from './scan-queue';

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SECRET_KEY;
const DEFAULT_TTL_DAYS = 45;

// MUST match worker/src/cache.ts addressKey().
export function portalAddressKey(address: string | null | undefined): string | null {
  if (!address) return null;
  const k = address.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  return k || null;
}

function cacheKey(county: string, folio: string | null, address: string | null | undefined): string | null {
  const c = county.toLowerCase();
  if (folio && folio.trim()) return `${c}|f:${folio.trim()}`;
  const ak = portalAddressKey(address);
  if (ak) return `${c}|a:${ak}`;
  return null;
}

export interface CachedPortal {
  result: DeepScanResult;
  scrapedAt: string;
}

// Return a cached, successful portal result for this parcel if one exists and is
// newer than maxAgeDays; otherwise null. Never throws.
export async function getFreshPortalResult(input: {
  county: string | null;
  folio?: string | null;
  address?: string | null;
  maxAgeDays?: number;
}): Promise<CachedPortal | null> {
  if (!SUPA_URL || !SUPA_KEY || !input.county) return null;
  const key = cacheKey(input.county, input.folio ?? null, input.address);
  if (!key) return null;

  const cutoff = new Date(Date.now() - (input.maxAgeDays ?? DEFAULT_TTL_DAYS) * 86400_000).toISOString();
  const url =
    `${SUPA_URL.replace(/\/$/, '')}/rest/v1/portal_results` +
    `?select=result,scraped_at&ok=is.true&cache_key=eq.${encodeURIComponent(key)}` +
    `&scraped_at=gte.${encodeURIComponent(cutoff)}&limit=1`;
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    if (Array.isArray(rows) && rows[0]?.result) {
      return { result: rows[0].result as DeepScanResult, scrapedAt: rows[0].scraped_at };
    }
    return null;
  } catch {
    return null;
  }
}
