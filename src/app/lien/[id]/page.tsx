import { getLienRecord, recordFound } from '@/lib/lien-records';
import LienSections from '../../lien-search/LienSections';

export const dynamic = 'force-dynamic';

const et = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

// A finished lien search, as delivered to the title company: county records
// plus what Palma staff found in taxes, Official Records and utilities.
export default async function LienRecordPage({ params }: { params: { id: string } }) {
  const look = await getLienRecord(params.id);

  // Not knowing is its own answer. "No lien search found" when the database is
  // simply unreachable reads as a broken link, and a title company reading
  // that falls back on the PDF in their inbox, which may be the withdrawn one.
  if (!look.ok) {
    return (
      <main className="mx-auto max-w-xl px-4 py-20 text-center">
        <h1 className="font-serif text-3xl font-semibold">We could not load this search</h1>
        <p className="mt-3 text-ink-soft">
          Something on our side is not answering. This does not mean the search is missing or wrong, only that we
          cannot show it to you right now.
        </p>
        <p className="mt-4 text-ink">
          Refresh in a minute. If you are closing today, call Palma at{' '}
          <a className="font-semibold underline" href="tel:+13053930690">305-393-0690</a> before you rely on any copy
          you are holding.
        </p>
      </main>
    );
  }
  const rec = look.record;

  // A withdrawn search must say WITHDRAWN, not "not found". The title company
  // is holding the PDF we sent them: a link that reads as broken sends them
  // back to that copy, which is the one thing this page exists to prevent.
  if (rec && rec.status === 'revoked') {
    return (
      <main className="min-h-screen bg-[#f6f4ef] pb-16">
        <div className="bg-[#7f1d1d] text-white">
          <div className="mx-auto max-w-3xl px-4 pb-20 pt-12">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-white/80">
              Withdrawn · do not rely on this search
            </div>
            <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight">
              {rec.address.split(',')[0]}
            </h1>
            <div className="mt-1 text-sm text-white/80">Record {rec.id} · folio {rec.search.prettyFolio}</div>
          </div>
        </div>

        <div className="mx-auto -mt-14 max-w-3xl space-y-5 px-4">
          <section className="rounded-2xl bg-white px-6 py-6 shadow-[0_20px_60px_rgba(16,36,71,0.18)] ring-1 ring-black/5">
            <p className="text-base text-ink">
              Palma Building Solutions withdrew this lien search
              {rec.revoked_at ? ` on ${et(rec.revoked_at)} ET` : ''}. Any copy you hold, including the PDF, should
              not be relied on for a closing.
            </p>
            {rec.revoked_reason ? (
              <p className="mt-4 rounded-xl bg-[#fef2f2] px-4 py-3 text-sm text-[#7f1d1d] ring-1 ring-[#fecaca]">
                {rec.revoked_reason}
              </p>
            ) : null}
            {rec.replaced_by ? (
              <p className="mt-4 text-sm text-ink">
                A corrected search replaces it:{' '}
                <a className="font-semibold underline" href={`/lien/${rec.replaced_by}`}>
                  {rec.replaced_by}
                </a>
              </p>
            ) : (
              <p className="mt-4 text-sm text-ink-soft">
                A corrected search has not been issued yet. Call before you close.
              </p>
            )}
            <p className="mt-5 text-sm text-ink-soft">
              Palma Building Solutions · 305-393-0690 · office@palma.llc
              {rec.revoked_by ? ` · withdrawn by ${rec.revoked_by}` : ''}
            </p>
          </section>
        </div>
      </main>
    );
  }

  if (!rec || rec.status !== 'final') {
    return (
      <main className="mx-auto max-w-xl px-4 py-20 text-center">
        <h1 className="font-serif text-3xl font-semibold">No lien search found</h1>
        <p className="mt-3 text-ink-soft">Check the link in your email, or call Palma at 305-393-0690.</p>
      </main>
    );
  }
  const r = rec.search;
  const n = recordFound(rec);
  const [street, ...rest] = rec.address.split(',');
  const place = rest.join(',').replace(/-0000\b/, '').trim();
  const ordered = [rec.client?.company, rec.client?.name].filter(Boolean).join(', ');

  return (
    <main className="min-h-screen bg-[#f6f4ef] pb-16">
      <div className="bg-[#0b1730] text-white">
        <div className="mx-auto max-w-4xl px-4 pb-24 pt-12">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[#d9b46a]">Final lien search · Miami-Dade County</div>
          <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight sm:text-5xl">{street}</h1>
          <div className="mt-1 text-sm text-white/75">{place}</div>
          <div className="mt-4 text-sm text-white/75">
            Completed {et(rec.completed_at)} ET by {rec.reviewer}, Palma Building Solutions · Record {rec.id}
          </div>
        </div>
      </div>

      <div className="mx-auto -mt-16 max-w-4xl space-y-6 px-4">
        <section className="overflow-hidden rounded-2xl bg-white shadow-[0_20px_60px_rgba(16,36,71,0.18)] ring-1 ring-black/5">
          <div className="flex flex-col gap-4 px-6 py-6 sm:flex-row sm:items-start sm:justify-between">
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="font-semibold text-ink-muted">Folio</dt>
              <dd className="text-ink">{r.prettyFolio}</dd>
              <dt className="font-semibold text-ink-muted">Owner</dt>
              <dd className="text-ink">{r.owner ?? 'Not shown'}</dd>
              <dt className="font-semibold text-ink-muted">Municipality</dt>
              <dd className="text-ink">{r.municipality ?? 'Not shown'}</dd>
              <dt className="font-semibold text-ink-muted">Legal</dt>
              <dd className="text-ink">{r.legal ?? 'Not shown'}</dd>
              {ordered && (
                <>
                  <dt className="font-semibold text-ink-muted">Ordered by</dt>
                  <dd className="text-ink">{ordered}</dd>
                </>
              )}
              {rec.client?.closingDate && (
                <>
                  <dt className="font-semibold text-ink-muted">Closing</dt>
                  <dd className="text-ink">{rec.client.closingDate}</dd>
                </>
              )}
            </dl>
            <div className={`shrink-0 rounded-2xl px-5 py-4 text-center ${n ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>
              <div className="font-serif text-4xl font-semibold">{n || '✓'}</div>
              <div className="text-xs font-semibold uppercase tracking-wider">{n ? `to resolve` : 'Clear'}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-black/5 bg-[#1f3864]/[0.03] px-6 py-3 text-xs text-ink-muted">
            <span>County records searched {et(rec.searched_at)} ET</span>
            <a href={`/lien/${rec.id}/pdf`} target="_blank" rel="noreferrer" className="ml-auto rounded-full bg-[#1f3864] px-4 py-1.5 font-semibold text-white hover:bg-[#102447]">
              Download PDF
            </a>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 ring-1 ring-black/5">
          <h3 className="font-serif text-xl font-semibold text-ink">Taxes, Official Records and utilities</h3>
          <p className="mt-1 text-sm text-ink-soft">Checked by {rec.reviewer}, Palma Building Solutions.</p>
          <ul className="mt-3 divide-y divide-black/5">
            {rec.staff.map((s) => (
              <li key={s.key} className="flex gap-3 py-2.5">
                <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${s.result === 'found' ? 'bg-red-600' : 'bg-emerald-600'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-semibold text-ink">{s.title}</span>
                    <span className={`text-[11px] font-bold uppercase tracking-wider ${s.result === 'found' ? 'text-red-700' : 'text-emerald-700'}`}>
                      {s.result === 'found' ? `Found${s.amount ? ` · ${s.amount}` : ''}` : 'Clear'}
                    </span>
                  </div>
                  {s.note && <div className="text-sm text-ink-soft">{s.note}</div>}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <LienSections sections={r.sections} />

        {rec.notes && (
          <section className="rounded-2xl bg-white p-5 ring-1 ring-black/5">
            <h3 className="font-serif text-xl font-semibold text-ink">Notes</h3>
            <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{rec.notes}</p>
          </section>
        )}

        <p className="text-xs text-ink-muted">
          A search of Miami-Dade County public records by folio, on the dates shown. It is not title insurance, a payoff letter, an estoppel letter or a
          guarantee. Amounts owed are confirmed with the agency that holds the lien. Questions: 305-393-0690.
        </p>
      </div>
    </main>
  );
}
