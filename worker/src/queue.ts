// Queue access for the worker — bare PostgREST over the same Supabase project
// the app uses. Atomic claim is delegated to the claim_scan_job() SQL function
// (FOR UPDATE SKIP LOCKED), so multiple worker replicas are safe.

import type { ScanJob, ScrapeResult } from './types.js';

const URL_BASE = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SECRET_KEY ?? '';

function assertConfigured() {
  if (!URL_BASE || !KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required.');
  }
}

async function pgrest(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return fetch(URL_BASE + '/rest/v1' + path, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Atomically claim the next queued job, or null if the queue is empty. */
export async function claimJob(): Promise<ScanJob | null> {
  assertConfigured();
  const res = await pgrest('POST', '/rpc/claim_scan_job', {});
  if (!res.ok) {
    throw new Error(`claim failed: ${res.status} ${await res.text()}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? (rows[0] as ScanJob) : null;
}

export async function completeJob(id: string, result: ScrapeResult): Promise<void> {
  const res = await pgrest('PATCH', `/scan_jobs?id=eq.${encodeURIComponent(id)}`, {
    status: 'done',
    result,
    error: null,
    finished_at: new Date().toISOString(),
  });
  if (!res.ok) throw new Error(`completeJob failed: ${res.status} ${await res.text()}`);
}

/**
 * Record a failure. If the job still has attempts left it goes back to
 * 'queued' for a retry; once attempts are exhausted it's marked 'failed'.
 */
export async function failJob(job: ScanJob, error: string): Promise<'retry' | 'failed'> {
  const exhausted = job.attempts >= job.max_attempts;
  const res = await pgrest('PATCH', `/scan_jobs?id=eq.${encodeURIComponent(job.id)}`, {
    status: exhausted ? 'failed' : 'queued',
    error: error.slice(0, 2000),
    ...(exhausted ? { finished_at: new Date().toISOString() } : {}),
  });
  if (!res.ok) throw new Error(`failJob failed: ${res.status} ${await res.text()}`);
  return exhausted ? 'failed' : 'retry';
}

export async function markEmailed(id: string): Promise<void> {
  await pgrest('PATCH', `/scan_jobs?id=eq.${encodeURIComponent(id)}`, { email_sent: true });
}
