import type { Metadata } from 'next';
import { toneFromCode, verifyRecordToken } from '@/lib/record-token';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Palma Property Record',
  robots: { index: false, follow: false }, // a private link someone chose to share
};

const TONE = {
  red: { bar: 'bg-red-600', text: 'text-red-700' },
  amber: { bar: 'bg-amber-500', text: 'text-amber-700' },
  green: { bar: 'bg-emerald-600', text: 'text-emerald-700' },
  grey: { bar: 'bg-slate-400', text: 'text-slate-600' },
} as const;

const RING = (s: number) => (s >= 85 ? '#059669' : s >= 65 ? '#d97706' : s >= 40 ? '#ea580c' : '#b91c1c');

export default function RecordPage({ params }: { params: { token: string } }) {
  const v = verifyRecordToken(decodeURIComponent(params.token));

  if (!v) {
    return (
      <main className="mx-auto max-w-xl px-4 py-20 text-center">
        <h1 className="font-serif text-3xl font-semibold">This record link is not valid</h1>
        <p className="mt-3 text-ink-soft">The link may be incomplete or changed. Ask the sender for a new one, or run a fresh check.</p>
        <a href="/" className="mt-6 inline-block rounded-md bg-[#1f3864] px-5 py-2.5 text-sm font-semibold text-white">Run a new check</a>
      </main>
    );
  }

  const { payload: p, expired, expiresAt } = v;
  const checked = new Date(p.t * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const until = expiresAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const circ = 2 * Math.PI * 44;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <article className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-card">
        <div className="bg-gradient-to-br from-[#1f3864] to-[#0b1c38] px-6 py-8 text-white sm:px-10">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#d9b46a]">Palma Property Record</div>
          <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight sm:text-4xl">{p.a}</h1>
          <div className="mt-2 text-sm text-white/75">
            {p.f ? `Folio ${p.f} · ` : ''}Records checked {checked}
          </div>
          <div className={`mt-4 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${expired ? 'bg-amber-400 text-[#3a2a00]' : 'bg-emerald-500 text-white'}`}>
            {expired ? `Expired ${until}. Re-run for a fresh check` : `Valid until ${until}`}
          </div>
        </div>

        <div className="px-6 py-8 sm:px-10">
          <div className="flex flex-wrap items-center gap-6">
            <svg viewBox="0 0 110 110" className="h-32 w-32 shrink-0" role="img" aria-label={`Closing readiness ${p.s} out of 100`}>
              <circle cx="55" cy="55" r="44" fill="none" stroke="#e5e7eb" strokeWidth="10" />
              <circle cx="55" cy="55" r="44" fill="none" stroke={RING(p.s)} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(p.s / 100) * circ} ${circ}`} transform="rotate(-90 55 55)" />
              <text x="55" y="55" textAnchor="middle" fontSize="30" fontWeight="700" fill="#14213d" className="font-serif">{p.s}</text>
              <text x="55" y="74" textAnchor="middle" fontSize="9" fill="#6b7280">out of 100</text>
            </svg>
            <div className="min-w-[14rem] flex-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Closing readiness</div>
              <div className="font-serif text-3xl font-semibold text-ink">{p.b}</div>
              <p className="mt-1 text-sm text-ink-soft">A records-based indicator of closing and insurance risk at the time of the check.</p>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {p.i.map(([label, tone, value, detail]) => {
              const t = TONE[toneFromCode(tone)];
              return (
                <div key={label} className="relative overflow-hidden rounded-lg border border-black/10 bg-white px-4 pb-4 pt-5">
                  <div className={`absolute inset-x-0 top-0 h-1.5 ${t.bar}`} />
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{label}</div>
                  <div className={`mt-1 font-serif text-xl font-semibold ${t.text}`}>{value}</div>
                  <div className="mt-1 text-sm text-ink-soft">{detail}</div>
                </div>
              );
            })}
          </div>

          {p.x.length > 0 && (
            <div className="mt-8">
              <h2 className="font-serif text-xl font-semibold text-ink">To resolve</h2>
              <ul className="mt-2 space-y-2">
                {p.x.map((t) => (
                  <li key={t} className="flex items-start gap-3 text-[15px] text-ink">
                    <span aria-hidden className="mt-1 h-3.5 w-3.5 shrink-0 rounded-[3px] border-2 border-[#b8893b]" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-10 rounded-xl bg-[#102447] px-6 py-6 text-white">
            <div className="font-serif text-xl font-semibold">Want this resolved?</div>
            <p className="mt-1 text-sm text-white/80">Palma Building Solutions handles permits, inspections and sealed engineering across Florida. Call 305-393-0690 or run a fresh check.</p>
            <a href={`/?address=${encodeURIComponent(p.a)}`} className="mt-4 inline-block rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-[#102447]">
              Run a fresh check
            </a>
          </div>

          <p className="mt-6 text-xs text-ink-muted">
            This is a records-level review of public county data and imagery on the date shown. It is not an inspection, an insurance or lending decision, legal advice, or an official determination. County records change. Verify with the county before relying on it.
          </p>
        </div>
      </article>
    </main>
  );
}
