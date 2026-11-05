'use client';

import type { DiagnosticReport, Flag, VisionObservation } from '@/lib/types';
import LeadCapture from './LeadCapture';
import AtAGlance from './AtAGlance';
import ReadinessAndFixIt, { ScoreBreakdown } from './ReadinessAndFixIt';
import HomeHero from './HomeHero';
import { collectFindings } from '@/lib/found';
import StreetHistory from './StreetHistory';
import FoundFirst from './FoundFirst';
import type { StreetFrame } from '@/lib/street-history';
import { PERSONAS, personaCopy, type Persona } from '@/lib/persona';
import AerialTimeline from './AerialTimeline';
import CountyExtrasSection from './CountyExtrasSection';

// Translate internal/developer failure strings (e.g. "ANTHROPIC_API_KEY not
// set", "HTTP 502: ...", "json parse failed", "timeout after 12000ms") into
// clean, reassuring language for the reader. The raw reason still goes to the
// browser console for debugging via console.debug at the call site. Anything
// we don't specifically recognize collapses to a generic, non-alarming line so
// a stack-trace-looking string can never reach an end user.
function friendlyFailure(raw: string | null | undefined, kind: 'aerial' | 'streetview'): string {
  const label = kind === 'aerial' ? 'historical aerial imagery' : 'historical Street View';
  const s = (raw ?? '').toLowerCase();
  if (!s) return `No dated ${label} was available for this property.`;
  if (s.includes('api_key') || s.includes('api key') || s.includes('not set') || s.includes('not configured'))
    return `Automated ${label} comparison wasn’t available for this run.`;
  if (s.includes('timeout') || s.includes('network') || s.includes('fetch failed') || s.includes('econn'))
    return `The ${label} source didn’t respond in time - this can be temporary; try again shortly.`;
  if (s.includes('no imagery') || s.includes('no-rings') || s.includes('coverage') || s.includes('sparse') || s.includes('no usable'))
    return `No dated ${label} coverage exists for this location.`;
  if (/http\s*\d{3}/.test(s) || s.includes('parse') || s.includes('error'))
    return `The ${label} source was temporarily unavailable.`;
  return `No dated ${label} was available for this property.`;
}

function fmtMoney(n: number | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
  return '$' + n.toLocaleString('en-US');
}

function fmtNum(n: number | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
  return n.toLocaleString('en-US');
}

function fmtYear(n: number | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
  return String(Math.trunc(n));
}

function ConfidenceBadge({ grade }: { grade: 'high' | 'medium' | 'low' | 'not_observed' }) {
  const cls =
    grade === 'high'
      ? 'badge badge-ok'
      : grade === 'medium'
        ? 'badge badge-medium'
        : 'badge badge-weak';
  const label = grade === 'not_observed' ? 'NOT OBSERVED' : grade.toUpperCase();
  return <span className={cls}>{label}</span>;
}

