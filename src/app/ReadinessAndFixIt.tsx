'use client';

import { useState } from 'react';
import type { DiagnosticReport } from '@/lib/types';
import { computeReadiness, type Tone } from '@/lib/readiness';
import { PACKET_PRICE_NOTE, buildFixIts, buildInsurancePacket } from '@/lib/fix-it';
import { bandSummaryFor, personaCopy, type Persona } from '@/lib/persona';
import { TIERS, VERIFIED_MONTHS } from '@/lib/verified-checks';

const BAR: Record<Tone, string> = { red: 'bg-red-600', amber: 'bg-amber-500', green: 'bg-emerald-600', grey: 'bg-slate-400' };
const TXT: Record<Tone, string> = { red: 'text-red-700', amber: 'text-amber-700', green: 'text-emerald-700', grey: 'text-slate-600' };

// Tells the lead form at the bottom what the person wants quoted, and brings it
// into view. Keeps one form (and one email path) for every "Get a quote" button.
function requestQuote(topic: string) {
  window.dispatchEvent(new CustomEvent('palma:quote', { detail: { topic } }));
}

// Why the score is what it is. Lives in Full details; the hero shows the score.
export function ScoreBreakdown({ report, role = null }: { report: DiagnosticReport; role?: Persona | null }) {
  const rd = report.readiness ?? computeReadiness(report);
  return (
    <section>
      <h2>Why this score</h2>
      <p className="!text-sm !leading-snug">
        {bandSummaryFor(role, rd)} Based on public records, not an insurer&apos;s or lender&apos;s decision.
      </p>
      <ul className="!list-none !ml-0 mt-3 space-y-3">
        {rd.factors
          .filter((f) => f.penalty > 0)
          .map((f) => (
            <li key={f.key} className="!mb-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-ink">{f.label}</span>
                <span className={`text-xs font-semibold ${TXT[f.tone]}`}>{`-${f.penalty} of ${f.max}`}</span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100">
                <div className={`h-1.5 rounded-full ${BAR[f.tone]}`} style={{ width: `${Math.max(4, (f.penalty / f.max) * 100)}%` }} />
              </div>
              <p className="!text-xs !leading-snug !text-ink-soft !mb-0 mt-1">{f.reason}</p>
            </li>
          ))}
      </ul>
      {rd.factors.some((f) => f.penalty === 0) && (
        <p className="!text-xs !text-emerald-700 !mb-0 mt-3">
          No points lost: {rd.factors.filter((f) => f.penalty === 0).map((f) => f.label).join(', ')}.
        </p>
      )}
    </section>
  );
}

