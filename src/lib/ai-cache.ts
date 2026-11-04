// Saved AI photo-check answers (table ai_results, migrations/0003). The AI can
// flip a borderline item from one request to the next, so the first successful
// answer for a parcel and a given set of photos is kept and reused for 30 days.
// A new photo gives a new key, so fresher imagery is always checked again.
// Never throws: with no database, or on any error, the caller just runs the AI.

import { createHash } from 'crypto';

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SECRET_KEY;
const TTL_DAYS = 30;
// Bump when the AI check changes, so answers from the old check are never reused.
const CHECK_VERSION = 'v2-opus-5-5';

export type AiKind = 'aerial' | 'street';

// Image addresses carry API keys and signatures that change per request; key
// on the address without them.
const stripSecrets = (u: string | null | undefined) =>
  (u ?? '').replace(/([?&])(key|signature|sig|se|st|sp|sv|sr|skoid|sktid|skt|ske|sks|skv|token)=[^&]*/gi, '$1').replace(/[?&]+$/, '');

export function aiCacheKey(kind: AiKind, parcel: string, parts: Array<string | number | null | undefined>): string {
  const h = createHash('sha256')
    .update([CHECK_VERSION, ...parts.map((p) => (typeof p === 'string' && p.startsWith('http') ? stripSecrets(p) : String(p ?? '')))].join('\n'))
    .digest('hex')
    .slice(0, 24);
  return `${kind}|${parcel.toLowerCase().replace(/\s+/g, ' ').trim()}|${h}`;
}

function base(): string | null {
  return SUPA_URL && SUPA_KEY ? `${SUPA_URL.replace(/\/$/, '')}/rest/v1/ai_results` : null;
}

const headers = () => ({ apikey: SUPA_KEY as string, Authorization: `Bearer ${SUPA_KEY}`, 'content-type': 'application/json' });

export async function getSavedAnswer<T>(key: string): Promise<T | null> {
  const b = base();
  if (!b) return null;
  const cutoff = new Date(Date.now() - TTL_DAYS * 86400_000).toISOString();
  try {
    const res = await fetch(`${b}?select=result&cache_key=eq.${encodeURIComponent(key)}&created_at=gte.${encodeURIComponent(cutoff)}&limit=1`, {
      cache: 'no-store',
      headers: headers(),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows[0]?.result ? (rows[0].result as T) : null;
  } catch {
    return null;
  }
}

export async function saveAnswer(key: string, kind: AiKind, result: unknown): Promise<void> {
  const b = base();
  if (!b) return;
  try {
    await fetch(`${b}?on_conflict=cache_key`, {
      method: 'POST',
      cache: 'no-store',
      headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ cache_key: key, kind, result, created_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // A failed save only means the next request runs the AI again.
  }
}
