'use client';

import { useState, useEffect, useRef } from 'react';
import type { DiagnosticReport, UserUploadedThen } from '@/lib/types';
import type { DeepScanResult } from '@/lib/scan-queue';
import Report from './Report';

// Read a File as a base64 data URL, downscaling to a max 1600px long edge
// (and converting to JPEG quality 0.85) so we don't blow past the API
// route's 6 MB cap with a 12 MP phone photo.
function fileToScaledDataUrl(file: File, maxLongEdge = 1600, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const longEdge = Math.max(img.width, img.height);
      const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Could not get 2D canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      URL.revokeObjectURL(url);
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode image'));
    };
    img.src = url;
  });
}

export default function HomePage() {
  const [address, setAddress] = useState('');
  const [folio, setFolio] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<DiagnosticReport | null>(null);

  // Address autocomplete (Google Places via /api/autocomplete). Degrades to a
  // plain text field when the API key isn't set (route returns no suggestions).
  const [suggestions, setSuggestions] = useState<{ description: string; placeId: string }[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const suppressNextSuggest = useRef(false);

  useEffect(() => {
    if (suppressNextSuggest.current) {
      suppressNextSuggest.current = false;
      return;
    }
    const q = address.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setShowSuggest(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/autocomplete?input=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const data = await res.json();
        const list = Array.isArray(data?.suggestions) ? data.suggestions : [];
        setSuggestions(list);
        setShowSuggest(list.length > 0);
      } catch {
        /* ignore — field stays a plain input */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [address]);

  function pickSuggestion(description: string) {
    suppressNextSuggest.current = true;
    setAddress(description);
    setSuggestions([]);
    setShowSuggest(false);
  }

  // Optional user-uploaded historical photo (e.g. old MLS listing photo).
  const [userPhotoFile, setUserPhotoFile] = useState<File | null>(null);
  const [userPhotoDate, setUserPhotoDate] = useState('');
  const [userPhotoCaption, setUserPhotoCaption] = useState('');

  // Deep scan (hybrid: wait-on-screen if it finishes fast, else hand off to
  // email). Phases: idle → polling → done | handoff(emailed) | failed.
  const [deepEmail, setDeepEmail] = useState('');
  const [deepBusy, setDeepBusy] = useState(false);
  const [deepErr, setDeepErr] = useState<string | null>(null);
  const [deepPhase, setDeepPhase] = useState<'idle' | 'polling' | 'done' | 'handoff' | 'failed'>('idle');
  const [deepJobId, setDeepJobId] = useState<string | null>(null);
  const [deepResult, setDeepResult] = useState<DeepScanResult | null>(null);
  const deepStartRef = useRef<number>(0);

  // How long we keep the user waiting on screen before switching to "we'll
  // email it." Tune this once we have real measured scrape times.
  const INLINE_WAIT_MS = 45000;

  async function submitDeepScan() {
    setDeepErr(null);
    setDeepResult(null);
    setDeepPhase('idle');
    if (!/.+@.+\..+/.test(deepEmail.trim())) {
      setDeepErr('Enter a valid email so we can send the results.');
      return;
    }
    if (!address.trim() && !folio.trim()) {
      setDeepErr('Enter an address or folio in the fields above first.');
      return;
    }
    setDeepBusy(true);
    try {
      const res = await fetch('/api/deep-scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: deepEmail.trim(),
          address: address.trim() || undefined,
          folio: folio.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeepErr(data?.error ?? 'Could not queue the scan.');
      } else {
        deepStartRef.current = Date.now();
        setDeepJobId(data.id);
        setDeepPhase('polling');
      }
    } catch (e: any) {
      setDeepErr(e?.message ?? 'Network error.');
    } finally {
      setDeepBusy(false);
    }
  }

  // Poll the job while it's running. Render inline if it finishes within
  // INLINE_WAIT_MS; otherwise stop polling and let the email take over.
  useEffect(() => {
    if (deepPhase !== 'polling' || !deepJobId) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      if (Date.now() - deepStartRef.current > INLINE_WAIT_MS) {
        setDeepPhase('handoff');
        return;
      }
      try {
        const res = await fetch(`/api/deep-scan/status?id=${encodeURIComponent(deepJobId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === 'done' && data.result) {
          setDeepResult(data.result as DeepScanResult);
          setDeepPhase('done');
        } else if (data.status === 'failed') {
          setDeepPhase('failed');
        }
      } catch {
        /* keep polling */
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [deepPhase, deepJobId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setReport(null);
    setLoading(true);
    try {
      const body: {
        address?: string;
        folio?: string;
        userThenPhoto?: UserUploadedThen | null;
      } = {};
      if (folio.trim()) body.folio = folio.trim();
      else if (address.trim()) body.address = address.trim();
      else {
        setError('Enter an address or folio.');
        setLoading(false);
        return;
      }
      if (userPhotoFile) {
        try {
          const dataUrl = await fileToScaledDataUrl(userPhotoFile);
          body.userThenPhoto = {
            dataUrl,
            captureDate: userPhotoDate.trim() || null,
            caption: userPhotoCaption.trim() || null,
          };
        } catch (err: any) {
          setError(`Couldn't read uploaded photo: ${err?.message ?? err}`);
          setLoading(false);
          return;
        }
      }
      const res = await fetch('/api/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // The API returns { error } with a user-friendly message. Prefer that;
        // never surface a raw JSON blob or bare HTTP status to the reader.
        const data = await res.json().catch(() => null);
        const msg =
          data?.error ||
          "Something went wrong running this check. Please try again in a moment, or call 305-393-0690 and we'll run it for you.";
        throw new Error(msg);
      }
      const data: DiagnosticReport = await res.json();
      setReport(data);
    } catch (err: any) {
      // Network-level failures (fetch rejects before a response) get a friendly
      // fallback too, rather than a browser error like "Failed to fetch".
      const raw = String(err?.message ?? '');
      const isNetwork = /failed to fetch|networkerror|load failed/i.test(raw);
      setError(
        isNetwork
          ? "We couldn't reach the server. Check your connection and try again, or call 305-393-0690."
          : raw || 'Unknown error',
      );
    } finally {
      setLoading(false);
    }
  }

  const [downloading, setDownloading] = useState(false);

  async function downloadPdf() {
    if (!report) return;
    setDownloading(true);
    try {
      const res = await fetch('/api/check/pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(report),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        setError(`PDF generation failed${txt ? `: ${txt}` : ''}.`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safe =
        (report.property.siteAddress ?? report.query.address ?? 'report')
          .replace(/[^A-Za-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
      a.href = url;
      a.download = `Permit_History_${safe}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-10 sm:py-14">
      <header className="mb-10">
        <div className="text-xs uppercase tracking-[0.18em] text-ink-muted mb-2">
          Palma Property Intelligence
        </div>
        <h1 className="font-serif text-4xl sm:text-5xl font-semibold leading-tight">
          Permit History & Unpermitted Improvement Check
        </h1>
        <p className="mt-3 text-ink-soft text-base sm:text-lg max-w-2xl">
          Plain-English records review for any Florida property. Enter an address,
          we route to the right county portal, pull what's publicly available, and
          compare it to current satellite + Street View imagery — parcel-bounded
          so the findings stay on the subject property, not the neighbors.
        </p>
      </header>

      <section className="bg-card shadow-card rounded-lg p-6 sm:p-8 border border-black/5">
        <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          <div className="sm:col-span-3 relative">
            <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
              Address
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onFocus={() => setShowSuggest(suggestions.length > 0)}
              onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
              autoComplete="off"
              placeholder="Enter full property address, including city, state, and ZIP"
              className="w-full px-3 py-2 border border-black/10 rounded-md bg-white text-ink focus:outline-none focus:ring-2 focus:ring-ink/20"
            />
            {showSuggest && suggestions.length > 0 && (
              <ul className="absolute z-20 left-0 right-0 mt-1 bg-white border border-black/10 rounded-md shadow-lg overflow-hidden">
                {suggestions.map((s) => (
                  <li key={s.placeId || s.description}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickSuggestion(s.description);
                      }}
                      className="block w-full text-left px-3 py-2 text-sm text-ink hover:bg-black/5"
                    >
                      {s.description}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
              Or Folio / Parcel ID
            </label>
            <input
              type="text"
              value={folio}
              onChange={(e) => setFolio(e.target.value)}
              placeholder="Enter county folio or parcel identification number"
              className="w-full px-3 py-2 border border-black/10 rounded-md bg-white text-ink focus:outline-none focus:ring-2 focus:ring-ink/20"
            />
          </div>
          {/* Optional historical photo upload — for properties where Google
              Street View has no front-facing dated capture (privacy fences,
              gated communities, single-side cul-de-sacs). The realtor drops
              in any old listing photo and the AI uses it as the THEN frame
              for facade-level comparison. */}
          <div className="sm:col-span-5 mt-2 pt-3 border-t border-black/5">
            <details>
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-ink-muted hover:text-ink">
                Optional · Upload a historical photo (older MLS listing or field photo)
              </summary>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-5 gap-3">
                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1">
                    Historical photo
                  </label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setUserPhotoFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-ink file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-black/10 file:bg-white file:text-sm file:font-semibold file:hover:bg-black/5 file:transition"
                  />
                  <p className="text-[11px] text-ink-muted mt-1">
                    Used as the THEN reference for facade comparison when Google has no front-facing historical capture.
                  </p>
                </div>
                <div className="sm:col-span-1">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1">
                    Year / date
                  </label>
                  <input
                    type="text"
                    value={userPhotoDate}
                    onChange={(e) => setUserPhotoDate(e.target.value)}
                    placeholder="2018"
                    className="w-full px-2 py-1.5 border border-black/10 rounded-md bg-white text-ink text-sm focus:outline-none focus:ring-2 focus:ring-ink/20"
                  />
                </div>
                <div className="sm:col-span-1">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1">
                    Source / caption
                  </label>
                  <input
                    type="text"
                    value={userPhotoCaption}
                    onChange={(e) => setUserPhotoCaption(e.target.value)}
                    placeholder="MLS listing"
                    className="w-full px-2 py-1.5 border border-black/10 rounded-md bg-white text-ink text-sm focus:outline-none focus:ring-2 focus:ring-ink/20"
                  />
                </div>
              </div>
            </details>
          </div>

          <div className="sm:col-span-5 flex items-center justify-between gap-3 pt-2">
            <p className="text-xs text-ink-muted">
              Works for all 67 Florida counties. Live permit scraping active for
              Miami-Dade; every other county ships portal links + imagery analysis
              while we wire each scraper up.
            </p>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 rounded-md bg-ink text-white text-sm font-semibold disabled:opacity-50 hover:bg-black transition"
            >
              {loading ? 'Running…' : 'Run check'}
            </button>
          </div>
        </form>

        {/* Deep scan — long-running, emailed full permit + violation history */}
        <div className="mt-4 border-t border-black/10 pt-4">
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-ink">
              Need the full permit &amp; violation history? Run a deep scan →
            </summary>
            <div className="mt-3">
              <p className="text-xs text-ink-muted mb-3 max-w-2xl">
                The instant check above pulls what county APIs expose in seconds. A deep scan
                runs a separate agent that reads the county&apos;s permit and code-enforcement
                portals directly. If it finishes quickly we&apos;ll show it right here; if a portal
                is slow we&apos;ll email you the full results when it&apos;s done. Uses the address
                or folio entered above.
              </p>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <input
                  type="email"
                  value={deepEmail}
                  onChange={(e) => setDeepEmail(e.target.value)}
                  placeholder="you@email.com (for slower scans)"
                  className="px-3 py-2 border border-black/10 rounded-md bg-white text-ink text-sm focus:outline-none focus:ring-2 focus:ring-ink/20 sm:w-72"
                />
                <button
                  type="button"
                  onClick={submitDeepScan}
                  disabled={deepBusy || deepPhase === 'polling'}
                  className="px-4 py-2 rounded-md border border-ink text-ink text-sm font-semibold disabled:opacity-50 hover:bg-ink hover:text-white transition"
                >
                  {deepBusy ? 'Starting…' : 'Run deep scan'}
                </button>
              </div>

              {deepErr && <p className="mt-2 text-sm text-red-700">{deepErr}</p>}

              {deepPhase === 'polling' && (
                <div className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
                  <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-ink/30 border-t-ink animate-spin" />
                  Reading the county permit &amp; code-enforcement portals… this can take up to a minute.
                </div>
              )}
              {deepPhase === 'handoff' && (
                <p className="mt-3 text-sm text-green-700">
                  This one&apos;s taking longer than usual — we&apos;ll email the full results to{' '}
                  {deepEmail} when it&apos;s done. You can close this page.
                </p>
              )}
              {deepPhase === 'failed' && (
                <p className="mt-3 text-sm text-amber-700">
                  The automated scan hit a snag — we&apos;ve emailed you the county portal links to
                  check directly.
                </p>
              )}
              {deepPhase === 'done' && deepResult && <DeepResultView r={deepResult} />}
            </div>
          </details>
        </div>
      </section>

      {error && (
        <div className="mt-6 p-4 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm">
          <div className="font-semibold mb-1">Could not run diagnostic</div>
          <div>{error}</div>
        </div>
      )}

      {loading && (
        <div className="mt-8 text-ink-muted text-sm">
          Geocoding the address, resolving the county, pulling whatever permit
          data the portal exposes, and comparing satellite + Street View against
          the parcel boundary. Typically 5–15 seconds.
        </div>
      )}

      {report && (
        <div className="mt-10">
          <div className="flex justify-end mb-3">
            <button
              onClick={downloadPdf}
              disabled={downloading}
              className="px-4 py-2 rounded-md border border-black/10 bg-white text-sm font-semibold hover:bg-black/5 transition disabled:opacity-50"
            >
              {downloading ? 'Building PDF…' : 'Download PDF report'}
            </button>
          </div>
          <Report report={report} />
        </div>
      )}

      <footer className="mt-20 pt-8 border-t border-black/10 text-xs text-ink-muted">
        <p>
          Records-level triage only. Not legal advice, not a final compliance
          determination. Always verify with the AHJ before acting.
        </p>
      </footer>
    </main>
  );
}

// Inline render of a completed deep scan (the fast path). The worker also emails
// a copy, so this and the email always carry the same data.
function DeepResultView({ r }: { r: DeepScanResult }) {
  return (
    <div className="mt-4 border border-black/10 rounded-md p-4 bg-white">
      <div className="text-sm font-semibold text-ink mb-1">
        Deep scan complete{r.matchedAddress ? ` — ${r.matchedAddress}` : ''}
        {r.county ? ` · ${r.county}` : ''}
      </div>
      {!r.ok && (
        <p className="text-xs text-amber-700 mb-2">
          We couldn&apos;t fully read the portal automatically — use the links below to confirm.
        </p>
      )}

      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mt-3 mb-1">
        Permits ({r.permits.length})
      </div>
      {r.permits.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="py-1 pr-3">Permit #</th>
                <th className="py-1 pr-3">Type</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Issued</th>
              </tr>
            </thead>
            <tbody>
              {r.permits.map((p, i) => (
                <tr key={i} className="border-t border-black/5">
                  <td className="py-1 pr-3">{p.permitNumber ?? '—'}</td>
                  <td className="py-1 pr-3">{p.type ?? '—'}</td>
                  <td className="py-1 pr-3">{p.status ?? '—'}</td>
                  <td className="py-1 pr-3">{p.issuedDate ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-ink-muted">No permits found in the portal.</p>
      )}

      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mt-3 mb-1">
        Code-enforcement cases ({r.violations.length})
      </div>
      {r.violations.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="py-1 pr-3">Case #</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Opened</th>
                <th className="py-1 pr-3">Description</th>
              </tr>
            </thead>
            <tbody>
              {r.violations.map((c, i) => (
                <tr key={i} className="border-t border-black/5">
                  <td className="py-1 pr-3">{c.caseNumber ?? '—'}</td>
                  <td className="py-1 pr-3">{c.status ?? '—'}</td>
                  <td className="py-1 pr-3">{c.openedDate ?? '—'}</td>
                  <td className="py-1 pr-3">{c.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-ink-muted">No code-enforcement cases found in the portal.</p>
      )}

      {r.portalLinks?.length > 0 && (
        <p className="mt-3 text-xs text-ink-muted">
          Verify:{' '}
          {r.portalLinks.map((l, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-ink underline">
                {l.label}
              </a>
            </span>
          ))}
        </p>
      )}
      <p className="mt-2 text-xs text-green-700">A copy has also been emailed to you.</p>
    </div>
  );
}
