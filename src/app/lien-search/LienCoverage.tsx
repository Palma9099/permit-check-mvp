import type { LienSearch } from '@/lib/lien-search';

// What was pulled live and what a person pulls, printed on every search.
//
// This block is the honesty of the product in one place. A county that
// publishes case records gets them pulled by parcel; a county that publishes
// none gets its records read by a person. Without this block a reader cannot
// tell the two apart, and an empty result in the second kind of county would
// read as a clean sweep.
export default function LienCoverage({ search }: { search: LienSearch }) {
  const { coverage: c, countyName, parcelLabel } = search;
  return (
    <section className="rounded-2xl bg-white p-5 ring-1 ring-black/5">
      <h3 className="font-serif text-xl font-semibold text-ink">How this search was done</h3>
      <p className="mt-1 text-sm text-ink-soft">
        {c.level === 'cases'
          ? `${countyName} publishes the case records below, so they are pulled live by ${parcelLabel.toLowerCase()} at the moment you run this.`
          : `${countyName} publishes no case records you can look up by ${parcelLabel.toLowerCase()}. The parcel is confirmed live; every record is read by a person before the search is delivered.`}
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Pulled live</div>
          <ul className="mt-2 space-y-1.5">
            {c.automated.map((x) => (
              <li key={x} className="flex gap-2 text-sm text-ink-soft">
                <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-600" />
                <span>{x}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Read by a person</div>
          <ul className="mt-2 space-y-1.5">
            {c.byHand.map((x) => (
              <li key={x} className="flex gap-2 text-sm text-ink-soft">
                <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                <span>{x}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
