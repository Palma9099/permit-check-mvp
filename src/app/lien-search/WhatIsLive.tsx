import type { liveCoverage } from '@/lib/lien-search';

type Coverage = ReturnType<typeof liveCoverage>;

// Which governments Palma pulls live, built from the provider registry rather
// than written out, so this cannot drift from what the code actually does.
//
// It is on the page before anyone searches because the alternative is worse:
// a reader who assumes every county is pulled live will read a records-level
// search as a clean sweep. Saying plainly that most Florida governments
// publish nothing queryable is both true and the reason the $99 search has a
// person in it.
export default function WhatIsLive({ coverage }: { coverage: Coverage }) {
  const { counties, cities } = coverage;
  return (
    <section className="mt-10 rounded-2xl bg-white p-5 ring-1 ring-black/5">
      <h2 className="font-serif text-xl font-semibold text-ink">What is pulled live, and what a person pulls</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Any Florida address can be searched. Most Florida counties and cities publish no case records you can look up by
        parcel number, so for those the search confirms the parcel and the municipality live and names the office that
        holds each record. These are the ones whose own data answers by parcel:
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Counties</div>
          <ul className="mt-2 space-y-1.5">
            {counties.map((c) => (
              <li key={c.key} className="flex gap-2 text-sm text-ink-soft">
                <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-600" />
                <span>{c.name}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Cities</div>
          <ul className="mt-2 space-y-1.5">
            {cities.map((c) => (
              <li key={`${c.county}-${c.label}`} className="flex gap-2 text-sm text-ink-soft">
                <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-600" />
                <span>
                  {c.label} <span className="text-ink-muted">({c.what.join(' and ')})</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-4 text-xs text-ink-muted">
        Taxes, Official Records and utility balances sit behind a captcha or a bot check in every Florida county, so
        they are read by a person on every search, everywhere.
      </p>
    </section>
  );
}
