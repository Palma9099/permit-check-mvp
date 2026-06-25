// Turn a ScrapeResult into a clean HTML + plain-text email.

import type { ScrapeResult, ScrapedPermit, ScrapedViolation } from './types.js';

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
}

const COUNTY_LABEL: Record<string, string> = {
  'miami-dade': 'Miami-Dade County',
  'broward': 'Broward County',
  'palm-beach': 'Palm Beach County',
};

function permitRows(permits: ScrapedPermit[]): string {
  if (permits.length === 0) return '<tr><td colspan="5" style="padding:8px;color:#888">No permits found in the portal for this property.</td></tr>';
  return permits
    .map(
      (p) => `<tr>
        <td style="padding:6px 8px;border-top:1px solid #eee">${esc(p.permitNumber) || '—'}</td>
        <td style="padding:6px 8px;border-top:1px solid #eee">${esc(p.type) || '—'}</td>
        <td style="padding:6px 8px;border-top:1px solid #eee">${esc(p.status) || '—'}</td>
        <td style="padding:6px 8px;border-top:1px solid #eee">${esc(p.issuedDate) || '—'}</td>
        <td style="padding:6px 8px;border-top:1px solid #eee">${esc(p.description) || '—'}</td>
      </tr>`,
    )
    .join('');
}

function violationRows(v: ScrapedViolation[]): string {
  if (v.length === 0) return '<tr><td colspan="4" style="padding:8px;color:#888">No code-enforcement cases found in the portal for this property.</td></tr>';
  return v
    .map(
      (c) => `<tr>
        <td style="padding:6px 8px;border-top:1px solid #eee">${esc(c.caseNumber) || '—'}</td>
        <td style="padding:6px 8px;border-top:1px solid #eee">${esc(c.status) || '—'}</td>
        <td style="padding:6px 8px;border-top:1px solid #eee">${esc(c.openedDate) || '—'}</td>
        <td style="padding:6px 8px;border-top:1px solid #eee">${esc(c.description) || '—'}</td>
      </tr>`,
    )
    .join('');
}

export function buildEmail(result: ScrapeResult, requestedAddress: string | null): {
  subject: string;
  html: string;
  text: string;
} {
  const countyName = COUNTY_LABEL[result.county] ?? result.county ?? 'Florida';
  const title = result.matchedAddress || requestedAddress || result.folio || 'your property';
  const subject = `Permit & violation history — ${title}`;

  const links = result.portalLinks
    .map((l) => `<a href="${esc(l.url)}" style="color:#1f3864">${esc(l.label)}</a>`)
    .join(' &nbsp;·&nbsp; ');

  const notes = result.notes.length
    ? `<ul style="margin:8px 0 0;padding-left:18px;color:#444;font-size:13px">${result.notes
        .map((n) => `<li>${esc(n)}</li>`)
        .join('')}</ul>`
    : '';

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:auto;color:#111">
    <h2 style="font-size:20px;margin:0 0 4px">Deep permit &amp; violation scan</h2>
    <div style="color:#555;font-size:13px;margin-bottom:16px">
      ${esc(title)} · ${esc(countyName)} · pulled ${esc(new Date().toLocaleString('en-US'))}
    </div>

    ${
      result.ok
        ? ''
        : `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px;margin-bottom:16px;font-size:14px;color:#9a3412">
            We couldn't fully read the county portal for this property automatically this time. The portal links below take you straight to the records. ${notes}
          </div>`
    }

    <h3 style="font-size:15px;margin:18px 0 6px">Permits (${result.permits.length})</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <thead><tr style="text-align:left;background:#f6f6f6">
        <th style="padding:6px 8px">Permit #</th><th style="padding:6px 8px">Type</th>
        <th style="padding:6px 8px">Status</th><th style="padding:6px 8px">Issued</th>
        <th style="padding:6px 8px">Description</th>
      </tr></thead>
      <tbody>${permitRows(result.permits)}</tbody>
    </table>

    <h3 style="font-size:15px;margin:18px 0 6px">Code-enforcement cases (${result.violations.length})</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <thead><tr style="text-align:left;background:#f6f6f6">
        <th style="padding:6px 8px">Case #</th><th style="padding:6px 8px">Status</th>
        <th style="padding:6px 8px">Opened</th><th style="padding:6px 8px">Description</th>
      </tr></thead>
      <tbody>${violationRows(result.violations)}</tbody>
    </table>

    ${result.ok && notes ? `<div style="margin-top:14px">${notes}</div>` : ''}

    <div style="margin-top:18px;font-size:13px;color:#333">Verify directly: ${links}</div>

    <hr style="margin:22px 0;border:none;border-top:1px solid #eee" />
    <div style="font-size:12px;color:#888">
      Source: ${esc(result.source)}. Records-level triage only — not legal advice or a final
      compliance determination. Always verify with the AHJ before acting.
      Need it fixed? Reply to this email or visit
      <a href="https://palma.llc/#contact" style="color:#1f3864">palma.llc</a>.
    </div>
  </div>`;

  const text =
    `Deep permit & violation scan\n${title} · ${countyName}\n\n` +
    `Permits (${result.permits.length}):\n` +
    (result.permits.length
      ? result.permits.map((p) => `  - ${p.permitNumber ?? '—'} | ${p.type ?? ''} | ${p.status ?? ''} | ${p.issuedDate ?? ''}`).join('\n')
      : '  none found') +
    `\n\nCode-enforcement cases (${result.violations.length}):\n` +
    (result.violations.length
      ? result.violations.map((c) => `  - ${c.caseNumber ?? '—'} | ${c.status ?? ''} | ${c.openedDate ?? ''}`).join('\n')
      : '  none found') +
    `\n\nPortals: ${result.portalLinks.map((l) => l.url).join('  ')}\n` +
    `Source: ${result.source}. Not legal advice — verify with the AHJ.`;

  return { subject, html, text };
}
