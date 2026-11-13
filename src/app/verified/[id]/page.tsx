import type { Metadata } from 'next';
import { getVerified, isLive } from '@/lib/verified';
import { SITE_ORIGIN } from '@/lib/record-token';
import { TIERS } from '@/lib/verified-checks';

export const dynamic = 'force-dynamic';

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  // A failed lookup gets the generic title rather than the "no record" one:
  // the page itself says we could not load it.
  const { id } = await params;
  const look = await getVerified(id);
  const v = look.ok ? look.record : null;
  return {
    title: v ? `${TIERS[v.tier ?? 'premium'].name}: ${v.address.split(',')[0]}` : 'Palma Verified',
    description: v ? `Permit and code records checked by Palma Building Solutions on ${fmt(v.verified_at)}.` : undefined,
  };
}

function Seal({ live, color, word }: { live: boolean; color: string; word: string }) {
  return (
    <svg viewBox="0 0 120 120" className="h-28 w-28 shrink-0 drop-shadow-xl sm:h-32 sm:w-32" role="img" aria-label={live ? word : 'Expired'}>
      <circle cx="60" cy="60" r="56" fill={live ? color : '#64748b'} />
      <circle cx="60" cy="60" r="49" fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="2 3" />
      <path d="M38 61 L53 76 L83 45" fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      <text x="60" y="100" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff" letterSpacing="1.5">
        {live ? word : 'EXPIRED'}
      </text>
    </svg>
  );
}

