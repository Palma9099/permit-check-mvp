// Deep-scan queue helpers (app side) — talks to the same Supabase/Postgres the
// ledger uses, via bare PostgREST fetch (no extra dependency). The long-running
// worker (see /worker) consumes these rows.

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SECRET_KEY;

export function scanQueueConfigured(): boolean {
  return !!(SUPA_URL && SUPA_KEY);
}

async function pgrest(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const url = (SUPA_URL as string).replace(/\/$/, '') + '/rest/v1' + path;
  return fetch(url, {
    method,
    cache: 'no-store',
    headers: {
      apikey: SUPA_KEY as string,
      Authorization: `Bearer ${SUPA_KEY as string}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export interface EnqueueInput {
  email: string;
  address?: string | null;
  folio?: string | null;
  county?: string | null;
  lat?: number | null;
  lng?: number | null;
}

// Mirror of the worker's ScrapeResult (worker/src/types.ts). Kept in sync by
// hand — the worker writes this shape into scan_jobs.result.
export interface DeepScanResult {
  ok: boolean;
  county: string;
  matchedAddress: string | null;
  folio: string | null;
  permits: {
    permitNumber: string | null;
    type: string | null;
    status: string | null;
    issuedDate: string | null;
    finaledDate: string | null;
    description: string | null;
    value: string | null;
    contractor: string | null;
  }[];
  violations: {
    caseNumber: string | null;
    status: string | null;
    openedDate: string | null;
    closedDate: string | null;
    description: string | null;
    lastAction: string | null;
  }[];
  notes: string[];
  portalLinks: { label: string; url: string }[];
  source: string;
}

export interface ScanJobRow {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  email: string;
  address: string | null;
  folio: string | null;
  county: string | null;
  result: unknown;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export async function enqueueScan(input: EnqueueInput): Promise<{ id: string }> {
  const res = await pgrest(
    'POST',
    '/scan_jobs',
    {
      email: input.email,
      address: input.address ?? null,
      folio: input.folio ?? null,
      county: input.county ?? null,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
    },
    { Prefer: 'return=representation' },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`enqueue failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('enqueue returned no row');
  }
  return { id: rows[0].id };
}

export async function getScan(id: string): Promise<ScanJobRow | null> {
  const res = await pgrest(
    'GET',
    `/scan_jobs?select=id,status,email,address,folio,county,result,error,created_at,finished_at&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? (rows[0] as ScanJobRow) : null;
}
