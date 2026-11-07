import type { LienSection } from '@/lib/lien-search';

const ORDER = { found: 0, failed: 1, clear: 2 } as const;
const DOT = { red: 'bg-red-600', amber: 'bg-amber-500', green: 'bg-emerald-600' } as const;

function Chip({ s }: { s: LienSection }) {
  if (s.state === 'clear') return <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-emerald-700">Clear</span>;
  if (s.state === 'failed') return <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-amber-700">Not checked</span>;
  return <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-red-700">Found</span>;
}

// The county sections of a lien search: problems first, full width; clear
// sections after, side by side. Shared by the search page and the final record.
export default function LienSections({ sections }: { sections: LienSection[] }) {
  const clearCount = sections.filter((s) => s.state === 'clear' && s.lines.length === 0).length;
  return (
    <div className="grid gap-4 md:grid-cols-6">
      {[...sections]
        .sort((a, b) => ORDER[a.state] - ORDER[b.state])
        .map((s) => (
          <section
            key={s.key}
            className={`rounded-2xl bg-white p-5 ring-1 ring-black/5 ${
              s.state === 'clear' && s.lines.length === 0 ? (clearCount >= 3 ? 'md:col-span-2' : 'md:col-span-3') : 'md:col-span-6'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-serif text-xl font-semibold text-ink">{s.title}</h3>
              <Chip s={s} />
            </div>
            <p className="mt-1 text-sm text-ink-soft">{s.summary}</p>
            {s.lines.length > 0 && (
              <ul className="mt-3 divide-y divide-black/5">
                {s.lines.map((l, i) => (
                  <li key={i} className="flex gap-3 py-2.5">
                    <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[l.tone]}`} />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ink">{l.title}</div>
                      <div className="text-sm text-ink-soft">{l.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 text-[11px] text-ink-muted">Source: {s.source}</div>
          </section>
        ))}
    </div>
  );
}
