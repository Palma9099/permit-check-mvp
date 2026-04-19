'use client';

import type { DiagnosticReport, Flag, ConfidenceRow } from '@/lib/types';

function badgeClass(g: ConfidenceRow['grade']): string {
  switch (g) {
    case 'high':
      return 'badge badge-ok';
    case 'medium':
      return 'badge badge-medium';
    case 'low':
      return 'badge badge-strong';
    case 'not_observed':
      return 'badge badge-weak';
  }
}

function fmtMoney(n: number | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return '$' + n.toLocaleString('en-US');
}

function fmtNum(n: number | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US');
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

export default function Report({ report }: { report: DiagnosticReport }) {
  const r = report;
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
          Folio {r.property.folio ?? '—'} · {r.ahj.name} ·{' '}
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
                <td>{fmtNum(r.property.yearBuilt)}</td>
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
                <th>DOR description</th>
                <td>{r.property.dorDescription ?? '—'}</td>
              </tr>
              <tr>
                <th>Zoning</th>
                <td>{r.property.zoning ?? '—'}</td>
              </tr>
              <tr>
                <th>Mailing matches site</th>
                <td>
                  {r.property.mailingMatchesSite === null
                    ? '—'
                    : r.property.mailingMatchesSite
                      ? 'Yes'
                      : `No — mailing: ${r.property.mailingAddress ?? '?'}`}
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
            <strong>{r.permitHistory.totalInspections}</strong> inspection record(s)
            matched this address.{' '}
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
              <em>No permits returned by the Miami-Dade BuildingPermit_gdb endpoint.</em>
            </p>
          )}
          {r.permitHistory.neighborByAddress.length > 0 && (
            <>
              <h3>Neighbor permit counts (same block)</h3>
              <table>
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>Permits</th>
                  </tr>
                </thead>
                <tbody>
                  {r.permitHistory.neighborByAddress.map((n, i) => (
                    <tr key={i}>
                      <td>{n.address}</td>
                      <td>{n.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        {/* Extra features */}
        {r.extraFeatures.length > 0 && (
          <section>
            <h2>Property Appraiser extra features</h2>
            <p>
              These are improvements the county itself dates and values. Compare
              the dates against the permit table above.
            </p>
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
                    <td>{fmtNum(f.actualYearBuilt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Code enforcement */}
        <section>
          <h2>Code enforcement</h2>
          <p>
            <strong>{r.codeEnforcement.openCount}</strong> open case(s),{' '}
            <strong>{r.codeEnforcement.closedPast5yCount}</strong> closed case(s)
            in the past 5 years.
          </p>
          {r.codeEnforcement.openCases.length > 0 && (
            <>
              <h3>Open cases</h3>
              <table>
                <thead>
                  <tr>
                    <th>Case #</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {r.codeEnforcement.openCases.map((c, i) => (
                    <tr key={i}>
                      <td>{c.caseNumber}</td>
                      <td>{c.caseDate ?? '—'}</td>
                      <td>{c.status}</td>
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
                    <th>Status</th>
                    <th>Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {r.codeEnforcement.closedCases.map((c, i) => (
                    <tr key={i}>
                      <td>{c.caseNumber}</td>
                      <td>{c.caseDate ?? '—'}</td>
                      <td>{c.status}</td>
                      <td>{c.problemDescription}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        {/* Sales */}
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

        {/* Confidence */}
        <section>
          <h2>Confidence</h2>
          <table>
            <thead>
              <tr>
                <th>Topic</th>
                <th>Grade</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {r.confidenceAssessment.map((c, i) => (
                <tr key={i}>
                  <td>{c.topic}</td>
                  <td>
                    <span className={badgeClass(c.grade)}>{c.grade.toUpperCase()}</span>
                  </td>
                  <td>{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Next steps */}
        <section>
          <h2>Recommended next steps</h2>
          <ul>
            {r.nextSteps.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>

        {/* Limitations */}
        <section>
          <h2>Data limitations</h2>
          <ul>
            {r.dataLimitations.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </section>

        {/* Sources */}
        <section>
          <h2>Sources</h2>
          <ul>
            {r.dataSources.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </section>
      </div>
    </article>
  );
}