function FlagCard({ flag }: { flag: Flag }) {
  const cls =
    flag.severity === 'strong'
      ? 'border-red-300 bg-red-50'
      : flag.severity === 'medium'
        ? 'border-amber-300 bg-amber-50'
        : 'border-gray-300 bg-gray-50';
  const badgeCls =
    flag.severity === 'strong'
      ? 'badge badge-strong'
      : flag.severity === 'medium'
        ? 'badge badge-medium'
        : 'badge badge-weak';
  return (
    <div className={`border rounded-md p-4 ${cls}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="font-semibold text-ink text-sm">{flag.title}</h3>
        <span className={badgeCls}>{flag.severity.toUpperCase()}</span>
      </div>
      <p className="text-sm text-ink-soft leading-relaxed">{flag.detail}</p>
    </div>
  );
}

function ObservationCard({ obs }: { obs: VisionObservation }) {
  const colorClass =
    obs.severity === 'flag'
      ? 'border-red-300 bg-red-50'
      : obs.severity === 'note'
        ? 'border-amber-300 bg-amber-50'
        : obs.severity === 'match'
          ? 'border-green-300 bg-green-50'
          : 'border-gray-300 bg-gray-50';
  const badgeClass =
    obs.severity === 'flag'
      ? 'badge badge-strong'
      : obs.severity === 'note'
        ? 'badge badge-medium'
        : obs.severity === 'match'
          ? 'badge badge-ok'
          : 'badge badge-weak';
  const label =
    obs.severity === 'flag'
      ? 'FLAG'
      : obs.severity === 'note'
        ? 'NOTE'
        : obs.severity === 'match'
          ? 'MATCH'
          : 'UNCERTAIN';
  return (
    <div className={`border rounded-md p-4 ${colorClass}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="font-semibold text-ink text-sm">{obs.area}</h3>
        <span className={badgeClass}>{label}</span>
      </div>
      <p className="text-sm text-ink-soft leading-relaxed">
        <span className="font-semibold text-ink">What we see:</span> {obs.whatWeSaw}
      </p>
      <p className="text-sm text-ink-soft leading-relaxed mt-1">
        <span className="font-semibold text-ink">Vs. permit record:</span> {obs.vsPermitRecord}
      </p>
    </div>
  );
}

function InsuranceCard({ ins, role }: { ins: DiagnosticReport['insurance']; role?: Persona | null }) {
  const cls =
    ins.band === 'newer'
      ? 'border-green-300 bg-green-50'
      : ins.band === 'old'
        ? 'border-red-300 bg-red-50'
        : ins.band === 'unknown'
          ? 'border-gray-300 bg-gray-50'
          : 'border-amber-300 bg-amber-50';
  const badgeCls =
    ins.band === 'newer'
      ? 'badge badge-ok'
      : ins.band === 'old'
        ? 'badge badge-strong'
        : ins.band === 'unknown'
          ? 'badge badge-weak'
          : 'badge badge-medium';
  const bandLabel =
    ins.band === 'newer'
      ? 'LIKELY INSURABLE'
      : ins.band === 'watch'
        ? 'WATCH'
        : ins.band === 'aging'
          ? 'AGING ROOF'
          : ins.band === 'old'
            ? 'ROOF RISK'
            : 'ROOF AGE UNKNOWN';
  return (
    <div className={`border rounded-md p-4 ${cls}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="font-semibold text-ink text-sm">
          Roof &amp; insurability
          {ins.roofAgeYears != null ? ` · ~${ins.roofAgeYears} yr roof` : ''}
        </h3>
        <span className={badgeCls}>{bandLabel}</span>
      </div>
      <p className="text-sm text-ink-soft leading-relaxed">{ins.roofBasis}</p>
      <p className="text-sm text-ink-soft leading-relaxed mt-1">{ins.insurabilityNote}</p>
      <p className="text-sm text-ink-soft leading-relaxed mt-1">{ins.windMitNote}</p>
      <p className="text-xs text-ink-muted italic mt-2">Estimate from the permit record, not an insurance quote.</p>
    </div>
  );
}

function RecertCard({ rc }: { rc: DiagnosticReport['recert'] }) {
  const cls =
    rc.applies === 'unlikely'
      ? 'border-green-300 bg-green-50'
      : rc.applies === 'likely'
        ? 'border-amber-300 bg-amber-50'
        : rc.applies === 'possible'
          ? 'border-amber-200 bg-amber-50'
          : 'border-gray-300 bg-gray-50';
  const badgeCls =
    rc.applies === 'unlikely'
      ? 'badge badge-ok'
      : rc.applies === 'unknown'
        ? 'badge badge-weak'
        : 'badge badge-medium';
  const badgeLabel =
    rc.applies === 'unlikely'
      ? 'NOT APPLICABLE'
      : rc.applies === 'likely'
        ? 'LIKELY APPLIES'
        : rc.applies === 'possible'
          ? 'MAY APPLY'
          : 'UNKNOWN';
  return (
    <div className={`border rounded-md p-4 ${cls}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="font-semibold text-ink text-sm">Milestone &amp; recertification</h3>
        <span className={badgeCls}>{badgeLabel}</span>
      </div>
      <p className="text-sm text-ink-soft leading-relaxed">{rc.detail}</p>
      {rc.programs.length > 0 && (
        <p className="text-sm text-ink-soft leading-relaxed mt-1">
          <span className="font-semibold text-ink">Programs that may apply:</span>{' '}
          {rc.programs.join('; ')}.
        </p>
      )}
      {rc.recommendation && (
        <p className="text-sm text-ink-soft leading-relaxed mt-1">{rc.recommendation}</p>
      )}
      <p className="text-xs text-ink-muted italic mt-2">
        Thresholds and timing are set by each jurisdiction and change; confirm the current
        requirement and any deadline with the county.
      </p>
    </div>
  );
}

function FloodCard({ flood }: { flood: DiagnosticReport['flood'] }) {
  const coastal = (flood.zone ?? '').toUpperCase().startsWith('V');
  const unknown = flood.failureReason != null || (flood.inSFHA == null && !flood.zone);
  const cls = unknown
    ? 'border-gray-300 bg-gray-50'
    : coastal
      ? 'border-red-300 bg-red-50'
      : flood.inSFHA
        ? 'border-amber-300 bg-amber-50'
        : 'border-green-300 bg-green-50';
  const badgeCls = unknown
    ? 'badge badge-weak'
    : coastal
      ? 'badge badge-strong'
      : flood.inSFHA
        ? 'badge badge-medium'
        : 'badge badge-ok';
  const badgeLabel = unknown
    ? 'ZONE UNKNOWN'
    : flood.inSFHA
      ? `HIGH-RISK · ${flood.zone ?? 'SFHA'}`
      : `LOWER RISK${flood.zone ? ` · ${flood.zone}` : ''}`;
  return (
    <div className={`border rounded-md p-4 ${cls}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="font-semibold text-ink text-sm">
          Flood zone
          {flood.baseFloodElevationFt != null ? ` · BFE ~${flood.baseFloodElevationFt} ft` : ''}
        </h3>
        <span className={badgeCls}>{badgeLabel}</span>
      </div>
      <p className="text-sm text-ink-soft leading-relaxed">{flood.summary}</p>
      <p className="text-sm text-ink-soft leading-relaxed mt-1">{flood.insuranceNote}</p>
      {flood.fiftyPercentNote && (
        <p className="text-sm text-ink-soft leading-relaxed mt-1">{flood.fiftyPercentNote}</p>
      )}
      <p className="text-xs text-ink-muted italic mt-2">
        {flood.source}. The mapped zone can differ for a specific parcel; confirm on the
        FEMA Map Service Center (msc.fema.gov) and with the community floodplain office.
      </p>
    </div>
  );
}

// House style: no long dashes in reader-facing text, even from AI output.
const noDash = (t: string) => t.replace(/\s*[\u2014\u2013]\s*/g, ', ');

// Limitation lines come from several modules and can say the same thing twice.
function dedupeLines(lines: string[]): string[] {
  const key = (t: string) => t.toLowerCase().replace(/[^a-z ]/g, '').split(' ').slice(0, 6).join(' ');
  const seen = new Set<string>();
  // The footer already carries the not-a-determination disclaimer.
  return lines.filter((l) => !/never makes legal/i.test(l) && !seen.has(key(l)) && !!seen.add(key(l)));
}

export default function Report({
  report,
  role = null,
  onRoleChange,
  streetHistory = null,
  streetFindings = null,
}: {
  report: DiagnosticReport;
  role?: Persona | null;
  onRoleChange?: (p: Persona) => void;
  streetHistory?: StreetFrame[] | null;
  streetFindings?: { performed: boolean; observations: VisionObservation[] } | null;
}) {
  const haveStreetHistory = !!streetHistory && streetHistory.length >= 2;
  const pc = personaCopy(role);
  const r = report;
  const vc = r.thenVsNow?.visualComparison;
  // Same list as the What we found block, so the hero count always matches it.
  const findingsCount = vc?.performed ? collectFindings(r, streetFindings?.performed ? streetFindings.observations : null).length : null;
  // The geocoder prepends this line when the address match is uncertain. Pull it
  // out of the bottom-line list and show it as a prominent banner instead.
  const uncertainLine = r.bottomLine.find((l) => l.startsWith('ADDRESS MATCH UNCERTAIN'));
  return (
    <article className="bg-card shadow-card rounded-lg border border-black/5 overflow-hidden">
      {/* Low-confidence address-match banner */}
      {uncertainLine && (
        <div className="flex items-start gap-3 bg-amber-50 border-b-2 border-amber-400 px-6 sm:px-10 py-4">
          <span aria-hidden className="text-amber-600 text-xl leading-none mt-0.5">⚠</span>
          <div className="text-sm text-amber-900">
            <p>
              <span className="font-semibold">Address match uncertain. </span>
              {uncertainLine.replace(/^ADDRESS MATCH UNCERTAIN[--]?\s*/, '')}
            </p>
            {r.addressCandidates && r.addressCandidates.length > 0 && (
              <div className="mt-2">
                <span className="font-semibold">Other parcels matched this address:</span>
                <ul className="mt-1 space-y-0.5">
                  {r.addressCandidates.map((c) => (
                    <li key={c.folio}>
                      · {c.address || 'Address unavailable'}{' '}
                      <span className="text-amber-700">(folio {c.folio})</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-amber-700">
                  If one of these is the right property, re-run the check using its folio.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
      <HomeHero report={r} role={role} onRoleChange={onRoleChange} findingsCount={findingsCount} />

      <div className="px-6 sm:px-10 py-8 prose-section">
        <FoundFirst report={r} role={role} streetHistory={streetHistory} streetFindings={streetFindings} />

        <AtAGlance report={r} role={role} />

        <ReadinessAndFixIt report={r} role={role} findingsCount={findingsCount ?? 0} />

        {/* Everything an agent, lender or inspector may want, one tap away. */}
        <details className="group mt-10 rounded-2xl ring-1 ring-black/10 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl bg-slate-50 px-5 py-4 hover:bg-slate-100">
            <span>
              <span className="block font-serif text-lg font-semibold text-ink">Full details</span>
              <span className="block text-xs text-ink-muted">Score breakdown, records, photos and sources, for your agent or inspector</span>
            </span>
            <span aria-hidden className="text-2xl leading-none text-ink-muted transition group-open:rotate-45">+</span>
          </summary>
          <div className="px-5 pb-6 pt-2">
        <ScoreBreakdown report={r} role={role} />


        {/* Top flags */}
        {(r.flags.strong.length > 0 || r.flags.medium.length > 0) && (
          <section>
            <h2>Top flags</h2>
            <div className="space-y-3 mt-3">
              {r.flags.strong.map((f, i) => (
                <FlagCard key={`s${i}`} flag={f} />
              ))}
              {r.flags.medium.map((f, i) => (
                <FlagCard key={`m${i}`} flag={f} />
              ))}
            </div>
          </section>
        )}

        {/* Insurance & roof outlook — the #1 Florida deal factor */}
        {r.insurance && (
          <section>
            <h2>Insurance &amp; roof outlook</h2>
            <InsuranceCard ins={r.insurance} role={role} />
          </section>
        )}

        {/* Flood zone — FEMA NFHL, nationwide */}
        {r.flood && (
          <section>
            <h2>Flood risk</h2>
            <FloodCard flood={r.flood} />
          </section>
        )}

        <CountyExtrasSection report={r} />

        {/* Milestone / recertification exposure */}
        {r.recert && r.recert.applies !== 'unlikely' && (
          <section>
            <h2>Milestone &amp; recertification</h2>
            <RecertCard rc={r.recert} />
          </section>
        )}

        {/* What this means & how to negotiate */}
        {pc.showNegotiation && r.negotiation && r.negotiation.items.length > 0 && (
          <section>
            <h2>How to negotiate</h2>
            {r.negotiation.sellerQuestions.length > 0 && (
              <div className="mt-3">
                <h3 className="font-semibold text-ink text-sm mb-1">Ask the seller</h3>
                <ul>
                  {r.negotiation.sellerQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </div>
            )}

            {r.negotiation.contingencyItems.length > 0 && (
              <div className="mt-4">
                <h3 className="font-semibold text-ink text-sm mb-1">Put in your offer</h3>
                <ul>
                  {r.negotiation.contingencyItems.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-ink-muted italic mt-3">
              Guidance, not a bid. Use the fixed quotes above to price each item.
            </p>
          </section>
        )}

        {/* Visual review */}
        {r.thenVsNow && r.thenVsNow.coordinates && (
          <section>
            <h2>Visual review</h2>

            {vc?.performed ? (
              <p className="italic text-ink-soft">{noDash(vc.summary)}</p>
            ) : (
              <p>
                Records tell half the story. Use the imagery below to compare the
                subject to its neighbors and spot anything the permit record doesn't
                explain.
              </p>
            )}

            {/* Then vs Now - historical NAIP (THEN) paired with current Google
                satellite (NOW) for maximum visual sharpness. NAIP is 1m
                native for older years and looks pixelated when upsampled;
                Google Static Maps at zoom 20 is sub-meter and crisp. The AI
                still receives both NAIP frames internally for like-for-like
                change detection - this is just for the human reader. */}
            <AerialTimeline report={r} />
            {r.thenVsNow.historicalAerials && !r.thenVsNow.historicalAerials.then && r.thenVsNow.historicalAerials.failureReason && (
              <p className="text-xs text-ink-muted italic mt-3">
                {friendlyFailure(r.thenVsNow.historicalAerials.failureReason, 'aerial')}
              </p>
            )}

            {/* Block context - subject vs neighbors. The tight subject frame
                with the red polygon is already shown above as "Now"; we drop
                the standalone subject image here to avoid duplicating it. */}
            {r.thenVsNow.contextSatelliteImageUrl && (
              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
                  Block context - subject vs. neighbors
                </div>
                <img
                  src={r.thenVsNow.contextSatelliteImageUrl}
                  alt="Wider block context with parcel polygon overlay"
                  className="w-full md:w-1/2 rounded-md border border-black/10"
                  loading="lazy"
                />
              </div>
            )}

            {/* User-uploaded historical photo - when supplied, this is the
                canonical THEN reference, paired against the closest current
                Google Street View frame for facade comparison. */}
            {r.thenVsNow.userUploadedThen?.dataUrl && (
              <div className="mt-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
                  Then vs Now - Street View (User-supplied historical photo)
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-ink-muted mb-1">
                      Then{r.thenVsNow.userUploadedThen.captureDate ? ` · ${r.thenVsNow.userUploadedThen.captureDate}` : ''}
                      {r.thenVsNow.userUploadedThen.caption ? ` · ${r.thenVsNow.userUploadedThen.caption}` : ''}
                    </div>
                    <img
                      src={r.thenVsNow.userUploadedThen.dataUrl}
                      alt="User-uploaded historical photo"
                      className="w-full rounded-md border border-black/10"
                      loading="lazy"
                    />
                  </div>
                  {(() => {
                    const nowFrame = (r.thenVsNow.streetViewImages ?? []).find((s) => s.imageUrl);
                    if (!nowFrame?.imageUrl) {
                      return (
                        <div className="text-[11px] text-ink-muted italic">
                          No current Street View available for side-by-side.
                        </div>
                      );
                    }
                    return (
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-ink-muted mb-1">
                          Now · current Google Street View
                        </div>
                        <img
                          src={nowFrame.imageUrl}
                          alt={nowFrame.label}
                          className="w-full rounded-md border border-black/10"
                          loading="lazy"
                        />
                      </div>
                    );
                  })()}
                </div>
                <p className="text-[11px] text-ink-muted mt-2">
                  Realtor-supplied THEN. Compare facade paint, front door, gates, garage door, windows on each side.
                </p>
              </div>
            )}

            <StreetHistory frames={streetHistory ?? []} timelineUrl={r.thenVsNow.streetViewTimelineUrl || r.thenVsNow.streetViewUrl} />

            {/* Street View - Then vs Now (Mapillary), one row per fronting
                street so corner lots show all sides. */}
            {(() => {
              const sides = r.thenVsNow.historicalStreetView?.sides ?? [];
              const usableSides = sides.filter((s) => s.then && s.now);
              if (usableSides.length === 0) return null;
              return (
                <div className="mt-5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
                    Then vs Now - Street View
                    {r.thenVsNow.historicalStreetView?.source ? ` (${r.thenVsNow.historicalStreetView.source})` : ''}
                    {usableSides.length > 1 ? ` · ${usableSides.length} sides` : ''}
                  </div>
                  {usableSides.map((side, sIdx) => (
                    <div key={sIdx} className={sIdx > 0 ? 'mt-4' : ''}>
                      {usableSides.length > 1 && (
                        <div className="text-[11px] uppercase tracking-wider text-ink-muted mb-2">
                          {side.sideLabel}
                        </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-ink-muted mb-1">
                            Then · {side.then!.label || side.then!.captureDate.slice(0, 10)}
                          </div>
                          <img
                            src={side.then!.imageUrl}
                            alt={`Street View ${side.then!.captureYear}`}
                            className="w-full rounded-md border border-black/10"
                            loading="lazy"
                          />
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-ink-muted mb-1">
                            Now · {side.now!.label || side.now!.captureDate.slice(0, 10)}
                          </div>
                          <img
                            src={side.now!.imageUrl}
                            alt={`Street View ${side.now!.captureYear}`}
                            className="w-full rounded-md border border-black/10"
                            loading="lazy"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  <p className="text-[11px] text-ink-muted mt-2">
                    Compare facade paint, front door, gates, garage door, windows on each side.
                    {/Mapillary/i.test(r.thenVsNow.historicalStreetView?.source ?? '') && (
                      <> Street photos &copy; Mapillary contributors, licensed CC BY-SA 4.0.</>
                    )}
                  </p>
                </div>
              );
            })()}
            {!haveStreetHistory && streetHistory !== null && r.thenVsNow.historicalStreetView && !r.thenVsNow.historicalStreetView.then && r.thenVsNow.historicalStreetView.failureReason && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <p className="text-xs text-amber-800">
                  <span className="font-semibold">Older Street View photos can&apos;t be pulled into this report.</span>{' '}
                  Google keeps older photos of most streets, but it does not let reports like this one list them, and no
                  matching older street-level photos from other sources were found for this address. The current photo
                  is shown below.
                </p>
                {(r.thenVsNow.streetViewTimelineUrl || r.thenVsNow.streetViewUrl) && (
                  <p className="text-xs text-amber-800 mt-1.5">
                    To see the past yourself, open Street View, then click{' '}
                    <span className="font-semibold">&ldquo;See more dates&rdquo;</span> (the clock icon) and scrub through the years.{' '}
                    <a
                      href={r.thenVsNow.streetViewTimelineUrl || r.thenVsNow.streetViewUrl || '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold underline"
                    >
                      Open Street View for this address
                    </a>
                    .
                  </p>
                )}
                {!r.thenVsNow.userUploadedThen?.dataUrl && (
                  <p className="text-xs text-amber-800 mt-1.5">
                    Or attach an older photo (an old MLS listing photo or a field photo) in the{' '}
                    <span className="font-semibold">&ldquo;Upload a historical photo&rdquo;</span> slot when you re-run the
                    check. The AI will compare it against the current Street View and flag changes to the roof, windows,
                    doors, fence and driveway.
                  </p>
                )}
              </div>
            )}

            {/* Current Street View (Google, heading-aware) */}
            {r.thenVsNow.streetViewImages && r.thenVsNow.streetViewImages.length > 0 && (
              <div className="mt-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
                  Street View - front of subject (current)
                </div>
                <div className={`grid gap-2 ${r.thenVsNow.streetViewImages.length === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-2 md:grid-cols-4'}`}>
                  {r.thenVsNow.streetViewImages.map((sv, i) =>
                    sv.imageUrl ? (
                      <div key={i} className="space-y-1">
                        <img
                          src={sv.imageUrl}
                          alt={sv.label}
                          className="w-full rounded-md border border-black/10"
                          loading="lazy"
                        />
                        <div className="text-[11px] text-ink-muted text-center">
                          {sv.label}
                        </div>
                      </div>
                    ) : null,
                  )}
                </div>
              </div>
            )}

            {/* Parcel source line */}
            {r.thenVsNow.parcelPolygonSource && (
              <p className="text-xs text-ink-muted italic mt-3">
                Parcel boundary: {r.thenVsNow.parcelPolygonSource}. The red outline
                marks the subject property - anything outside it is a neighbor and is
                never used as a finding.
              </p>
            )}

            {/* Click-throughs (compact) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
              {r.thenVsNow.streetViewTimelineUrl && (
                <a
                  href={r.thenVsNow.streetViewTimelineUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 rounded-md border border-black/10 bg-white text-sm hover:bg-black/5"
                >
                  Open Street View (timeline) →
                </a>
              )}
              {r.thenVsNow.historicalAerialUrl && (
                <a
                  href={r.thenVsNow.historicalAerialUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 rounded-md border border-black/10 bg-white text-sm hover:bg-black/5"
                >
                  {r.county?.name
                    ? `${r.county.name} historical aerials →`
                    : 'County historical aerials →'}
                </a>
              )}
              {r.county?.portals?.propertyAppraiser && (
                <a
                  href={r.county.portals.propertyAppraiser}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 rounded-md border border-black/10 bg-white text-sm hover:bg-black/5"
                >
                  {r.county.name} Property Appraiser →
                </a>
              )}
              {r.county?.portals?.buildingDept && (
                <a
                  href={r.county.portals.buildingDept}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 rounded-md border border-black/10 bg-white text-sm hover:bg-black/5"
                >
                  {r.county.name} Building Dept →
                </a>
              )}
            </div>

            {/* AI observations - the actual comparison */}
            {vc?.performed && vc.observations.some((o) => o.severity !== 'flag') && (
              <div className="mt-6 space-y-3">
                <h3 className="font-semibold text-ink text-sm">
                  {vc.observations.some((o) => o.severity === 'flag') ? 'Also checked (changes are listed under What we found)' : 'What we checked'}
                </h3>
                {vc.observations.filter((o) => o.severity !== 'flag').map((o, i) => (
                  <ObservationCard key={i} obs={o} />
                ))}
              </div>
            )}

            {/* Fallback checklist if the model didn't run */}
            {!vc?.performed && r.thenVsNow.visualChecklist.length > 0 && (
              <div className="mt-6">
                <p className="text-sm text-ink-muted italic mb-3">
                  Automated comparison didn't run. Eyeball these yourself:
                </p>
                <div className="space-y-3">
                  {r.thenVsNow.visualChecklist.slice(0, 5).map((c, i) => (
                    <div
                      key={i}
                      className="border border-black/10 rounded-md p-4 bg-white"
                    >
                      <div className="text-sm font-semibold text-ink mb-1">
                        {c.item}
                      </div>
                      <p className="text-sm text-ink-soft leading-relaxed">
                        {c.whatToLookFor}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Property */}
        <section>
          <h2>Property</h2>
          <table>
            <tbody>
              <tr>
                <th style={{ width: '38%' }}>Owner</th>
                <td>{r.property.owner ?? '-'}</td>
              </tr>
              <tr>
                <th>Year built</th>
                <td>{fmtYear(r.property.yearBuilt)}</td>
              </tr>
              <tr>
                <th>Heated / total area</th>
                <td>
                  {fmtNum(r.property.heatedArea)} / {fmtNum(r.property.totalArea)} sq ft
                </td>
              </tr>
              <tr>
                <th>Lot size</th>
                <td>{fmtNum(r.property.lotSize)} sq ft</td>
              </tr>
              <tr>
                <th>Bedrooms / bathrooms</th>
                <td>
                  {fmtNum(r.property.bedrooms)} / {fmtNum(r.property.bathrooms)}
                </td>
              </tr>
              <tr>
                <th>Homestead</th>
                <td>{r.property.homesteadStatusText}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Permit history */}
        <section>
          <h2>Permit history</h2>
          <p>
            <strong>{r.permitHistory.totalSubjectPermits}</strong> permit(s) on file
            for this folio.{' '}
            <strong>{r.permitHistory.neighborPermitCount}</strong> permit(s) on
            neighboring parcels in the same block.
          </p>
          {/miami-dade/i.test(r.county?.name ?? '') && (
            <p className="text-sm text-ink-soft">
              Covers every county permit issued since 2020, plus any older permit that is still open or expired
              without a final inspection. Older closed permits are not published online; order the certified permit
              history to see them.
            </p>
          )}
          {r.permitHistory.subjectPermits.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>Process #</th>
                  <th>Type</th>
                  <th>Issued</th>
                  <th>Status</th>
                  <th>Scope</th>
                </tr>
              </thead>
              <tbody>
                {r.permitHistory.subjectPermits.map((p, i) => (
                  <tr key={i}>
                    <td>{p.processNumber ?? '-'}</td>
                    <td>{p.appType ?? '-'}</td>
                    <td>{p.issueDate ?? '-'}</td>
                    <td>{p.status ?? '-'}</td>
                    <td>{p.scope ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>
              <em>
                {r.county?.tier === 'A'
                  ? `No permits returned by the ${r.county.name} public permit endpoint.`
                  : r.county?.scraperNote ??
                    'No permit data was pulled automatically for this county. Use the portal links above for manual records review.'}
              </em>
            </p>
          )}
        </section>

        {/* Extra features */}
        {r.extraFeatures.length > 0 && (
          <section>
            <h2>Property Appraiser extra features</h2>
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Units</th>
                  <th>Year built</th>
                </tr>
              </thead>
              <tbody>
                {r.extraFeatures.map((f, i) => (
                  <tr key={i}>
                    <td>{f.description}</td>
                    <td>{fmtNum(f.units)}</td>
                    <td>{fmtYear(f.actualYearBuilt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Code enforcement - only shown when there's something to show */}
        {(r.codeEnforcement.openCases.length > 0 ||
          r.codeEnforcement.closedCases.length > 0) && (
          <section>
            <h2>Code enforcement</h2>
            <p>
              <strong>{r.codeEnforcement.openCount}</strong> open,{' '}
              <strong>{r.codeEnforcement.closedPast5yCount}</strong> closed (past 5y).
            </p>
            {r.codeEnforcement.openCases.length > 0 && (
              <>
                <h3>Open cases</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Case #</th>
                      <th>Date</th>
                      <th>Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.codeEnforcement.openCases.map((c, i) => (
                      <tr key={i}>
                        <td>{c.caseNumber}</td>
                        <td>{c.caseDate ?? '-'}</td>
                        <td>{c.problemDescription}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {r.codeEnforcement.closedCases.length > 0 && (
              <>
                <h3>Closed cases (past 5y)</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Case #</th>
                      <th>Date</th>
                      <th>Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.codeEnforcement.closedCases.map((c, i) => (
                      <tr key={i}>
                        <td>{c.caseNumber}</td>
                        <td>{c.caseDate ?? '-'}</td>
                        <td>{c.problemDescription}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>
        )}

        {/* Sales - only if we have any */}
        {r.sales.length > 0 && (
          <section>
            <h2>Sales history</h2>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Price</th>
                  <th>Qualification</th>
                </tr>
              </thead>
              <tbody>
                {r.sales.map((s, i) => (
                  <tr key={i}>
                    <td>{s.date ?? '-'}</td>
                    <td>{fmtMoney(s.price)}</td>
                    <td>{s.qualificationDescription ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Sourcing & confidence - transparency block (data already computed) */}
        {(r.confidenceAssessment.length > 0 ||
          r.dataSources.length > 0 ||
          r.dataLimitations.length > 0) && (
          <section>
            <h2>How we sourced this</h2>
            <p className="text-sm text-ink-soft leading-relaxed mb-3">
              Every line above is pulled from public records or read from imagery.
              Here is how confident we are in each part, where it came from, and what
              this report does not cover.
            </p>

            {r.confidenceAssessment.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>What</th>
                    <th>Confidence</th>
                    <th>Basis</th>
                  </tr>
                </thead>
                <tbody>
                  {r.confidenceAssessment.map((c, i) => (
                    <tr key={i}>
                      <td>{c.topic}</td>
                      <td>
                        <ConfidenceBadge grade={c.grade} />
                      </td>
                      <td>{c.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {r.dataSources.length > 0 && (
              <div className="mt-4">
                <h3 className="font-semibold text-ink text-sm mb-1">Sources pulled</h3>
                <ul>
                  {r.dataSources.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}

            {r.dataLimitations.length > 0 && (
              <div className="mt-4">
                <h3 className="font-semibold text-ink text-sm mb-1">
                  What this report does not cover
                </h3>
                <ul>
                  {dedupeLines(r.dataLimitations).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

            <p className="!mt-6 !text-xs !text-ink-muted">
              Live sources pulled{' '}
              {new Date(r.sourcesAsOf ?? r.generatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}. County records
              and imagery can lag real-world changes.
            </p>
          </div>
        </details>

        {/* Conversion - in-tool lead capture (emails office@palma.llc) */}
        <section>
          <LeadCapture
            address={r.property.siteAddress ?? r.query.address ?? ''}
            summary={[
              r.property.siteAddress || r.query.address,
              `${r.flags.strong.length} strong / ${r.flags.medium.length} medium flag(s)`,
              `${r.codeEnforcement.openCount} open code case(s)`,
              `${r.permitHistory.totalSubjectPermits} permit(s) on file`,
              role ? `Role: ${PERSONAS[role].short}` : '',
              r.readiness ? `Closing readiness ${r.readiness.score}/100 (${r.readiness.bandLabel})` : '',
              r.property.folio ? `Folio ${r.property.folio}` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        </section>

        <section>
          <p className="text-xs text-ink-muted italic">
            Records-level triage only - not legal advice, not a final compliance
            determination. Always verify with the AHJ before acting.
          </p>
        </section>
      </div>
    </article>
  );
}
