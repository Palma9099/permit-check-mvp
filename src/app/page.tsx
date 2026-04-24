'use client';

import { useState } from 'react';
import type { DiagnosticReport } from '@/lib/types';
import Report from './Report';

export default function HomePage() {
  const [address, setAddress] = useState('');
  const [folio, setFolio] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<DiagnosticReport | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setReport(null);
    setLoading(true);
    try {
      const body: { address?: string; folio?: string } = {};
      if (folio.trim()) body.folio = folio.trim();
      else if (address.trim()) body.address = address.trim();
      else {
        setError('Enter an address or folio.');
        setLoading(false);
        return;
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
          <div className="sm:col-span-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1">
              Address
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Enter full property address, including city, state, and ZIP"
              className="w-full px-3 py-2 border border-black/10 rounded-md bg-white text-ink focus:outline-none focus:ring-2 focus:ring-ink/20"
            />
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
