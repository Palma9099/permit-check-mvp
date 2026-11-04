'use client';

import type { DiagnosticReport } from '@/lib/types';
import { pickDisplayFrames, resolutionLabel } from '@/lib/images/historical-aerial';

type Frame = NonNullable<DiagnosticReport['thenVsNow']['historicalAerials']['then']>;

// The parcel outline drawn over a tight crop. displayBbox is the crop's extent,
// so each polygon vertex maps straight onto the picture.
export function Outline({ frame, ring }: { frame: Frame; ring: Array<[number, number]> }) {
  const b = frame.displayBbox;
  if (!b || ring.length < 3) return null;
  const pts = ring
    .map(([lat, lng]) => {
      const x = ((lng - b.lon1) / (b.lon2 - b.lon1)) * 100;
      const y = ((b.lat2 - lat) / (b.lat2 - b.lat1)) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      <polygon points={pts} fill="none" stroke="#ff2d2d" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

// Earliest, a middle year, and latest aerial, each cropped tight on the parcel
// with the outline drawn, followed by today's sharp Google view.
export default function AerialTimeline({ report }: { report: DiagnosticReport }) {
  const t = report.thenVsNow;
  const ring = (t.parcelPolygon as Array<[number, number]> | null) ?? [];
  const frames = pickDisplayFrames(t.historicalAerials?.allFrames ?? []);
  if (frames.length === 0 && !t.satelliteImageUrl) return null;

  return (
    <div className="mt-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
        Then and now, aerial timeline
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {frames.map((f) => (
          <figure key={f.itemId}>
            <div className="relative aspect-square overflow-hidden rounded-md border border-black/10 bg-slate-100">
              <img
                src={f.displayImageUrl}
                alt={`Aerial photo from ${f.captureYear}`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <Outline frame={f} ring={ring} />
            </div>
            <figcaption className="mt-1 text-[11px] text-ink-muted">
              <span className="font-semibold text-ink">{f.captureYear}</span>
              {f.gsdMeters ? ` · ${resolutionLabel(f.gsdMeters)}` : ''}
            </figcaption>
          </figure>
        ))}
        {t.satelliteImageUrl && (
          <figure>
            <div className="relative aspect-square overflow-hidden rounded-md border border-black/10 bg-slate-100">
              <img src={t.satelliteImageUrl} alt="Current Google satellite view" className="h-full w-full object-cover" loading="lazy" />
            </div>
            <figcaption className="mt-1 text-[11px] text-ink-muted">
              <span className="font-semibold text-ink">Today</span> · Google, sharpest available
            </figcaption>
          </figure>
        )}
      </div>
      <p className="mt-2 text-[11px] text-ink-muted">
        {t.historicalAerials?.source?.startsWith('Miami-Dade')
          ? 'Miami-Dade County aerial photos, one flight per year. Small shifts between flights are normal. They are a starting point for questions, not a record. Confirm anything notable with the county.'
          : "Older public aerials are about 2 to 3 feet per pixel, so they look soft next to today's photo. They are a starting point for questions, not a record. Confirm anything notable with the county."}
      </p>
    </div>
  );
}
