'use client';

import type { DiagnosticReport, Flag, VisionObservation } from '@/lib/types';

function fmtMoney(n: number | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return '$' + n.toLocaleString('en-US');
}

function fmtNum(n: number | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US');
}

function fmtYear(n: number | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return String(Math.trunc(n));
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

export default function Report({ report }: { report: DiagnosticReport }) {
  const r = report;
  const vc = r.thenVsNow?.visualComparison;
  return (
    <article className="bg-card shadow-card rounded-lg border border-black/5 overflow-hidden">
      {/* Cover */}
      <div className="px-6 sm:px-10 py-8 bg-gradient-to-br from-[#1f3864] to-[#102447] text-white">
        <div className="text-xs uppercase tracking-[0.18em] text-white/70 mb-2">
          Diagnostic Report
        </div>
        <h2 className="font-serif text-3xl sm:text-4xl font-semibold leading-tight">
          {r.property.siteAddress ?? r.query.address}
        </h2>
        <div className="mt-2 text-white/80 text-sm">
          {r.property.folio ? `Folio ${r.property.folio} · ` : ''}
          {r.county?.name ?? r.ahj?.name ?? 'Florida'}
          {r.county?.tier ? ` (Tier ${r.county.tier})` : ''} ·{' '}
          {new Date(r.generatedAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </div>

        <div className="mt-6 bg-white/10 border border-white/20 rounded-md p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-white/80 mb-2">
            Bottom line
          </div>
          <ul className="space-y-1.5 text-sm text-white/95">
            {r.bottomLine.map((line, i) => (
              <li key={i}>· {line}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="px-6 sm:px-10 py-8 prose-section">
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

        {/* Visual review */}
        {r.thenVsNow && r.thenVsNow.coordinates && (
          <section>
            <h2>Visual review</h2>

            {vc?.performed ? (
              <p className="italic text-ink-soft">{vc.summary}</p>
            ) : (
              <p>
                Records tell half the story. Use the imagery below to compare the
                subject to its neighbors and spot anything the permit record doesn't
                explain.
              </p>
            )}

            {/* Then vs Now — historical NAIP (THEN) paired with current Google
                satellite (NOW) for maximum visual sharpness. NAIP is 1m
                native for older years and looks pixelated when upsampled;
                Google Static Maps at zoom 20 is sub-meter and crisp. The AI
                still receives both NAIP frames internally for like-for-like
                change detection — this is just for the human reader. */}
            {r.thenVsNow.historicalAerials?.then && r.thenVsNow.satelliteImageUrl && (
              <div className="mt-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
                  Then vs Now — aerial comparison
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-ink-muted mb-1">
                      Then · {r.thenVsNow.historicalAerials.then.captureDate.slice(0, 10)} · USDA NAIP
                    </div>
                    <img
                      src={r.thenVsNow.historicalAerials.then.imageUrl}
                      alt={`Historical NAIP aerial, ${r.thenVsNow.historicalAerials.then.captureYear}`}
                      className="w-full rounded-md border border-black/10"
                      loading="lazy"
                    />
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-ink-muted mb-1">
                      Now · current · Google satellite
                    </div>
                    <img
                      src={r.thenVsNow.satelliteImageUrl}
                      alt="Current Google satellite view"
                      className="w-full rounded-md border border-black/10"
                      loading="lazy"
                    />
                  </div>
                </div>
                {r.thenVsNow.historicalAerials.allFrames.length > 2 && (
                  <p className="text-[11px] text-ink-muted mt-2">
                    {r.thenVsNow.historicalAerials.allFrames.length} total NAIP captures
                    available for this parcel ({r.thenVsNow.historicalAerials.allFrames[0].captureYear}
                    {' '}through{' '}
                    {r.thenVsNow.historicalAerials.allFrames[r.thenVsNow.historicalAerials.allFrames.length - 1].captureYear}
                    ). The AI compared the earliest NAIP against the latest plus current Google imagery.
                  </p>
                )}
              </div>
            )}
            {r.thenVsNow.historicalAerials && !r.thenVsNow.historicalAerials.then && r.thenVsNow.historicalAerials.failureReason && (
              <p className="text-xs text-ink-muted italic mt-3">
                Historical aerial unavailable: {r.thenVsNow.historicalAerials.failureReason}
              </p>
            )}

            {/* Block context — subject vs neighbors. The tight subject frame
                with the red polygon is already shown above as "Now"; we drop
                the standalone subject image here to avoid duplicating it. */}
            {r.thenVsNow.contextSatelliteImageUrl && (
              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
                  Block context — subject vs. neighbors
                </div>
                <img
                  src={r.thenVsNow.contextSatelliteImageUrl}
                  alt="Wider block context with parcel polygon overlay"
                  className="w-full md:w-1/2 rounded-md border border-black/10"
                  loading="lazy"
                />
              </div>
            )}

            {/* Street View — Then vs Now (Mapillary), one row per fronting
                street so corner lots show all sides. */}
            {(() => {
              const sides = r.thenVsNow.historicalStreetView?.sides ?? [];
              const usableSides = sides.filter((s) => s.then && s.now);
              if (usableSides.length === 0) return null;
              return (
                <div className="mt-5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
                    Then vs Now — Street View
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
                            Then · {side.then!.captureDate.slice(0, 10)}
                          </div>
                          <img
                            src={side.then!.imageUrl}
                            alt={`Mapillary Street View, ${side.then!.captureYear}`}
                            className="w-full rounded-md border border-black/10"
                            loading="lazy"
                          />
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-ink-muted mb-1">
                            Now · {side.now!.captureDate.slice(0, 10)}
                          </div>
                          <img
                            src={side.now!.imageUrl}
                            alt={`Latest Mapillary Street View, ${side.now!.captureYear}`}
                            className="w-full rounded-md border border-black/10"
                            loading="lazy"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  <p className="text-[11px] text-ink-muted mt-2">
                    Compare facade paint, front door, gates, garage door, windows on each side.
                  </p>
                </div>
              );
            })()}
            {r.thenVsNow.historicalStreetView && !r.thenVsNow.historicalStreetView.then && r.thenVsNow.historicalStreetView.failureReason && (
              <p className="text-xs text-ink-muted italic mt-3">
                Historical Street View unavailable: {r.thenVsNow.historicalStreetView.failureReason}
              </p>
            )}

            {/* Current Street View (Google, heading-aware) */}
            {r.thenVsNow.streetViewImages && r.thenVsNow.streetViewImages.length > 0 && (
              <div className="mt-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
                  Street View — front of subject (current)
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
                marks the subject property — anything outside it is a neighbor and is
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

            {/* AI observations — the actual comparison */}
            {vc?.performed && vc.observations.length > 0 && (
              <div className="mt-6 space-y-3">
                {vc.observations.map((o, i) => (
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
                <td>{r.property.owner ?? '—'}</td>
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
                    <td>{p.processNumber ?? '—'}</td>
                    <td>{p.appType ?? '—'}</td>
                    <td>{p.issueDate ?? '—'}</td>
                    <td>{p.status ?? '—'}</td>
                    <td>{p.scope ?? '—'}</td>
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

        {/* Code enforcement — only shown when there's something to show */}
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
                        <td>{c.caseDate ?? '—'}</td>
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
                        <td>{c.caseDate ?? '—'}</td>
                        <td>{c.problemDescription}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>
        )}

        {/* Sales — only if we have any */}
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
                    <td>{s.date ?? '—'}</td>
                    <td>{fmtMoney(s.price)}</td>
                    <td>{s.qualificationDescription ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Next steps — short list */}
        <section>
          <h2>Next steps</h2>
          <ul>
            {r.nextSteps.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>

        <section>
          <p className="text-xs text-ink-muted italic">
            Records-level triage only — not legal advice, not a final compliance
            determination. Always verify with the AHJ before acting.
          </p>
        </section>
      </div>
    </article>
  );
}
