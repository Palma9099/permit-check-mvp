// Finished lien searches: the county snapshot plus what Palma staff found in
// the sources behind a captcha (taxes, Official Records, utilities, city
// letter). Stored in Supabase table lien_searches (migrations/0005). Only the
// staff page publishes one.

import { randomBytes } from 'node:crypto';
import type { LienSearch, StaffStep } from './lien-search';

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SECRET_KEY;

export interface StaffResult {
  key: StaffStep['key'];
  title: string;
  result: 'clear' | 'found';
  amount: string | null; // as staff typed it, e.g. "$1,284.16"
  note: string | null;
}

export interface LienClient {
  company: string | null;
  name: string | null;
  email: string | null;
  closingDate: string | null;
}

export interface LienRecord {
  id: string;
  folio: string;
  address: string;
  status: 'final' | 'revoked';
  searched_at: string;
  completed_at: string;
  reviewer: string;
  client: LienClient | null;
  search: LienSearch;
  staff: StaffResult[];
  notes: string | null;
  // Set only when a delivered search is withdrawn (migrations/0006).
  revoked_at?: string | null;
  revoked_by?: string | null;
  revoked_reason?: string | null; // shown to the client, so write it for them
  replaced_by?: string | null;    // id of the corrected search, when there is one
}

const table = () => (SUPA_URL && SUPA_KEY ? `${SUPA_URL.replace(/\/$/, '')}/rest/v1/lien_searches` : null);
const headers = () => ({ apikey: SUPA_KEY as string, Authorization: `Bearer ${SUPA_KEY}`, 'content-type': 'application/json' });

export async function getLienRecord(id: string): Promise<LienRecord | null> {
  const t = table();
  if (!t || !/^LS-[A-Z0-9]{10}$/.test(id)) return null;
  try {
    const res = await fetch(`${t}?select=*&id=eq.${encodeURIComponent(id)}&limit=1`, { cache: 'no-store', headers: headers() });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows[0] ? (rows[0] as LienRecord) : null;
  } catch {
    return null;
  }
}

// Ten characters from a 32-letter alphabet: the link is the only key to the
// record, so it must not be guessable.
function newId(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  return 'LS-' + Array.from(randomBytes(10), (x) => A[x % A.length]).join('');
}

export async function publishLienRecord(input: Omit<LienRecord, 'id' | 'status' | 'completed_at'>): Promise<LienRecord> {
  const t = table();
  if (!t) throw new Error('Database is not configured.');
  const row: LienRecord = { ...input, id: newId(), status: 'final', completed_at: new Date().toISOString() };
  const res = await fetch(t, { method: 'POST', headers: { ...headers(), Prefer: 'return=representation' }, body: JSON.stringify(row) });
  if (!res.ok) throw new Error(`Could not save (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json();
  return rows[0] as LienRecord;
}

// Withdraw a delivered search. The client page and the PDF already refuse
// anything that is not 'final', so this is the whole of the recall: flip the
// status and record who, when, why, and what replaces it.
//
// Deliberately not a delete. The title company is holding a PDF of the old
// search, and the question after a bad closing is "what did Palma say, and
// when did they take it back". A deleted row cannot answer that.
export async function revokeLienRecord(
  id: string,
  by: string,
  reason: string,
  replacedBy?: string | null,
): Promise<LienRecord | null> {
  const t = table();
  if (!t || !/^LS-[A-Z0-9]{10}$/.test(id)) return null;
  const patch = {
    status: 'revoked',
    revoked_at: new Date().toISOString(),
    revoked_by: by,
    revoked_reason: reason,
    replaced_by: replacedBy ?? null,
  };
  const res = await fetch(`${t}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...headers(), Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Could not withdraw (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? (rows[0] as LienRecord) : null;
}

// Items that need action across both parts: county lines plus staff findings.
export const recordFound = (r: Pick<LienRecord, 'search' | 'staff'>) => r.search.found + r.staff.filter((s) => s.result === 'found').length;
