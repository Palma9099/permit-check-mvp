'use client';

import type { DiagnosticReport } from '@/lib/types';

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

function Card({ title, children, tone = 'grey' }: { title: string; children: React.ReactNode; tone?: 'grey' | 'amber' | 'green' | 'red' }) {
  const bar = { grey: 'bg-slate-400', amber: 'bg-amber-500', green: 'bg-emerald-600', red: 'bg-red-600' }[tone];
  return (
    <div className="relative overflow-hidden rounded-lg border border-black/10 bg-white p-4 pl-5">
      <div className={`absolute left-0 top-0 h-full w-1.5 ${bar}`} />
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1">{title}</div>
      {children}
    </div>
  );
}

// What a buyer or owner would otherwise have to dig out of four county sites.
export default function CountyExtrasSection({ report }: { report: DiagnosticReport }) {
  const x = report.countyExtras;
  if (!x) return null;
  const { tax, evacuation, sewer, permitHealth } = x;
  if (!tax && !evacuation && !sewer && !permitHealth) return null;

  return (
    <section>
      <h2>Money, safety and utilities</h2>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        {tax && (
          <Card title="Property tax after a sale" tone={tax.increase > tax.currentTaxable * 0.1 ? 'amber' : 'green'}>
            {tax.increase > 0 ? (
              <>
                <div className="font-serif text-2xl font-semibold text-amber-700">+{money(tax.increase)} taxable</div>
                <p className="!text-sm !leading-snug !mb-2">
                  Taxes today are based on {money(tax.currentTaxable)}. The county values the home at {money(tax.marketValue)}.
                  After a sale the cap resets, so the taxable value can jump to about {money(tax.afterSaleTaxable)}.
                </p>
                <p className="!text-sm !leading-snug !mb-0">
                  Rough extra cost: about <strong>{money(tax.estAnnualIncrease)} a year</strong> at a typical rate of
                  about {(tax.rateAssumed * 100).toFixed(1)}%. Your tax bill sets the exact amount.
                </p>
              </>
            ) : (
              <p className="!text-sm !leading-snug !mb-0">
                The taxed value is already close to the county&apos;s value of {money(tax.marketValue)}, so a sale should not
                raise taxes much.
              </p>
            )}
          </Card>
        )}

        {permitHealth && (
          <Card title="Permit status" tone={permitHealth.noInspection > 0 ? 'amber' : 'green'}>
            <div className="font-serif text-2xl font-semibold">
              {permitHealth.closedOut} closed out
              {permitHealth.inspectedNoCloseout > 0 ? `, ${permitHealth.inspectedNoCloseout} inspected` : ''}
              {permitHealth.noInspection > 0 ? `, ${permitHealth.noInspection} not inspected` : ''}
            </div>
            <ul className="!list-none !ml-0 mt-1 space-y-1">
              {permitHealth.items.slice(0, 4).map((p) => (
                <li key={p.permitNumber ?? p.issueDate ?? Math.random()} className="!mb-0 text-sm text-ink-soft">
                  {p.appType ?? 'Permit'} · {p.issueDate?.slice(0, 4) ?? '?'} · <span className="text-ink">{p.status}</span>
                </li>
              ))}
            </ul>
            <p className="!text-xs !text-ink-muted !mt-2 !mb-0">
              'Inspected' means the county logged an approved inspection but no close-out date. Ask the seller for the final paperwork.
            </p>
          </Card>
        )}

        {evacuation && (
          <Card title="Hurricane zone" tone="grey">
            <div className="font-serif text-2xl font-semibold">
              {evacuation.zone ? `Evacuation Zone ${evacuation.zone}` : 'No evacuation zone'}
            </div>
            <p className="!text-sm !leading-snug !mb-2">
              {evacuation.zone
                ? `The county orders people here out for a Category ${evacuation.category ?? '?'} storm or stronger.`
                : 'This address is outside the county evacuation zones.'}
            </p>
            {evacuation.hvhz && (
              <p className="!text-sm !leading-snug !mb-0">
                Miami-Dade is a High-Velocity Hurricane Zone. Roofs, windows and doors must carry Miami-Dade product
                approval, which matters for repairs and insurance.
              </p>
            )}
          </Card>
        )}

        {sewer && (
          <Card title="Sewer or septic" tone={sewer.septicOrWellFlag || !sewer.inServiceArea ? 'amber' : 'green'}>
            <div className="font-serif text-2xl font-semibold">
              {sewer.septicOrWellFlag ? 'Possibly septic or well' : sewer.inServiceArea ? 'County sewer area' : 'Outside county sewer'}
            </div>
            <p className="!text-sm !leading-snug !mb-0">{sewer.summary}</p>
          </Card>
        )}

        {x.replacementCostNew && (
          <Card title="Rebuild cost (county estimate)" tone="grey">
            <div className="font-serif text-2xl font-semibold">{money(x.replacementCostNew)}</div>
            <p className="!text-sm !leading-snug !mb-0">
              The property appraiser&apos;s cost to replace the structure new. A useful starting point when you price
              homeowners insurance. Not an insurance quote.
            </p>
          </Card>
        )}
      </div>
      <p className="!text-xs !text-ink-muted mt-2">
        Sources: {x.sources.join('; ')}.
      </p>
    </section>
  );
}
