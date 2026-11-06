'use client';

import { useState } from 'react';
import type { LienSearch, LienSection } from '@/lib/lien-search';
import { LIEN_SEARCH_PRICE, LIEN_SEARCH_TURNAROUND } from '@/lib/lien-search-config';

const ORDER = { found: 0, failed: 1, clear: 2 } as const;
const DOT = { red: 'bg-red-600', amber: 'bg-amber-500', green: 'bg-emerald-600' } as const;

function Chip({ s }: { s: LienSection }) {
  if (s.state === 'clear') return <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-emerald-700">Clear</span>;
  if (s.state === 'failed') return <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-700">Not checked</span>;
  return <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-red-700">Found</span>;
}

// Title companies: run the county part of a lien search in seconds, download it,
// and order the full search (taxes, Official Records, utilities) from Palma.
export default function LienSearchClient() {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [r, setR] = useState<(LienSearch & { matchNote?: string | null }) | null>(null);
  const [order, setOrder] = useState({ name: '', company: '', email: '', phone: '', closing: '' });
  const [sent, setSent] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setR(null);
    setSent('idle');
    setBusy(true);
    try {
      const res = await fetch('/api/lien-search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `Error ${res.status}`);
      setR(j);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!r) return;
    setSent('sending');
    const summary = r.sections.map((s) => `${s.title}: ${s.state === 'found' ? s.summary : s.state}`).join(' | ');
    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: [order.name, order.company].filter(Boolean).join(', '),
          email: order.email,
          phone: order.phone,
          address: `${r.address} (folio ${r.prettyFolio})`,
          message: `LIEN SEARCH ORDER (${LIEN_SEARCH_PRICE}). Closing date: ${order.closing || 'not given'}. Company: ${order.company || 'not given'}. Staff steps: ${r.staffSteps.map((s) => s.title).join(', ')}.`,
          summary,
        }),
      });
      setSent(res.ok ? 'sent' : 'error');
    } catch {
      setSent('error');
    }
  }

  const input = 'w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-ink shadow-sm outline-none focus:border-[#1f3864] focus:ring-2 focus:ring-[#1f3864]/15';
  const [street, ...rest] = (r?.address ?? '').split(',');
  const clearCount = r ? r.sections.filter((s) => s.state === 'clear' && s.lines.length === 0).length : 0;
  const place = rest.join(',').replace(/-0000\b/, '').trim();

  return (
    <main className="min-h-screen bg-[#f6f4ef] pb-16">
      <div className="bg-[#0b1730] text-white">
        <div className="mx-auto max-w-4xl px-4 pb-24 pt-12 sm:pt-16">
          <a href="/" className="text-xs font-semibold uppercase tracking-[0.22em] text-[#d9b46a]">Palma Tools</a>
          <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight sm:text-5xl">Miami-Dade lien search, in seconds</h1>
          <p className="mt-3 max-w-2xl text-white/75">
            Recorded code liens, unpaid fines, open cases, unsafe structures and open permits for any folio. The full search, with taxes and Official
            Records, is {LIEN_SEARCH_PRICE} and delivered {LIEN_SEARCH_TURNAROUND.toLowerCase()}.
          </p>
        </div>
      </div>

      <div className="mx-auto -mt-16 max-w-4xl px-4">
        <form onSubmit={run} className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-[0_20px_60px_rgba(16,36,71,0.18)] ring-1 ring-black/5 sm:flex-row">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Address or folio, e.g. 30-4926-002-1120" className={input} aria-label="Address or folio" />
          <button type="submit" disabled={busy || !query.trim()} className="shrink-0 rounded-xl bg-[#1f3864] px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-[#102447] disabled:opacity-50">
            {busy ? 'Searching…' : 'Run search'}
          </button>
        </form>
        {err && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">{err}</div>}

        {r && (
          <div className="mt-8 space-y-6">
            {r.matchNote && <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 ring-1 ring-amber-200">{r.matchNote}</div>}
            <section className="overflow-hidden rounded-2xl bg-white shadow-[0_8px_30px_rgba(16,36,71,0.08)] ring-1 ring-black/5">
              <div className="flex flex-col gap-4 px-6 py-6 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h2 className="font-serif text-3xl font-semibold text-ink">{street}</h2>
                  <div className="text-sm text-ink-muted">{place}</div>
                  <dl className="mt-4 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-sm">
                    <dt className="font-semibold text-ink-muted">Folio</dt>
                    <dd className="text-ink">{r.prettyFolio}</dd>
                    <dt className="font-semibold text-ink-muted">Owner</dt>
                    <dd className="text-ink">{r.owner ?? 'Not shown'}</dd>
                    <dt className="font-semibold text-ink-muted">Municipality</dt>
                    <dd className="text-ink">{r.municipality ?? 'Not shown'}</dd>
                    <dt className="font-semibold text-ink-muted">Legal</dt>
                    <dd className="text-ink">{r.legal ?? 'Not shown'}</dd>
                  </dl>
                </div>
                <div
                  className={`shrink-0 rounded-2xl px-5 py-4 text-center ${r.found ? 'bg-red-50 text-red-800' : r.failed ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}
                >
                  <div className="font-serif text-4xl font-semibold">{r.found || (r.failed ? '?' : '✓')}</div>
                  <div className="text-xs font-semibold uppercase tracking-wider">{r.found ? `item${r.found > 1 ? 's' : ''} found` : r.failed ? 'Not all checked' : 'County clear'}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-black/5 bg-[#1f3864]/[0.03] px-6 py-3 text-xs text-ink-muted">
                <span>
                  Searched {new Date(r.searchedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
                <a href={`/api/lien-search/pdf?folio=${r.folio}`} target="_blank" rel="noreferrer" className="ml-auto rounded-full border border-[#1f3864] px-3 py-1 font-semibold text-[#1f3864] hover:bg-[#1f3864] hover:text-white">
                  Download PDF
                </a>
              </div>
            </section>

            {/* Problems first, full width; clear sections after, side by side. */}
            <div className="grid gap-4 md:grid-cols-6">
              {[...r.sections].sort((a, b) => ORDER[a.state] - ORDER[b.state]).map((s) => (
                <section
                  key={s.key}
                  className={`rounded-2xl bg-white p-5 ring-1 ring-black/5 ${s.state === 'clear' && s.lines.length === 0 ? (clearCount >= 3 ? 'md:col-span-2' : 'md:col-span-3') : 'md:col-span-6'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-serif text-xl font-semibold text-ink">{s.title}</h3>
                    <Chip s={s} />
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">{s.summary}</p>
                  {s.lines.length > 0 && (
                    <ul className="mt-3 divide-y divide-black/5">
                      {s.lines.map((l, i) => (
                        <li key={i} className="flex gap-3 py-2.5">
                          <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[l.tone]}`} />
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-ink">{l.title}</div>
                            <div className="text-sm text-ink-soft">{l.detail}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 text-[11px] text-ink-muted">Source: {s.source}</div>
                </section>
              ))}
            </div>

            <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#0b1730] to-[#1f3864] text-white shadow-[0_8px_30px_rgba(16,36,71,0.25)]">
              <div className="grid gap-6 p-6 md:grid-cols-2">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#d9b46a]">Full lien search</div>
                  <div className="mt-1 flex items-baseline gap-3">
                    <span className="font-serif text-3xl font-semibold">{LIEN_SEARCH_PRICE}</span>
                    <span className="text-sm text-white/75">{LIEN_SEARCH_TURNAROUND}</span>
                  </div>
                  <p className="mt-2 text-sm text-white/80">Palma staff add the parts behind a captcha or request form:</p>
                  <ul className="mt-3 space-y-2">
                    {r.staffSteps.map((s) => (
                      <li key={s.key} className="flex gap-2 text-sm">
                        <span aria-hidden className="mt-0.5 text-[#d9b46a]">✓</span>
                        <span>
                          <span className="font-semibold">{s.title}.</span> <span className="text-white/75">{s.how}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                {sent === 'sent' ? (
                  <div className="flex flex-col justify-center rounded-xl bg-white/10 p-5 ring-1 ring-white/20">
                    <div className="font-serif text-2xl font-semibold">Order received</div>
                    <p className="mt-1 text-sm text-white/80">We will email the full search {LIEN_SEARCH_TURNAROUND.toLowerCase()}.</p>
                  </div>
                ) : (
                  <form onSubmit={sendOrder} className="grid gap-2.5 rounded-xl bg-white/10 p-4 ring-1 ring-white/20">
                    {(
                      [
                        ['name', 'Your name', 'text'],
                        ['company', 'Title company', 'text'],
                        ['email', 'Email for delivery', 'email'],
                        ['phone', 'Phone', 'tel'],
                        ['closing', 'Closing date', 'date'],
                      ] as const
                    ).map(([k, label, type]) => (
                      <label key={k} className="text-xs font-semibold text-white/80">
                        {label}
                        <input
                          type={type}
                          required={k === 'email'}
                          value={order[k]}
                          onChange={(e) => setOrder({ ...order, [k]: e.target.value })}
                          className="mt-1 w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-ink"
                        />
                      </label>
                    ))}
                    <button type="submit" disabled={sent === 'sending'} className="mt-1 rounded-full bg-[#d9b46a] px-5 py-2.5 text-sm font-bold text-[#0b1730] hover:bg-[#e6c587] disabled:opacity-60">
                      {sent === 'sending' ? 'Sending…' : `Order full search, ${LIEN_SEARCH_PRICE}`}
                    </button>
                    {sent === 'error' && <div className="text-xs text-red-200">Could not send. Call us at the number on palma.llc.</div>}
                  </form>
                )}
              </div>
            </section>

            <p className="text-xs text-ink-muted">
              A search of Miami-Dade County public records by folio, on the date and time shown. It is not title insurance, a payoff letter, an estoppel
              letter or a guarantee. Amounts owed are confirmed with the agency that holds the lien.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
