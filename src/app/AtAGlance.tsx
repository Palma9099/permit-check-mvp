'use client';

import { useEffect, useRef, useState } from 'react';
import type { DiagnosticReport } from '@/lib/types';
import { buildGlance, glanceNextSteps, glanceVerdict, tipSections, type Tone } from '@/lib/glance';
import type { Persona } from '@/lib/persona';

const TONE: Record<Tone, { bar: string; text: string; ring: string }> = {
  red: { bar: 'bg-red-600', text: 'text-red-700', ring: 'ring-red-200' },
  amber: { bar: 'bg-amber-600', text: 'text-amber-700', ring: 'ring-amber-200' },
  green: { bar: 'bg-emerald-600', text: 'text-emerald-700', ring: 'ring-emerald-200' },
  grey: { bar: 'bg-slate-500', text: 'text-slate-600', ring: 'ring-slate-200' },
};

// Scorecard with an "i" on every metric. The popup opens on hover or keyboard
// focus (desktop) and on tap (phones), and closes on Esc or an outside click.
export default function AtAGlance({ report, role = null }: { report: DiagnosticReport; role?: Persona | null }) {
  const items = buildGlance(report);
  const [open, setOpen] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, []);

  return (
    <section>
      <h2>At a glance</h2>
      <div ref={root} className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((b, i) => {
          const t = TONE[b.tone];
          const isOpen = open === b.key;
          return (
            <div
              key={b.key}
              className="relative"
              onMouseEnter={() => setOpen(b.key)}
              onMouseLeave={() => setOpen((cur) => (cur === b.key ? null : cur))}
            >
              <div className={`relative overflow-hidden rounded-lg border border-black/10 bg-white px-4 pt-5 pb-4 h-full ${isOpen ? `ring-2 ${t.ring}` : ''}`}>
                <div className={`absolute inset-x-0 top-0 h-1.5 ${t.bar}`} />
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{b.label}</div>
                  <button
                    type="button"
                    aria-label={`What "${b.label}" means`}
                    aria-expanded={isOpen}
                    aria-controls={`glance-${b.key}`}
                    onClick={() => setOpen(b.key)}
                    onFocus={() => setOpen(b.key)}
                    className="shrink-0 -mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-slate-400 text-[11px] font-serif italic font-bold text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1f3864]"
                  >
                    i
                  </button>
                </div>
                <div className={`mt-1 font-serif text-2xl font-semibold ${t.text}`}>{b.value}</div>
                <div className="mt-1 text-sm text-ink-soft">{b.detail}</div>
              </div>

              {isOpen && (
                <div
                  id={`glance-${b.key}`}
                  role="tooltip"
                  className={`absolute z-30 mt-2 w-[min(22rem,calc(100vw-3rem))] rounded-lg border border-black/10 bg-white p-4 text-left shadow-xl left-0 ${
                    i % 2 === 1 ? 'sm:right-0 sm:left-auto' : 'sm:left-0 sm:right-auto'
                  } ${i % 3 === 2 ? 'lg:right-0 lg:left-auto' : 'lg:left-0 lg:right-auto'}`}
                >
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1">What it is</div>
                  <p className="!text-sm !leading-snug !mb-3">{b.info.what}</p>
                  {tipSections(role, b.info).map((t, idx, arr) => (
                    <div key={t.label}>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#1f3864] mb-1">
                        {t.label}
                        {t.forYou ? <span className="ml-1 rounded bg-[#1f3864] px-1 py-px text-[9px] text-white">for you</span> : null}
                      </div>
                      <p className={`!text-sm !leading-snug ${idx < arr.length - 1 ? '!mb-3' : '!mb-0'}`}>{t.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 rounded-lg bg-[#102447] px-5 py-4 text-white">
        <div className="font-serif text-xl font-semibold">{glanceVerdict(items, role)}</div>
      </div>
      <ul className="mt-4 !list-none !ml-0 space-y-2">
        {glanceNextSteps(items, role, report).map((s) => (
          <li key={s} className="flex items-start gap-3 !mb-0">
            <span aria-hidden className="mt-1 h-3.5 w-3.5 shrink-0 rounded-[3px] border-2 border-[#b8893b]" />
            <span className="text-[15px] text-ink">{s}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
