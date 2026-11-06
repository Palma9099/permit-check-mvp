'use client';

import { useEffect, useState } from 'react';
import type { DiagnosticReport } from '@/lib/types';
import { computeReadiness } from '@/lib/readiness';
import { buildGlance, type Tone } from '@/lib/glance';
import { PERSONAS, PERSONA_ORDER, shortVerdict, type Persona } from '@/lib/persona';

const RING: Record<string, string> = { ready: '#34d399', 'fix-first': '#fbbf24', hard: '#fb923c', 'high-risk': '#f87171' };
const DOT: Record<Tone, string> = { red: 'bg-red-400', amber: 'bg-amber-300', green: 'bg-emerald-400', grey: 'bg-slate-300' };

function Ring({ score, color }: { score: number; color: string }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 110 110" className="h-32 w-32 shrink-0 drop-shadow-lg sm:h-36 sm:w-36" role="img" aria-label={`Score ${score} out of 100`}>
      <circle cx="55" cy="55" r={r} fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.18)" strokeWidth="9" />
      <circle
        cx="55"
        cy="55"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c} ${c}`}
        transform="rotate(-90 55 55)"
      />
      <text x="55" y="60" textAnchor="middle" className="font-serif" fontSize="34" fontWeight="700" fill="#fff">
        {score}
      </text>
      <text x="55" y="77" textAnchor="middle" fontSize="8.5" fill="rgba(255,255,255,0.75)" letterSpacing="1">
        OUT OF 100
      </text>
    </svg>
  );
}

// The top of the report: the house itself from above, its score, one plain
// sentence and three facts. Everything else sits below or in Full details.
export default function HomeHero({
  report,
  role,
  onRoleChange,
  findingsCount,
}: {
  report: DiagnosticReport;
  role: Persona | null;
  onRoleChange?: (p: Persona) => void;
  findingsCount: number | null;
}) {
  const r = report;
  // A live Palma Verified record for this folio shows as the first chip.
  const [verified, setVerified] = useState<{ id: string; tier: string; expiresAt: string } | null>(null);
  useEffect(() => {
    const f = (r.property.folio ?? '').replace(/\D+/g, '');
    if (f.length !== 13) return;
    fetch(`/api/verified/lookup?folio=${f}`)
      .then((x) => (x.ok ? x.json() : {}))
      .then((j: any) => setVerified(j?.id ? { id: j.id, tier: j.tier, expiresAt: j.expiresAt } : null))
      .catch(() => {});
  }, [r.property.folio]);
  const rd = r.readiness ?? computeReadiness(r);
  const glance = Object.fromEntries(buildGlance(r).map((g) => [g.key, g]));
  const frames = r.thenVsNow?.historicalAerials?.allFrames ?? [];
  const latest = [...frames].reverse().find((f) => f.displayImageUrl);
  const bg = latest?.displayImageUrl ?? r.thenVsNow?.satelliteImageUrl ?? null;
  const [street, ...rest] = (r.property.siteAddress ?? r.query.address ?? '').split(',');
  const place = rest
    .join(',')
    .replace(/Unincorporated\s+/i, '')
    .replace(/-0000\b/, '')
    .trim();

  const facts: Array<{ text: string; tone: Tone }> = [];
  if (findingsCount && findingsCount > 0) {
    facts.push({ text: `${findingsCount} change${findingsCount > 1 ? 's' : ''} with no permit`, tone: 'red' });
  } else if (glance.permits) {
    facts.push({ text: `Permits: ${glance.permits.value.toLowerCase()}`, tone: glance.permits.tone });
  }
  const liens = r.liens?.lines.length ?? 0;
  if (liens > 0) facts.push({ text: `${liens} lien${liens > 1 ? 's' : ''} or unpaid fine${liens > 1 ? 's' : ''}`, tone: 'red' });
  if (glance.roof) facts.push({ text: `Roof: ${glance.roof.value.toLowerCase()}`, tone: glance.roof.tone });
  if (glance.flood) facts.push({ text: `Flood: ${glance.flood.value}`, tone: glance.flood.tone });

  return (
    <div className="relative overflow-hidden bg-[#0d1b33] text-white">
      {bg && <img src={bg} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />}
      <div className="absolute inset-0 bg-gradient-to-r from-[#0b1730]/95 via-[#0b1730]/70 to-[#0b1730]/10" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0b1730]/70 to-transparent" />
      <div className="relative px-6 py-8 sm:px-10 sm:py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">
            Property check ·{' '}
            {new Date(r.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
          {onRoleChange && (
            <div className="flex flex-wrap gap-1 rounded-full bg-black/30 p-1 ring-1 ring-white/15" role="group" aria-label="Viewing as">
              {PERSONA_ORDER.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onRoleChange(p)}
                  aria-pressed={role === p}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition ${
                    role === p ? 'bg-white text-[#0b1730]' : 'text-white/80 hover:text-white'
                  }`}
                >
                  {PERSONAS[p].short}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-col-reverse gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="font-serif text-4xl font-semibold leading-[1.05] sm:text-5xl">{street}</h2>
            {place && <div className="mt-1 text-sm text-white/75">{place}</div>}
            <div className="mt-5 font-serif text-2xl leading-snug sm:text-3xl">{shortVerdict(role, rd.band)}</div>
          </div>
          <div className="flex items-center gap-3 self-start sm:flex-col sm:self-auto">
            <Ring score={rd.score} color={RING[rd.band] ?? '#fbbf24'} />
            <div className="text-sm font-semibold text-white/90">{rd.bandLabel}</div>
          </div>
        </div>

        <ul className="!list-none !ml-0 mt-7 flex flex-wrap gap-2">
          {verified && (
            <li className="!mb-0">
              <a
                href={`/verified/${verified.id}`}
                target="_blank"
                rel="noreferrer"
                className={`flex items-center gap-2 rounded-full ${verified.tier === 'instant' ? 'bg-sky-600 hover:bg-sky-500' : 'bg-emerald-600 hover:bg-emerald-500'} px-3.5 py-1.5 text-sm font-semibold text-white shadow-lg ring-1 ring-white/30`}
              >
                <span aria-hidden>✓</span>
                {verified.tier === 'instant' ? 'Palma Checked' : 'Palma Verified'} until {new Date(verified.expiresAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </a>
            </li>
          )}
          {facts.map((f) => (
            <li key={f.text} className="!mb-0 flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-sm font-medium ring-1 ring-white/20 backdrop-blur-sm">
              <span aria-hidden className={`h-2 w-2 rounded-full ${DOT[f.tone]}`} />
              {f.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
