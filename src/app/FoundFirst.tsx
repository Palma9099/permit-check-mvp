'use client';

import type { DiagnosticReport, VisionObservation } from '@/lib/types';
import type { Persona } from '@/lib/persona';
import type { StreetFrame } from '@/lib/street-history';
import { pickDisplayFrames } from '@/lib/images/historical-aerial';
import { FOUND_NOTE, collectFindings, foundCta, foundHeadline, sourceLabel } from '@/lib/found';
import { Outline } from './AerialTimeline';

function requestQuote(topic: string) {
  window.dispatchEvent(new CustomEvent('palma:quote', { detail: { topic } }));
}

function Thumb({ src, label, overlay }: { src?: string | null; label: string; overlay?: React.ReactNode }) {
  if (!src) return null;
  return (
    <figure className="min-w-0">
      <div className="relative aspect-square overflow-hidden rounded-md border border-white/20 bg-white/10">
        <img src={src} alt={label} className="h-full w-full object-cover" />
        {overlay}
      </div>
      <figcaption className="mt-1 text-[11px] text-white/70">{label}</figcaption>
    </figure>
  );
}

// The first thing on the report: what changed, with no permit to back it up.
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
  const frames = pickDisplayFrames(report.thenVsNow?.historicalAerials?.allFrames ?? []);
  const aerialThen = frames[0];
  const aerialNow = frames[frames.length - 1];
  const svThen = streetHistory && streetHistory.length >= 2 ? streetHistory[0] : null;
  const svNow = streetHistory && streetHistory.length >= 2 ? streetHistory[streetHistory.length - 1] : null;
  const hasStreet = findings.some((f) => f.sources.includes('street'));
  const hasAerial = findings.some((f) => f.sources.includes('aerial'));
  const ring = (report.thenVsNow?.parcelPolygon as Array<[number, number]> | null) ?? [];

  if (findings.length === 0) {
    return (
      <section>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <div className="font-serif text-xl font-semibold text-emerald-800">{foundHeadline(role, 0)}</div>
          <p className="!text-sm !mb-0 text-emerald-900">
            We compared older and newer photos of the property against its permit record and found no visible change that
            lacks a permit.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="overflow-hidden rounded-xl bg-[#7a1d14] text-white shadow-card">
        <div className="px-5 pt-5 sm:px-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">What we found</div>
          <div className="mt-1 font-serif text-2xl font-semibold leading-tight sm:text-3xl">{foundHeadline(role, findings.length)}</div>
        </div>
        <div className="grid gap-4 px-5 pb-5 pt-4 sm:px-6 md:grid-cols-[1fr_auto]">
          <ul className="!list-none !ml-0 space-y-3">
            {findings.map((f) => (
              <li key={`${f.source}-${f.area}`} className="!mb-0 rounded-lg bg-white/10 px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-white">{f.area}</span>
                  <span className="text-[10px] uppercase tracking-wider text-white/60">{sourceLabel(f)}</span>
                </div>
                <p className="!text-sm !leading-snug !text-white/90 !mb-1 mt-1">{f.text}</p>
                <p className="!text-sm !font-semibold !text-white !mb-2">No permit found for it in county records.</p>
                <button
                  type="button"
                  onClick={() => requestQuote(`${foundCta(role)}: ${f.area}`)}
                  className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-[#7a1d14] hover:bg-white/90"
                >
                  {foundCta(role)}
                </button>
              </li>
            ))}
          </ul>
          <div className="grid w-full max-w-sm grid-cols-2 content-start gap-2 md:w-72">
            {hasAerial && aerialThen && aerialNow && (
              <>
                <Thumb src={aerialThen.displayImageUrl} label={`Aerial ${aerialThen.captureYear}`} overlay={<Outline frame={aerialThen} ring={ring} />} />
                <Thumb src={aerialNow.displayImageUrl} label={`Aerial ${aerialNow.captureYear}`} overlay={<Outline frame={aerialNow} ring={ring} />} />
              </>
            )}
            {hasStreet && svThen && svNow && (
              <>
                <Thumb src={svThen.imageUrl} label={`Street View ${svThen.label}`} />
                <Thumb src={svNow.imageUrl} label={`Street View ${svNow.label}`} />
              </>
            )}
          </div>
        </div>
        <p className="!mb-0 border-t border-white/15 px-5 py-3 !text-xs !text-white/70 sm:px-6">{FOUND_NOTE}</p>
      </div>
    </section>
  );
}
