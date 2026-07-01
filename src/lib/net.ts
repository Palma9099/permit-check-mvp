// Shared network helper — AbortController-based timeout with a single retry.
//
// Why this exists: the report pipeline calls several upstream endpoints
// (county property-appraiser proxies, ArcGIS, Google/Census geocoders). A bare
// fetch() has NO timeout, so a single hung upstream would ride all the way to
// the Vercel serverless maxDuration (60s) and 500 the entire report. Every
// external call in the core data path should go through fetchWithTimeout so one
// slow source degrades gracefully instead of taking the whole run down.
//
// Behavior:
//   - Aborts the request after `timeoutMs` (default 12s).
//   - Retries ONCE on a timeout / network-level error (not on HTTP 4xx/5xx —
//     those are returned to the caller to decide). A tiny backoff separates
//     the two attempts.
//   - Never throws for the timeout itself in a way that hides the cause: the
//     thrown Error message is prefixed so logs are greppable.

export interface FetchWithTimeoutOpts extends RequestInit {
  /** Abort the request after this many milliseconds. Default 12000. */
  timeoutMs?: number;
  /** Number of RETRIES after the first attempt on timeout/network error. Default 1. */
  retries?: number;
  /** Backoff between attempts, ms. Default 400. */
  backoffMs?: number;
  /** Label used in thrown error messages / logs. Default the request URL. */
  label?: string;
}

export async function fetchWithTimeout(
  url: string,
  opts: FetchWithTimeoutOpts = {},
): Promise<Response> {
  const {
    timeoutMs = 12000,
    retries = 1,
    backoffMs = 400,
    label,
    ...init
  } = opts;

  const tag = label ?? url;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      return res;
    } catch (err: any) {
      clearTimeout(timer);
      lastErr = err;
      const isAbort = err?.name === 'AbortError';
      // Only retry on timeout / transient network errors, and only if we have
      // attempts left. HTTP status errors never reach here (fetch resolves).
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      const reason = isAbort ? `timeout after ${timeoutMs}ms` : String(err?.message ?? err);
      throw new Error(`[net] ${tag}: ${reason}`);
    }
  }
  // Unreachable, but satisfies the type checker.
  throw new Error(`[net] ${tag}: ${String((lastErr as any)?.message ?? lastErr)}`);
}

/** Convenience: fetch + JSON parse with timeout/retry. Throws on !ok. */
export async function fetchJsonWithTimeout(
  url: string,
  opts: FetchWithTimeoutOpts = {},
): Promise<any> {
  const res = await fetchWithTimeout(url, opts);
  if (!res.ok) throw new Error(`[net] ${opts.label ?? url}: HTTP ${res.status}`);
  return res.json();
}
