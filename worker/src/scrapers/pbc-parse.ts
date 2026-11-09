// Palm Beach ePZB: the parts that are pure functions over text.
//
// Split out of pbc.ts so the repo-root tests can import them WITHOUT dragging
// playwright into the Next.js build's TypeScript program. The root tsconfig
// already excludes `worker` for that reason, but exclude only filters the
// initial file set - TypeScript still follows imports across the boundary, and
// Vercel installs root dependencies only, so a root test that reached a
// playwright-typed module failed the deploy with TS2307 while passing locally
// (where worker/node_modules happens to resolve it).
//
// Nothing in this file may import playwright, or anything that does.

/**
 * Normalize a Palm Beach PCN to the dashed form both portals accept.
 * 17 digits grouped 2-2-2-2-2-3-4, e.g. 00-41-43-10-00-000-4180.
 * Returns null when the input is not a PBC PCN (wrong length, or a Broward or
 * Miami-Dade folio that happened to land in the folio field).
 */
export function normalizePcn(raw: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  if (d.length !== 17) return null;
  return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}-${d.slice(8, 10)}-${d.slice(10, 13)}-${d.slice(13)}`;
}

/**
 * True when the PCN belongs to unincorporated Palm Beach County, which is the
 * only area ePZB holds records for. Per the county's Search Services page:
 * "Properties located in municipalities (with PCN's beginning with anything
 * other than 00)". The same page warns that a parcel annexed by a municipality
 * can still carry county history, so callers treat a false here as "the county
 * is probably not the authority", never as proof of anything.
 */
export function isUnincorporatedPcn(pcn: string): boolean {
  return pcn.replace(/\D/g, '').startsWith('00');
}

export interface CaseDetail {
  codes: string[];
  details: string | null;
  pcn: string | null;
  owner: string | null;
  zoning: string | null;
  openedDate: string | null;
  lastAction: string | null;
}

/**
 * Parse an ePZB case-detail page from its rendered text.
 *
 * This runs in Node, not in page.evaluate, on purpose. tsx compiles with
 * esbuild's keepNames, which wraps functions in a __name() helper; that helper
 * does not exist in the browser context, so any non-trivial function shipped
 * into page.evaluate dies with "__name is not defined". Pulling the text out
 * and parsing here sidesteps the whole class of problem and makes the parser
 * unit-testable without a browser.
 *
 * The page is label-above-value:
 *     PCN
 *     00-41-43-10-00-000-4180
 * and each violation block carries "<date> | <name>", a Details narrative, a
 * Codes list, and a closing "<date> | <comment>".
 */
export function parseCaseDetailText(text: string): CaseDetail {
  const lines = text.split('\n').map((l) => l.trim());

  const after = (label: string): string | null => {
    const i = lines.findIndex((l) => l.toLowerCase() === label.toLowerCase());
    const v = i >= 0 ? lines[i + 1] : null;
    return v && v.length ? v : null;
  };

  // "PBCAFBC20-105.1: PBC Amendments to FBC 7th Edition (2020)"
  // "PBCPMC-Section 14-35 (a): Palm Beach County Property Maintenance Code"
  const codes = Array.from(
    new Set(lines.filter((l) => /^[A-Z][A-Z0-9]*-[^:]{2,60}:\s+\S/.test(l))),
  );

  const details = lines.filter((l) => /More specifically/i.test(l)).join(' ') || null;

  // Violation rows read "<m/d/yyyy> | <text>". The earliest is when the case
  // opened; the last one that reads like a resolution is the latest action.
  const dated = lines
    .map((l) => l.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s*\|\s*(.+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ date: m[1], text: m[2].trim() }));

  const ts = (d: string) => new Date(d).getTime();
  const openedDate = dated.length
    ? dated.reduce((a, b) => (ts(a.date) <= ts(b.date) ? a : b)).date
    : null;
  const closing = dated.filter((d) => /obtained|complied|cited in error|no violation|closed|removed/i.test(d.text));
  const lastAction = closing.length ? closing[closing.length - 1].text : null;

  return {
    codes,
    details,
    pcn: after('PCN'),
    owner: after('Owner'),
    zoning: after('Zoning'),
    openedDate,
    lastAction,
  };
}

/**
 * The decision to refuse a search, kept pure so it is tested in the fast suite
 * rather than only through a browser.
 *
 * Returns the notes to report and nothing else when we must NOT search, or null
 * when the PCN is good and the county is the right authority. Refusing well is
 * most of this adapter's value: an empty result from the wrong government reads
 * exactly like a clean property, and that is the one mistake this product
 * cannot make.
 */
export function pcnRefusal(folio: string | null): { notes: string[] } | null {
  const pcn = normalizePcn(folio);
  if (!pcn) {
    return {
      notes: [
        folio
          ? `"${folio}" is not a Palm Beach parcel control number (a PCN is 17 digits, e.g. 00-41-43-10-00-000-4180). Look the PCN up on the Property Appraiser link below and re-run.`
          : 'Palm Beach records are keyed by parcel control number (PCN). Look the PCN up on the Property Appraiser link below and re-run with it.',
      ],
    };
  }
  if (!isUnincorporatedPcn(pcn)) {
    return {
      notes: [
        `PCN ${pcn} is inside an incorporated Palm Beach municipality (county PCNs begin with 00). Palm Beach County's permit and code records cover unincorporated areas only, so the county has nothing to report for this parcel - that is NOT the same as the property being clear. Check the city's own building and code departments.`,
        'If this parcel was annexed by a municipality it may still carry older county history; the county notes that annexation dates matter.',
      ],
    };
  }
  return null;
}