// Public page for a Palma Verified record: what was checked, by whom, when,
// and until when it holds. Shareable with buyers, agents and lenders.
export default async function VerifiedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const look = await getVerified(id);
  // "No record found" is a claim about a home the owner paid to certify. When
  // the lookup failed we have not earned it, and a buyer reading it draws
  // exactly the wrong conclusion.
  if (!look.ok) {
    return (
      <main className="mx-auto max-w-xl px-4 py-20 text-center">
        <h1 className="font-serif text-3xl font-semibold">We could not load this record</h1>
        <p className="mt-3 text-ink-soft">
          Something on our side is not answering. This is not a statement about the property: the record may be
          perfectly valid.
        </p>
        <p className="mt-4 text-ink">
          Try again in a minute, or call Palma at{' '}
          <a className="font-semibold underline" href="tel:+13053930690">305-393-0690</a>.
        </p>
      </main>
    );
  }
  const v = look.record;
  if (!v) {
    return (
      <main className="mx-auto max-w-xl px-4 py-20 text-center">
        <h1 className="font-serif text-3xl font-semibold">No Palma Verified record found</h1>
        <p className="mt-3 text-ink-soft">Check the link, or ask the seller for a current one.</p>
        <a href="/" className="mt-6 inline-block rounded-full bg-[#1f3864] px-5 py-2.5 text-sm font-semibold text-white">Check a property</a>
      </main>
    );
  }
  const live = isLive(v);
  const tier = TIERS[v.tier ?? 'premium'];
  const instant = v.tier === 'instant';
  const DOT: Record<string, string> = { red: 'bg-red-600', amber: 'bg-amber-500', green: 'bg-emerald-600', grey: 'bg-slate-400' };
  const [street, ...rest] = v.address.split(',');
  const place = rest.join(',').replace(/Unincorporated\s+/i, '').replace(/-0000\b/, '').trim();
  const badgeUrl = `${SITE_ORIGIN}/verified/${v.id}/badge`;
  const pageUrl = `${SITE_ORIGIN}/verified/${v.id}`;
  const embed = `<a href="${pageUrl}"><img src="${badgeUrl}" alt="${tier.name}" width="240" height="64"></a>`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <article className="overflow-hidden rounded-3xl bg-white shadow-[0_20px_60px_rgba(16,36,71,0.18)] ring-1 ring-black/5">
        <div className="relative overflow-hidden bg-[#0b1730] text-white">
          {v.hero_image && <img src={v.hero_image} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />}
          <div className="absolute inset-0 bg-gradient-to-r from-[#0b1730]/95 via-[#0b1730]/75 to-[#0b1730]/20" />
          <div className="relative flex flex-col gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-10">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#d9b46a]">{tier.name} record</div>
              <h1 className="mt-2 font-serif text-4xl font-semibold leading-tight sm:text-5xl">{street}</h1>
              {place && <div className="mt-1 text-sm text-white/75">{place}</div>}
              <div
                className={`mt-5 inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-semibold ${
                  live ? 'bg-emerald-500 text-white' : 'bg-amber-400 text-[#3a2a00]'
                }`}
              >
                {v.status === 'revoked' ? 'No longer verified' : live ? `Valid until ${fmt(v.expires_at)}` : `Expired ${fmt(v.expires_at)}`}
              </div>
            </div>
            <Seal live={live} color={instant ? '#0369a1' : '#047857'} word={tier.seal} />
          </div>
        </div>

        {v.status === 'revoked' && (
          // Expired and withdrawn are different facts and only one of them
          // means the record was wrong. Every check is still listed below, so
          // without this a reader takes "No longer verified" for an expiry.
          <div className="border-b border-[#fecaca] bg-[#fef2f2] px-6 py-5 sm:px-10">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[#7f1d1d]">
              Withdrawn by Palma Building Solutions
            </div>
            <p className="mt-2 text-sm text-[#7f1d1d]">
              This record was withdrawn{v.revoked_at ? ` on ${fmt(v.revoked_at)}` : ''} and should not be relied on.
              It did not simply expire. What is listed below is what was checked at the time.
            </p>
            {v.revoked_reason ? <p className="mt-2 text-sm font-semibold text-[#7f1d1d]">{v.revoked_reason}</p> : null}
            <p className="mt-2 text-sm text-[#7f1d1d]">
              Palma Building Solutions · 305-393-0690 · office@palma.llc
            </p>
          </div>
        )}

        <div className="px-6 py-8 sm:px-10">
          <h2 className="font-serif text-2xl font-semibold text-ink">{instant ? 'What the public records show' : 'What we checked'}</h2>
          <ul className="mt-4 divide-y divide-black/5 rounded-2xl ring-1 ring-black/5">
            {v.checks.map((c) =>
              instant ? (
                <li key={c.key} className="flex items-start gap-3 px-5 py-3.5">
                  <span aria-hidden className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${DOT[c.tone ?? 'grey'] ?? DOT.grey}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold text-ink">{c.label}</span>
                      <span className="font-serif text-lg font-semibold text-ink">{c.value}</span>
                    </div>
                    {c.note && <div className="text-sm text-ink-soft">{c.note}</div>}
                  </div>
                </li>
              ) : (
                <li key={c.key} className="flex items-start gap-3 px-5 py-3.5">
                  <span aria-hidden className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                    ✓
                  </span>
                  <div>
                    <div className="font-semibold text-ink">{c.label}</div>
                    {c.note && <div className="text-sm text-ink-soft">{c.note}</div>}
                  </div>
                </li>
              ),
            )}
          </ul>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {v.summary?.roofYear ? (
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Roof</div>
                <div className="font-serif text-xl font-semibold">{v.summary.roofYear}</div>
              </div>
            ) : null}
            {v.summary?.floodZone ? (
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Flood zone</div>
                <div className="font-serif text-xl font-semibold">{v.summary.floodZone}</div>
              </div>
            ) : null}
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Verified</div>
              <div className="font-serif text-xl font-semibold">{fmt(v.verified_at)}</div>
            </div>
          </div>

          {v.notes && <p className="mt-6 rounded-2xl bg-[#1f3864]/[0.05] px-5 py-4 text-sm text-ink-soft">{v.notes}</p>}

          <p className="mt-6 text-sm text-ink-soft">
            {instant
              ? `Automated records check by Palma Building Solutions. No staff review or site visit. Record ${v.id}, folio ${v.folio}.`
              : `Reviewed by ${v.reviewer}, Palma Building Solutions. Record ${v.id}, folio ${v.folio}.`}
          </p>
          <p className="mt-2 text-xs text-ink-muted">
            A review of public permit, code and flood records and photos on the date shown. It is not a home inspection, a survey, an
            appraisal or a guarantee of condition.
          </p>

          <details className="mt-8 rounded-2xl bg-slate-50 px-5 py-4">
            <summary className="cursor-pointer text-sm font-semibold text-[#1f3864]">Add this badge to a listing</summary>
            <img src={badgeUrl} alt="Palma Verified badge" width={240} height={64} className="mt-3" />
            <textarea readOnly value={embed} rows={3} className="mt-3 w-full rounded-lg border border-black/10 bg-white p-2 font-mono text-xs" />
          </details>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-gradient-to-br from-[#1f3864] to-[#102447] px-6 py-5 text-white">
            <div>
              <div className="font-serif text-xl font-semibold">Selling a home?</div>
              <div className="text-sm text-white/80">
                {TIERS.instant.name} {TIERS.instant.price}, or {TIERS.premium.name} with a staff review {TIERS.premium.price}.
              </div>
            </div>
            <a href="/" className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-[#1f3864]">Check your home</a>
          </div>
        </div>
      </article>
    </main>
  );
}
