'use client';

import type { StreetFrame } from '@/lib/street-history';

// Dated Street View photos from the same spot, aimed at the house. The change
// between years is visible at a glance; nothing here is an official record.
export default function StreetHistory({ frames, timelineUrl }: { frames: StreetFrame[]; timelineUrl?: string | null }) {
  if (frames.length < 2) return null;
  const span = frames[frames.length - 1].year - frames[0].year;
  return (
    <div className="mt-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
        Street View, then and now · {frames[0].label} to {frames[frames.length - 1].label}
        {span > 0 ? ` (${span} years)` : ''}
      </div>
      <div className={`grid gap-3 ${frames.length >= 4 ? 'grid-cols-2 lg:grid-cols-4' : frames.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
        {frames.map((f, i) => (
          <figure key={f.pano}>
            <div className="relative aspect-[4/3] overflow-hidden rounded-md border border-black/10 bg-slate-100">
              <img src={f.imageUrl} alt={`Street View, ${f.label}`} className="h-full w-full object-cover" loading="lazy" />
            </div>
            <figcaption className="mt-1 text-[11px] text-ink-muted">
              <span className="font-semibold text-ink">{f.label}</span>
              {i === 0 ? ' · earliest' : i === frames.length - 1 ? ' · latest' : ''}
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-ink-muted">
        Each photo is from the same street position, looking at the property. Compare the roof, paint, doors, gates, fence and
        windows. A visible difference is a question to ask, not proof of unpermitted work.
        {timelineUrl ? (
          <>
            {' '}
            <a href={timelineUrl} target="_blank" rel="noreferrer" className="font-semibold underline">
              Open Street View
            </a>{' '}
            for the full timeline. Imagery &copy; Google.
          </>
        ) : (
          <> Imagery &copy; Google.</>
        )}
      </p>
    </div>
  );
}
