// Palma Verified: a staff-reviewed, dated record that a home's permit and code
// records were checked and every open item was closed or disclosed. Stored in
// Supabase table verified_records (migrations/0004). A code path never marks a
// home verified on its own: only the staff review page publishes one.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { absent, failed, selectOne, type Lookup } from './lookup';

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SECRET_KEY;

export { TIERS, VERIFIED_CHECKS, VERIFIED_MONTHS, VERIFIED_PRICE } from './verified-checks';
import { VERIFIED_MONTHS, type Tier } from './verified-checks';

export interface VerifiedCheck {
  key: string;
  label: string;
  ok: boolean;
  note?: string;
  // Instant tier: what the records show, with its colour (red, amber, green, grey).
  value?: string;
  tone?: string;
}

export interface VerifiedRecord {
  id: string;
  folio: string;
  address: string;
  tier: Tier;
  status: 'verified' | 'revoked';
  verified_at: string;
  expires_at: string;
  reviewer: string;
  checks: VerifiedCheck[];
  summary: { score?: number; band?: string; roofYear?: number | null; floodZone?: string | null } | null;
  notes: string | null;
  hero_image: string | null;
  // Set only when a published record is withdrawn (migrations/0007).
  revoked_at?: string | null;
  revoked_by?: string | null;
  revoked_reason?: string | null; // shown on the public page, so write it for the public
}

const table = () => (SUPA_URL && SUPA_KEY ? `${SUPA_URL.replace(/\/$/, '')}/rest/v1/verified_records` : null);
const headers = () => ({ apikey: SUPA_KEY as string, Authorization: `Bearer ${SUPA_KEY}`, 'content-type': 'application/json' });

export const isLive = (v: VerifiedRecord) => v.status === 'verified' && Date.parse(v.expires_at) > Date.now();

// Returns a Lookup, not a record: see lib/lookup.ts. The seal is public, so
// "no record" is an assertion about a paying customer and must be earned.
export async function getVerified(id: string): Promise<Lookup<VerifiedRecord>> {
  const t = table();
  if (!t) return failed('the record database is not configured');
  if (!/^PV-[A-Z0-9]{6,10}$/.test(id)) return absent();
  return selectOne<VerifiedRecord>(`${t}?select=*&id=eq.${encodeURIComponent(id)}&limit=1`, {
    cache: 'no-store',
    headers: headers(),
  });
}

// The live record for a folio, if any. A staff-reviewed ("premium") record wins
// over a newer instant one ("premium" sorts after "instant", so tier.desc).
export async function liveVerifiedForFolio(folio: string): Promise<Lookup<VerifiedRecord>> {
  const t = table();
  const f = folio.replace(/\D+/g, '');
  if (!t) return failed('the record database is not configured');
  if (f.length !== 13) return absent();
  const now = new Date().toISOString();
  // The 3 second timeout keeps the report fast; a timeout is a failure, not an
  // answer, so the caller must not cache it as "this home is not verified".
  return selectOne<VerifiedRecord>(
    `${t}?select=*&folio=eq.${f}&status=eq.verified&expires_at=gt.${encodeURIComponent(now)}&order=tier.desc,verified_at.desc&limit=1`,
    { cache: 'no-store', headers: headers(), signal: AbortSignal.timeout(3000) },
  );
}

function newId(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  const b = randomBytes(7);
  return 'PV-' + Array.from(b, (x) => A[x % A.length]).join('');
}

export async function publishVerified(input: Omit<VerifiedRecord, 'id' | 'status' | 'verified_at' | 'expires_at'>): Promise<VerifiedRecord> {
  const t = table();
  if (!t) throw new Error('Database is not configured.');
  const now = new Date();
  const exp = new Date(now);
  exp.setMonth(exp.getMonth() + VERIFIED_MONTHS);
  const row: VerifiedRecord = { ...input, id: newId(), status: 'verified', verified_at: now.toISOString(), expires_at: exp.toISOString() };
  const res = await fetch(t, { method: 'POST', headers: { ...headers(), Prefer: 'return=representation' }, body: JSON.stringify(row) });
  if (!res.ok) throw new Error(`Could not save (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json();
  return rows[0] as VerifiedRecord;
}

// Staff key check for the review page. Fails closed when no key is set.
// Withdraw a published record. The read side already honours the status
// everywhere it matters (isLive, the listing badge, the folio lookup, the
// public page), so this is the whole of the recall.
//
// Never a delete. The badge was embedded in a live listing and the seal was
// shown to buyers; afterwards the question is what Palma certified, and when
// they took it back.
export async function revokeVerified(id: string, by: string, reason: string): Promise<VerifiedRecord | null> {
  const t = table();
  if (!t || !/^PV-[A-Z0-9]{6,10}$/.test(id)) return null;
  const patch = { status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: by, revoked_reason: reason };
  const res = await fetch(`${t}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...headers(), Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Could not withdraw (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? (rows[0] as VerifiedRecord) : null;
}

export function adminKeyOk(given: string | null | undefined): boolean {
  const want = process.env.VERIFY_ADMIN_KEY;
  if (!want || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}
