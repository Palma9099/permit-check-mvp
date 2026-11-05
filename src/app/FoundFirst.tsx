'use client';

import type { DiagnosticReport, VisionObservation } from '@/lib/types';
import type { Persona } from '@/lib/persona';
import type { StreetFrame } from '@/lib/street-history';
import type { HistoricalAerialFrame } from '@/lib/images/historical-aerial';
import { FOUND_NOTE, collectFindings, foundCta, foundHeadline, type Finding } from '@/lib/found';
import { Outline } from './AerialTimeline';

function requestQuote(topic: string) {
  window.dispatchEvent(new CustomEvent('palma:quote', { detail: { topic } }));
}

// "Changed between Mar 2022 and Jan 2025: small window in Mar 2022, black-frame window in Jan 2025."
function splitChange(text: string): { from: string; to: string; before: string; now: string } | null {
  const m = text.match(/^Changed between (.+?) and (.+?): (.+) in \1, (.+) in \2\.?$/);
  return m ? { from: m[1], to: m[2], before: m[3], now: m[4] } : null;
}

const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

type Pic = { src: string; label: string; overlay?: React.ReactNode };

function Photo({ pic, tag }: { pic: Pic | null; tag: string }) {
  return (
    <figure className="relative aspect-[4/3] overflow-hidden bg-slate-200">
      {pic ? <img src={pic.src} alt={`${tag}, ${pic.label}`} className="h-full w-full object-cover" /> : null}
      {pic?.overlay}
      <figcaption className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm">
        {tag}
        {pic ? ` · ${pic.label}` : ''}
      </figcaption>
    </figure>
  );
}

// The first thing below the hero: each change we can see, its before and now
// photo, and no permit to back it up.
export default function FoundFirst({
  report,
  role,
  streetHistory,
  streetFindings,
}: {
  report: DiagnosticReport;
  role: Persona | null;
  streetHistory: StreetFrame[] | null;
  streetFindings: { performed: boolean; observations: VisionObservation[] } | null;
}) {
  const aerialRan = !!report.thenVsNow?.visualComparison?.performed;
  if (!aerialRan) return null;
  const findings = collectFindings(report, streetFindings?.performed ? streetFindings.observations : null);
  const aerials = (report.thenVsNow?.historicalAerials?.allFrames ?? []).filter((f) => f.displayImageUrl);
  const ring = (report.thenVsNow?.parcelPolygon as Array<[number, number]> | null) ?? [];
  const street = streetHistory ?? [];

  const aerialPic = (f: HistoricalAerialFrame | undefined): Pic | null =>
    f?.displayImageUrl ? { src: f.displayImageUrl, label: String(f.captureYear), overlay: <Outline frame={f} ring={ring} /> } : null;
  const streetPic = (f: StreetFrame | undefined): Pic | null => (f ? { src: f.imageUrl, label: f.label } : null);

  // The two photos that show this change: the frames named in its dates when we
  // have them, else the oldest and newest of the right kind.
  function picsFor(f: Finding, ch: ReturnType<typeof splitChange>): [Pic | null, Pic | null] {
    if (f.source === 'street' && street.length >= 2) {
      const a = ch ? street.find((s) => s.label === ch.from) : undefined;
      const b = ch ? street.find((s) => s.label === ch.to) : undefined;
      return [streetPic(a ?? street[0]), streetPic(b ?? street[street.length - 1])];
    }
    const a = ch ? aerials.find((x) => String(x.captureYear) === ch.from) : undefined;
    const b = ch ? aerials.find((x) => String(x.captureYear) === ch.to) : undefined;
    return [aerialPic(a ?? aerials[0]), aerialPic(b ?? aerials[aerials.length - 1])];
  }

  if (findings.length === 0) {
    return (
      <section>
        <div className="flex items-center gap-4 rounded-2xl bg-emerald-50 px-6 py-5 ring-1 ring-emerald-200">
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xl text-white">✓</span>
          <div>
            <div className="font-serif text-xl font-semibold text-emerald-900">{foundHeadline(role, 0)}</div>
            <p className="!mb-0 !text-sm text-emerald-900/80">Older and newer photos match the permit record.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-red-700">What we found</div>
      <h2 className="!mt-1">{foundHeadline(role, findings.length)}</h2>
      <div className={`mt-4 grid gap-5 ${findings.length === 1 ? "" : "md:grid-cols-2"}`}>
        {findings.map((f) => {
          const ch = splitChange(f.text);
          const [before, now] = picsFor(f, ch);
          return (
            <article key={`${f.source}-${f.area}`} className="overflow-hidden rounded-2xl bg-white shadow-[0_8px_30px_rgba(16,36,71,0.10)] ring-1 ring-black/5">
              <div className="grid grid-cols-2 gap-px bg-white">
                <Photo pic={before} tag="Before" />
                <Photo pic={now} tag="Now" />
              </div>
              <div className="px-5 pb-5 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-serif text-xl font-semibold text-ink">{f.area.replace(/\s*\/\s*/g, ' / ')}</h3>
                  <span className="shrink-0 rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-red-700">No permit</span>
                </div>
                {ch ? (
                  <p className="!mb-3 !mt-1 !text-sm !leading-snug text-ink-soft">
                    {cap(ch.now)}. <span className="text-ink-muted">Was: {ch.before}.</span>
                  </p>
                ) : (
                  <p className="!mb-3 !mt-1 !text-sm !leading-snug text-ink-soft">{f.text}</p>
                )}
                <button
                  type="button"
                  onClick={() => requestQuote(`${foundCta(role)}: ${f.area}`)}
                  className="rounded-full bg-[#7a1d14] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#5e150e]"
                >
                  {foundCta(role)}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <p className="!mt-3 !text-xs !text-ink-muted">{FOUND_NOTE}</p>
    </section>
  );
}