// What to do: one card per fix (price, time, one button; steps behind a tap),
// the papers to have on hand, and the shareable record.
export default function ReadinessAndFixIt({
  report,
  role = null,
  findingsCount = 0,
}: {
  report: DiagnosticReport;
  role?: Persona | null;
  findingsCount?: number;
}) {
  const copy = personaCopy(role);
  const rd = report.readiness ?? computeReadiness(report);
  const fixes = buildFixIts(report, rd, findingsCount);
  const packet = buildInsurancePacket(report, rd).filter((p) => p.status !== 'ok');
  const [copied, setCopied] = useState(false);
  const rec = report.record;

  async function copyLink() {
    if (!rec) return;
    const url = `${window.location.origin}${rec.path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy this link', url);
    }
  }

  return (
    <>
      {fixes.length > 0 && (
        <section>
          <h2>{copy.fixTitle}</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {fixes.map((f) => (
              <div key={f.key} className="flex flex-col rounded-2xl bg-white p-5 shadow-[0_8px_30px_rgba(16,36,71,0.08)] ring-1 ring-black/5">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-serif text-xl font-semibold leading-snug text-ink">{f.title}</div>
                  <span aria-hidden className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${f.tone === 'red' ? 'bg-red-600' : 'bg-amber-500'}`} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {f.price && <span className="rounded-full bg-[#1f3864]/[0.07] px-3 py-1 text-sm font-semibold text-[#1f3864]">{f.price}</span>}
                  {f.timeline && <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-ink-soft">{f.timeline}</span>}
                </div>
                <details className="group mt-3 text-sm">
                  <summary className="cursor-pointer list-none text-sm font-semibold text-[#1f3864] [&::-webkit-details-marker]:hidden">
                    <span className="group-open:hidden">How it works +</span>
                    <span className="hidden group-open:inline">How it works −</span>
                  </summary>
                  <p className="!mb-2 !mt-2 !text-sm !leading-snug text-ink-soft">{f.why}</p>
                  <ol className="!ml-5 !text-sm list-decimal">
                    {f.steps.map((s) => (
                      <li key={s} className="!mb-0.5">{s}</li>
                    ))}
                  </ol>
                  {f.cost && <p className="!mb-0 !mt-2 !text-xs text-ink-muted">{f.cost}. Done by {f.owner}.</p>}
                </details>
                <div className="mt-auto pt-4">
                  <button
                    type="button"
                    onClick={() => requestQuote(f.quoteTopic)}
                    className="rounded-full bg-[#1f3864] px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#102447]"
                  >
                    {copy.fixButton}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {(role === 'seller' || role === 'owner') && (
        <section>
          <h2>Show buyers a clean record</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {(['instant', 'premium'] as const).map((t) => (
              <div
                key={t}
                className={`flex flex-col rounded-2xl px-5 py-5 text-white shadow-[0_8px_30px_rgba(16,36,71,0.18)] ${
                  t === 'premium' ? 'bg-gradient-to-br from-[#064e3b] to-[#047857]' : 'bg-gradient-to-br from-[#0c4a6e] to-[#0369a1]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-xl ring-1 ring-white/30">✓</span>
                  <div className="font-serif text-xl font-semibold">{TIERS[t].name}</div>
                  <span className="ml-auto text-lg font-semibold">{TIERS[t].price}</span>
                </div>
                <p className="!mb-0 !mt-2 !text-sm !text-white/85">
                  {TIERS[t].blurb} Shareable page and listing badge, valid {VERIFIED_MONTHS} months.
                </p>
                <div className="mt-auto pt-4">
                  <button
                    type="button"
                    onClick={() => requestQuote(`${TIERS[t].name} record (${TIERS[t].price})`)}
                    className={`rounded-full bg-white px-5 py-2 text-sm font-semibold shadow-sm hover:bg-white/90 ${t === 'premium' ? 'text-[#065f46]' : 'text-[#075985]'}`}
                  >
                    {t === 'premium' ? 'Get verified' : 'Get checked'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {packet.length > 0 && (
        <section>
          <h2>{copy.packetTitle}</h2>
          <ul className="!list-none !ml-0 mt-3 divide-y divide-black/5 rounded-2xl bg-white ring-1 ring-black/5">
            {packet.map((p) => (
              <li key={p.item} className="!mb-0 flex items-center gap-3 px-5 py-3">
                <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.status === 'needed' ? 'bg-red-600' : 'bg-amber-500'}`} />
                <span className="min-w-0 flex-1 text-sm font-semibold text-ink" title={p.note}>
                  {p.item}
                </span>
                {p.price ? <span className="text-sm font-semibold text-[#1f3864]">{p.price}</span> : null}
                <button type="button" onClick={() => requestQuote(`Order: ${p.item}`)} className="shrink-0 rounded-full border border-[#1f3864] px-3 py-1 text-xs font-semibold text-[#1f3864] hover:bg-[#1f3864] hover:text-white">
                  Order
                </button>
              </li>
            ))}
          </ul>
          <p className="!text-xs !text-ink-muted mt-2">{PACKET_PRICE_NOTE}</p>
        </section>
      )}

      {rec && (
        <section>
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-[#1f3864]/[0.05] px-5 py-4">
            <div className="min-w-[12rem] flex-1">
              <div className="font-semibold text-ink">{copy.shareTitle}</div>
              <div className="text-xs text-ink-muted">Valid for 30 days.</div>
            </div>
            <button type="button" onClick={copyLink} className="rounded-full border border-ink px-4 py-2 text-sm font-semibold text-ink transition hover:bg-ink hover:text-white">
              {copied ? 'Link copied' : 'Copy link'}
            </button>
            <a href={rec.path} target="_blank" rel="noreferrer" className="rounded-full bg-[#1f3864] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#102447]">
              Open record
            </a>
          </div>
        </section>
      )}
    </>
  );
}
