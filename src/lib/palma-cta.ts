/**
 * Palma quote deep-link (conversion layer).
 *
 * The Permit History Check is a free diagnostic. When it surfaces a problem
 * (open code cases, strong flags, likely unpermitted work), we hand the user
 * off to Palma's Start-a-Project intake with the address and a short findings
 * summary already carried over, so they can request a quote in one click.
 *
 * The intake reads these query params and pre-fills itself. Param contract:
 *   address  the property address
 *   findings a short, human-readable summary of what the check flagged
 *   source   attribution slug (always "permit-history-check" here)
 *   service  the intake service card to preselect
 *
 * Framing stays coordination-safe: Palma coordinates licensed professionals,
 * it does not itself certify compliance, and nothing here guarantees an outcome.
 */

import type { DiagnosticReport } from './types';

const PALMA_APP_URL =
  process.env.NEXT_PUBLIC_PALMA_APP_URL || 'https://app.palma.llc';

/** Build a one-line findings summary from the report, capped for a clean URL. */
export function summarizeFindings(r: DiagnosticReport): string {
  const parts: string[] = [];

  const strong = r.flags?.strong ?? [];
  const medium = r.flags?.medium ?? [];
  if (strong.length > 0) {
    parts.push(`${strong.length} strong flag(s): ${strong.map((f) => f.title).join(', ')}`);
  } else if (medium.length > 0) {
    parts.push(`${medium.length} flag(s): ${medium.map((f) => f.title).join(', ')}`);
  }

  const openCount = r.codeEnforcement?.openCount ?? 0;
  if (openCount > 0) {
    parts.push(`${openCount} open code enforcement case(s)`);
  }

  let summary = parts.join('; ');
  // Keep the URL sane; the full report is the source of truth.
  if (summary.length > 220) summary = summary.slice(0, 217) + '...';
  return summary;
}

/** True when the check found something worth resolving (drives CTA display). */
export function hasActionableFindings(r: DiagnosticReport): boolean {
  return (
    (r.flags?.strong?.length ?? 0) > 0 ||
    (r.flags?.medium?.length ?? 0) > 0 ||
    (r.codeEnforcement?.openCount ?? 0) > 0
  );
}

/** Build the deep link into Palma's Start-a-Project intake. */
export function buildPalmaQuoteUrl(r: DiagnosticReport): string {
  const address = r.property?.siteAddress ?? r.query?.address ?? '';
  const findings = summarizeFindings(r);

  // Open cases or strong flags point to violation resolution; otherwise let the
  // intake fall back to its own per-source default.
  const service =
    (r.codeEnforcement?.openCount ?? 0) > 0 || (r.flags?.strong?.length ?? 0) > 0
      ? 'code_violation_help'
      : '';

  const params = new URLSearchParams();
  if (address) params.set('address', address);
  if (findings) params.set('findings', findings);
  params.set('source', 'permit-history-check');
  if (service) params.set('service', service);

  return `${PALMA_APP_URL}/?${params.toString()}`;
}
