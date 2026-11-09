import type { DiagnosticReport } from '@/lib/types';
import { LIEN_SEARCH_PRICE, LIEN_SEARCH_TURNAROUND } from '@/lib/lien-search-config';
import { cityGoverns, cityLabel } from '@/lib/code-authority';

// Recorded liens and unpaid fines, with the way to order the full lien search
// a title company runs before closing.
//
// The card appears only when a live source actually answered for this county
// (report.liens is null otherwise), and it says what that source covered: a
// clear result in Broward means the city's code cases were clear, not that the
// whole county was searched.
export default function LiensCard({ report }: { report: DiagnosticReport }) {
  const l = report.liens;
  const folio = (report.property.folio ?? '').replace(/\D+/g, '');
  if (!l || !folio) return null;
  const n = l.lines.length;
  const href = `/lien-search?folio=${folio}&county=${l.county}`;

  // A clear county result is not a clear property when a city enforces code
  // here and we never searched it. Naming the scope was not enough: a green
  // tick reads as "all clear" whatever the caption says, which is how a
  // Hialeah property with an active violation came back looking clean.
  const city = cityLabel(report.property.municipality ?? null);
  const cityUnchecked =
    cityGoverns(report.property.municipality ?? null) &&
    report.codeEnforcement.cityCodeChecked !== true;

  const state: 'hits' | 'clear' | 'partial' | 'failed' =
    n > 0 ? 'hits' : !l.checked ? 'failed' : cityUnchecked ? 'partial' : 'clear';

  const tone =
    state === 'hits'
      ? 'bg-red-50 ring-red-200'
      : state === 'clear'
      ? 'bg-emerald-50 ring-emerald-200'
      : 'bg-amber-50 ring-amber-200';

  return (
    <section>
      <div className={`rounded-2xl px-6 py-5 ring-1 ${tone}`}>
        <div className="flex flex-wrap items-center gap-4">
          <span
            aria-hidden
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white ${
              state === 'hits' ? 'bg-red-600' : state === 'clear' ? 'bg-emerald-600' : 'bg-amber-500'
            }`}
          >
            {state === 'hits' ? n : state === 'clear' ? '✓' : '?'}
          </span>
          <div className="min-w-[14rem] flex-1">
            <div className="font-serif text-xl font-semibold text-ink">
              {state === 'hits'
                ? `${n} lien${n > 1 ? 's' : ''} or unpaid fine${n > 1 ? 's' : ''} on record`
                : state === 'partial'
                ? `${city} was not searched`
                : state === 'clear'
                ? `Nothing found in ${l.scope}`
                : 'Liens could not be checked this time'}
            </div>
            <p className="!mb-0 !text-sm text-ink-soft">
              {state === 'hits'
                ? 'These must be paid and released before a clean closing.'
                : state === 'partial'
                ? `${city} enforces code at this address and runs its own records, which we cannot search. We checked ${l.scope} and found nothing there. That is not the same as the property being clear - a ${city} violation would not appear above.`
                : `This check covered ${l.scope}. Taxes, Official Records, water bills and everything else are checked in the full lien search.`}
            </p>
          </div>
          <a href={href} className="shrink-0 rounded-full bg-[#1f3864] px-5 py-2 text-sm font-semibold text-white no-underline shadow-sm hover:bg-[#102447]">
            Get the lien search · {LIEN_SEARCH_PRICE}
          </a>
        </div>
        {n > 0 && (
          <ul className="!list-none !ml-0 mt-4 divide-y divide-black/5 rounded-xl bg-white/70">
            {l.lines.slice(0, 4).map((x, i) => (
              <li key={i} className="!mb-0 px-4 py-2.5">
                <div className="text-sm font-semibold text-ink">{x.title}</div>
                <div className="text-sm text-ink-soft">{x.detail}</div>
              </li>
            ))}
            {n > 4 && <li className="!mb-0 px-4 py-2.5 text-sm text-ink-muted">And {n - 4} more in the lien search.</li>}
          </ul>
        )}
        <p className="!mb-0 !mt-3 !text-xs text-ink-muted">Full search: county records now, the rest by Palma staff, {LIEN_SEARCH_TURNAROUND.toLowerCase()}.</p>
      </div>
    </section>
  );
}
