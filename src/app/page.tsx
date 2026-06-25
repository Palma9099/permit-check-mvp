'use client';

import { useState, useEffect, useRef } from 'react';
import type { DiagnosticReport, UserUploadedThen } from '@/lib/types';
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
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const data: DiagnosticReport = await res.json();
      setReport(data);
    } catch (err: any) {
      setError(err?.message ?? 'Unknown error');
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
