'use client';

import { useState } from 'react';
import type { DiagnosticReport } from '@/lib/types';
import { computeReadiness, type Tone } from '@/lib/readiness';
import { PACKET_PRICE_NOTE, buildFixIts, buildInsurancePacket } from '@/lib/fix-it';
import { bandSummaryFor, personaCopy, type Persona } from '@/lib/persona';

const BAR: Record<Tone, string> = { red: 'bg-red-600', amber: 'bg-amber-500', green: 'bg-emerald-600', grey: 'bg-slate-400' };
const TXT: Record<Tone, string> = { red: 'text-red-700', amber: 'text-amber-700', green: 'text-emerald-700', grey: 'text-slate-600' };
const RING: Record<string, string> = { ready: '#059669', 'fix-first': '#d97706', hard: '#ea580c', 'high-risk': '#b91c1c' };

// Tells the lead form at the bottom what the person wants quoted, and brings it
// into view. Keeps one form (and one email path) for every "Get a quote" button.
function requestQuote(topic: string) {
  window.dispatchEvent(new CustomEvent('palma:quote', { detail: { topic } }));
}

function ScoreRing({ score, color }: { score: number; color: string }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 110 110" className="h-28 w-28 shrink-0" role="img" aria-label={`Closing readiness ${score} out of 100`}>
      <circle cx="55" cy="55" r={r} fill="none" stroke="#e5e7eb" strokeWidth="10" />
      <circle
        cx="55"
        cy="55"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c} ${c}`}
        transform="rotate(-90 55 55)"
      />
      <text x="55" y="55" textAnchor="middle" className="font-serif" fontSize="30" fontWeight="700" fill="#14213d">{score}</text>
      <text x="55" y="74" textAnchor="middle" fontSize="9" fill="#6b7280">out of 100</text>
    </svg>
  );
}

export default function ReadinessAndFixIt({ report, role = null }: { report: DiagnosticReport; role?: Persona | null }) {
  const copy = personaCopy(role);
  const rd = report.readiness ?? computeReadiness(report);
  const fixes = buildFixIts(report, rd);
  const packet = buildInsurancePacket(report, rd);
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
      <section>
        <h2>{copy.readinessTitle}</h2>
        <div className="mt-3 rounded-xl border border-black/10 bg-white p-5">
          <div className="flex flex-wrap items-center gap-5">
            <ScoreRing score={rd.score} color={RING[rd.band]} />
            <div className="min-w-[14rem] flex-1">
              <div className="font-serif text-2xl font-semibold text-ink">{rd.bandLabel}</div>
              <p className="!text-sm !leading-snug !mb-1 mt-1">{bandSummaryFor(role, rd)}</p>
              <p className="!text-xs !text-ink-muted !mb-0">
                {copy.readinessAsk} A records-based indicator, not an insurer&apos;s or lender&apos;s decision.
              </p>
            </div>
          </div>

          <ul className="!list-none !ml-0 mt-5 space-y-3">
            {rd.factors.map((f) => (
              <li key={f.key} className="!mb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold text-ink">{f.label}</span>
                  <span className={`text-xs font-semibold ${TXT[f.tone]}`}>{f.penalty === 0 ? 'No points lost' : `-${f.penalty} of ${f.max}`}</span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full bg-slate-100">
                  <div className={`h-1.5 rounded-full ${BAR[f.tone]}`} style={{ width: `${Math.max(4, (f.penalty / f.max) * 100)}%`, opacity: f.penalty === 0 ? 0.25 : 1 }} />
                </div>
                <p className="!text-xs !leading-snug !text-ink-soft !mb-0 mt-1">{f.reason}</p>
              </li>
            ))}
          </ul>

          {rd.notes.length > 0 && (
            <div className="mt-4 rounded-md bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Also worth knowing (not scored)</div>
              <ul className="!list-none !ml-0 mt-1">
                {rd.notes.map((n) => (
                  <li key={n} className="!mb-0.5 text-xs text-ink-soft">{n}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {fixes.length > 0 && (
        <section>
          <h2>{copy.fixTitle}</h2>
          <p className="!text-sm !text-ink-soft !mb-0">{copy.fixIntro}</p>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {fixes.map((f) => (
              <div key={f.key} className="relative overflow-hidden rounded-lg border border-black/10 bg-white p-4 pl-5">
                <div className={`absolute left-0 top-0 h-full w-1.5 ${f.tone === 'red' ? 'bg-red-600' : 'bg-amber-500'}`} />
                <div className="font-serif text-lg font-semibold text-ink">{f.title}</div>
                <p className="!text-sm !leading-snug !mb-2">{f.why}</p>
                <ol className="!ml-5 !text-sm list-decimal">
                  {f.steps.map((s) => (
                    <li key={s} className="!mb-0.5">{s}</li>
                  ))}
                </ol>
                <div className="mt-2 text-xs text-ink-muted">
                  Done by: {f.owner}
                  {f.cost ? <> · Typical cost: {f.cost}</> : null}
                  {f.timeline ? <> · Typical time: {f.timeline}</> : null}
                </div>
                <div className="mt-1 text-xs text-ink-muted">{f.vendorNote}</div>
                <button
                  type="button"
                  onClick={() => requestQuote(f.quoteTopic)}
                  className="mt-3 rounded-md bg-[#1f3864] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#102447]"
                >
                  {copy.fixButton}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2>{copy.packetTitle}</h2>
        <p className="!text-sm !text-ink-soft !mb-0">{copy.packetIntro}</p>
        <ul className="!list-none !ml-0 mt-3 divide-y divide-black/5 rounded-lg border border-black/10 bg-white">
          {packet.map((p) => (
            <li key={p.item} className="!mb-0 flex items-start gap-3 px-4 py-3">
              <span
                className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                  p.status === 'needed' ? 'bg-red-50 text-red-700' : p.status === 'recommended' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                }`}
              >
                {p.status === 'ok' ? 'Have' : p.status}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-ink">
                  {p.item}
                  {p.price ? <span className="ml-2 text-xs font-bold text-[#1f3864]">{p.price}</span> : null}
                </div>
                <div className="text-xs text-ink-soft">{p.note}</div>
              </div>
              {p.status !== 'ok' && (
                <button type="button" onClick={() => requestQuote(`Order: ${p.item}`)} className="shrink-0 text-xs font-semibold text-[#1f3864] underline">
                  Order
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="!text-xs !text-ink-muted mt-2">{PACKET_PRICE_NOTE}</p>
      </section>

      {rec && (
        <section>
          <h2>{copy.shareTitle}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-black/10 bg-white p-4">
            <p className="!text-sm !mb-0 min-w-[14rem] flex-1">{copy.shareIntro}</p>
            <button type="button" onClick={copyLink} className="rounded-md border border-ink px-4 py-2 text-sm font-semibold text-ink transition hover:bg-ink hover:text-white">
              {copied ? 'Link copied' : 'Copy link'}
            </button>
            <a href={rec.path} target="_blank" rel="noreferrer" className="rounded-md bg-[#1f3864] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#102447]">
              Open record
            </a>
          </div>
        </section>
      )}
    </>
  );
}
