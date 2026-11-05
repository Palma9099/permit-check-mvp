// Palma Verified: a staff-reviewed, dated record that a home's permit and code
// records were checked and every open item was closed or disclosed. Stored in
// Supabase table verified_records (migrations/0004). A code path never marks a
// home verified on its own: only the staff review page publishes one.

import { randomBytes, timingSafeEqual } from 'node:crypto';

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SECRET_KEY;

export { VERIFIED_CHECKS, VERIFIED_MONTHS, VERIFIED_PRICE } from './verified-checks';
import { VERIFIED_MONTHS } from './verified-checks';

export interface VerifiedCheck {
  key: string;
  label: string;
  ok: boolean;
  note?: string;
}

export interface VerifiedRecord {
  id: string;
  folio: string;
  address: string;
  status: 'verified' | 'revoked';
  verified_at: string;
  expires_at: string;
  reviewer: string;
  checks: VerifiedCheck[];
  summary: { score?: number; band?: string; roofYear?: number | null; floodZone?: string | null } | null;
  notes: string | null;
  hero_image: string | null;
}

const table = () => (SUPA_URL && SUPA_KEY ? `${SUPA_URL.replace(/\/$/, '')}/rest/v1/verified_records` : null);
const headers = () => ({ apikey: SUPA_KEY as string, Authorization: `Bearer ${SUPA_KEY}`, 'content-type': 'application/json' });

export const isLive = (v: VerifiedRecord) => v.status === 'verified' && Date.parse(v.expires_at) > Date.now();

export async function getVerified(id: string): Promise<VerifiedRecord | null> {
  const t = table();
  if (!t || !/^PV-[A-Z0-9]{6,10}$/.test(id)) return null;
  try {
    const res = await fetch(`${t}?select=*&id=eq.${encodeURIComponent(id)}&limit=1`, { cache: 'no-store', headers: headers() });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows[0] ? (rows[0] as VerifiedRecord) : null;
  } catch {
    return null;
  }
}

// The newest live record for a folio, if any.
export async function liveVerifiedForFolio(folio: string): Promise<VerifiedRecord | null> {
  const t = table();
  const f = folio.replace(/\D+/g, '');
  if (!t || f.length !== 13) return null;
  try {
    const now = new Date().toISOString();
    const res = await fetch(
      `${t}?select=*&folio=eq.${f}&status=eq.verified&expires_at=gt.${encodeURIComponent(now)}&order=verified_at.desc&limit=1`,
      { cache: 'no-store', headers: headers(), signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows[0] ? (rows[0] as VerifiedRecord) : null;
  } catch {
    return null;
  }
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
export function adminKeyOk(given: string | null | undefined): boolean {
  const want = process.env.VERIFY_ADMIN_KEY;
  if (!want || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}
