// Palm Beach County ePZB platform flow.
//
// Palm Beach does NOT run Accela. The registry used to point this county at
// aca-prod.accela.com/PBC/, which returns HTTP 404 - that agency code came from
// a commercial aggregator's coverage page and was never real. Verified 404 on
// 2026-11-09 for PBC, PBCGOV, PALMBEACH and PBCFL.
//
// What the county actually runs is ePZB, homegrown, with two FREE public
// searches that need no account and no sign-in, both keyed by PCN (Palm Beach's
// parcel number):
//
//   code cases : pbc.gov/iPZB.CodeCompliance.Service/search
//   permits    : pbc.gov/iPZB.Building/guest/searchpermits
//
// Those two cross-reference each other: a code case cites the permit number it
// is about, and the permit search on the same PCN returns that permit with its
// renewals and contractor changes. One parcel key reconstructs the property.
//
// JURISDICTION, and this is the whole correctness story for this adapter:
// ePZB covers UNINCORPORATED Palm Beach County only - 649,776 of the county's
// 1,492,191 people. For a property inside one of the 39 municipalities these
// searches return nothing, and nothing here does not mean clean. The county
// states the test itself: "Properties located in municipalities (with PCN's
// beginning with anything other than 00)". So a PCN that does not start with 00
// is a municipal parcel and we say so loudly instead of reporting an empty
// result. See isUnincorporatedPcn below.
//
// The county's certified Fine/Lien search is a paid manual service ($65, $97
// rush, 7-10 business days) and is not an API. The free tier prints a case
// status of "Fine" but never the dollar amount and never the lien recording -
// that is exactly what the $65 buys. We never infer an amount we cannot read.
//
// Portal mechanics worth knowing before editing selectors:
//   - The search pages are Angular. Assigning input.value from script does NOT
//     bind to the model and the form then fails its own validation, so every
//     field here is typed (pressSequentially) or set with selectOption, both of
//     which fire the events Angular listens for.
//   - The two PCN fields disagree: the code-compliance one auto-formats bare
//     digits, the permit one rejects them ("Please enter valid format for pcn").
//     We always send the dashed form to both.
//   - Case detail lives at /compliance with no query string, so it is not
//     deep-linkable; detail is reached by clicking a row and going back.

import type { ScrapeResult, ScrapedPermit, ScrapedViolation } from '../types.js';
import type { ScraperCtx } from './types.js';
import type { PbcJurisdiction } from './jurisdictions.js';
import { readTables, pickTable, colIndex, cell, debugDump } from './util.js';

const CODE_SEARCH_URL = 'https://pbc.gov/iPZB.CodeCompliance.Service/search';
const PERMIT_SEARCH_URL = 'https://pbc.gov/iPZB.Building/guest/searchpermits';

/** How many code cases to open for full detail (code sections + narrative). */
const DETAIL_LIMIT = Number(process.env.PBC_DETAIL_LIMIT ?? 8);

/** Case statuses that matter most to a buyer, enriched before the closed ones. */
const OPEN_STATUSES = ['fine', 'active', 'open', 'scheduled'];

// --- PCN handling -----------------------------------------------------------

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

// --- Angular-safe form driving ---------------------------------------------

/** Click one of the search-mode tabs ("PCN", "Situs Address", ...) by its label. */
async function selectTab(ctx: ScraperCtx, label: string): Promise<boolean> {
  const { page } = ctx;
  const tab = page.locator(`label:text-is("${label}")`).first();
  try {
    if (!(await tab.count())) return false;
    await tab.click({ timeout: 5000 });
    await page.waitForTimeout(400);
    return true;
  } catch {
    return false;
  }
}

/**
 * Type into a field so Angular's model actually updates. page.fill() replaces
 * the value in one shot; these forms want per-character events, so we clear and
 * then type. Returns true only if the field ended up holding what we sent.
 */
async function typeInto(ctx: ScraperCtx, selector: string, value: string): Promise<boolean> {
  const { page } = ctx;
  const el = page.locator(selector).first();
  try {
    if (!(await el.count())) return false;
    await el.click({ timeout: 5000 });
    await el.press('ControlOrMeta+a').catch(() => {});
    await el.press('Delete').catch(() => {});
    await el.pressSequentially(value, { delay: 15, timeout: 15000 });
    const got = (await el.inputValue().catch(() => '')) ?? '';
    return got.replace(/\D/g, '') === value.replace(/\D/g, '') || got.trim() === value.trim();
  } catch {
    return false;
  }
}

/** Submit the search and wait for the results region to settle. */
async function submitSearch(ctx: ScraperCtx): Promise<void> {
  const { page } = ctx;
  const btn = page.locator('button[type="submit"]:has-text("Search")').first();
  if (await btn.count()) {
    await btn.click({ timeout: 10000 }).catch(() => {});
  } else {
    await page.keyboard.press('Enter').catch(() => {});
  }
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

/**
 * Did the search actually run? We need to tell "zero records" (a real answer)
 * apart from "the form refused us" (not an answer). ePZB prints "Total Records:"
 * once a search has executed, and shows its own validation text when it has not.
 */
async function searchOutcome(ctx: ScraperCtx): Promise<'ran' | 'rejected' | 'unknown'> {
  const body = (await ctx.page.innerText('body').catch(() => '')) ?? '';
  if (/Total Records\s*:/i.test(body)) return 'ran';
  if (/please enter|please provide|valid format/i.test(body)) return 'rejected';
  return 'unknown';
}

// --- Code compliance --------------------------------------------------------

interface CodeRow {
  caseNo: string | null;
  violations: string | null;
  address: string | null;
  respondents: string | null;
  status: string | null;
}

function parseCodeRows(headers: string[], rows: string[][]): CodeRow[] {
  const iCase = colIndex(headers, ['case no', 'case']);
  const iViol = colIndex(headers, ['violation']);
  const iAddr = colIndex(headers, ['address']);
  const iResp = colIndex(headers, ['respondent']);
  const iStat = colIndex(headers, ['status']);
  return rows
    .map((r) => ({
      caseNo: cell(r, iCase),
      violations: cell(r, iViol),
      address: cell(r, iAddr),
      respondents: cell(r, iResp),
      status: cell(r, iStat),
    }))
    // Drop filter/footer rows: a real row always carries a C-YYYY-######## case number.
    .filter((r) => r.caseNo && /^C-\d{4}-\d+/i.test(r.caseNo));
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
 * Open one case, read its detail, and come back. This is the only way to reach
 * the cited code sections and the inspector's narrative, which are the most
 * useful fields Palm Beach publishes. The detail page is /compliance with no
 * query string, so it cannot be deep-linked; we click and go back.
 */
async function readCaseDetail(ctx: ScraperCtx, caseNo: string): Promise<CaseDetail | null> {
  const { page, log } = ctx;
  const link = page.locator(`a:text-is("${caseNo}")`).first();
  try {
    if (!(await link.count())) return null;
    await link.click({ timeout: 10000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    const text = (await page.innerText('body').catch(() => '')) ?? '';
    if (!/Compliance Detail/i.test(text)) return null;
    return parseCaseDetailText(text);
  } catch (e: any) {
    log(`pbc: case ${caseNo} detail unreadable (${e?.message ?? e})`);
    return null;
  } finally {
    await page.goBack({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
  }
}

async function scrapeCodeCases(
  ctx: ScraperCtx,
  pcn: string,
): Promise<{ ran: boolean; violations: ScrapedViolation[]; matchedAddress: string | null }> {
  const { page, log } = ctx;
  await page.goto(CODE_SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1200);

  if (!(await selectTab(ctx, 'PCN'))) {
    log('pbc/code: could not switch to the PCN tab');
    await debugDump(page, 'pbc-code-tabs', log);
    return { ran: false, violations: [], matchedAddress: null };
  }
  if (!(await typeInto(ctx, '#PCN', pcn))) {
    log('pbc/code: PCN field would not accept the value');
    await debugDump(page, 'pbc-code-form', log);
    return { ran: false, violations: [], matchedAddress: null };
  }
  await page.selectOption('#status', 'All').catch(() => {});
  await submitSearch(ctx);

  const outcome = await searchOutcome(ctx);
  if (outcome !== 'ran') {
    log(`pbc/code: search did not execute (${outcome})`);
    await debugDump(page, 'pbc-code-results', log);
    return { ran: false, violations: [], matchedAddress: null };
  }

  const table = pickTable(await readTables(page), ['case', 'violation', 'address', 'status']);
  const rows = table ? parseCodeRows(table.headers, table.rows) : [];
  log(`pbc/code: ${rows.length} case row(s) for ${pcn}`);

  // Enrich the cases a buyer actually cares about first.
  const ordered = [...rows].sort((a, b) => {
    const score = (s: string | null) => (s && OPEN_STATUSES.includes(s.toLowerCase()) ? 0 : 1);
    return score(a.status) - score(b.status);
  });

  const violations: ScrapedViolation[] = [];
  let matchedAddress: string | null = null;
  for (const r of ordered) {
    let d: CaseDetail | null = null;
    if (violations.length < DETAIL_LIMIT && r.caseNo) {
      d = await readCaseDetail(ctx, r.caseNo);
      if (d && !matchedAddress && d.pcn) matchedAddress = r.address;
    }
    violations.push({
      caseNumber: r.caseNo,
      status: r.status,
      openedDate: d?.openedDate ?? null,
      closedDate: null,
      description: r.violations,
      lastAction: d?.lastAction ?? null,
      codes: d?.codes.length ? d.codes : undefined,
      details: d?.details ?? null,
    });
  }
  return { ran: true, violations, matchedAddress: matchedAddress ?? rows[0]?.address ?? null };
}

// --- Permits ----------------------------------------------------------------

type PermitOutcome = { kind: 'ran'; permits: ScrapedPermit[] } | { kind: 'gated' } | { kind: 'failed' };

async function scrapePermits(ctx: ScraperCtx, pcn: string): Promise<PermitOutcome> {
  const { page, log } = ctx;
  await page.goto(PERMIT_SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);

  // The building app serves this page to an ordinary browser with no account,
  // but it bounces an automated one to the portal's login route and answers 401
  // on its own lookup endpoint. Detect that specific condition and report it
  // honestly rather than letting it look like a broken selector. We do not try
  // to defeat the check.
  if (/#\/login/i.test(page.url()) || !(await page.locator('#pcn, label:text-is("PCN")').count())) {
    log(`pbc/permits: building portal refused the automated session (url=${page.url()})`);
    return { kind: 'gated' };
  }

  if (!(await selectTab(ctx, 'PCN'))) {
    log('pbc/permits: could not switch to the PCN tab');
    await debugDump(page, 'pbc-permit-tabs', log);
    return { kind: 'failed' };
  }
  // This field rejects bare digits, unlike the code-compliance one.
  if (!(await typeInto(ctx, '#pcn', pcn))) {
    log('pbc/permits: PCN field would not accept the value');
    await debugDump(page, 'pbc-permit-form', log);
    return { kind: 'failed' };
  }
  await submitSearch(ctx);

  const outcome = await searchOutcome(ctx);
  if (outcome !== 'ran') {
    log(`pbc/permits: search did not execute (${outcome})`);
    await debugDump(page, 'pbc-permit-results', log);
    return { kind: 'failed' };
  }

  const table = pickTable(await readTables(page), ['permit', 'status', 'owner', 'address']);
  if (!table) return { kind: 'ran', permits: [] };

  const iNo = colIndex(table.headers, ['permit no']);
  const iDesc = colIndex(table.headers, ['permit desc', 'description']);
  const iOwner = colIndex(table.headers, ['owner']);
  const iCompany = colIndex(table.headers, ['company']);
  const iStatus = colIndex(table.headers, ['status']);
  const iBalance = colIndex(table.headers, ['balance']);

  const permits = table.rows
    .map((r) => ({
      permitNumber: cell(r, iNo),
      type: cell(r, iDesc),
      status: cell(r, iStatus),
      issuedDate: null,
      finaledDate: null,
      description: cell(r, iDesc),
      value: null,
      contractor: cell(r, iCompany) ?? cell(r, iOwner),
      balance: cell(r, iBalance),
    }))
    // The results table embeds its own filter row; real rows carry a permit number.
    .filter((p) => p.permitNumber && /^[A-Z]{1,3}-\d{4}-\d+/i.test(p.permitNumber));

  log(`pbc/permits: ${permits.length} permit row(s) for ${pcn}`);
  return { kind: 'ran', permits };
}

// --- Entry point ------------------------------------------------------------

export async function runPbcScrape(ctx: ScraperCtx, j: PbcJurisdiction): Promise<ScrapeResult> {
  const { log } = ctx;
  const result: ScrapeResult = {
    ok: false,
    county: j.county,
    matchedAddress: ctx.address,
    folio: ctx.folio,
    permits: [],
    violations: [],
    notes: [],
    portalLinks: j.portalLinks,
    source: j.source,
  };

  const pcn = normalizePcn(ctx.folio);
  if (!pcn) {
    // Address-only search is possible on both portals, but it resolves to a
    // parcel the user never confirmed, and a wrong parcel is worse than no
    // answer on a lien check. Say what we need instead of guessing.
    result.notes.push(
      ctx.folio
        ? `"${ctx.folio}" is not a Palm Beach parcel control number (a PCN is 17 digits, e.g. 00-41-43-10-00-000-4180). Look the PCN up on the Property Appraiser link below and re-run.`
        : 'Palm Beach records are keyed by parcel control number (PCN). Look the PCN up on the Property Appraiser link below and re-run with it.',
    );
    return result;
  }

  if (!isUnincorporatedPcn(pcn)) {
    // The single most important thing this adapter does: refuse to report an
    // empty county result as if it were a clean property.
    result.notes.push(
      `PCN ${pcn} is inside an incorporated Palm Beach municipality (county PCNs begin with 00). Palm Beach County's permit and code records cover unincorporated areas only, so the county has nothing to report for this parcel - that is NOT the same as the property being clear. Check the city's own building and code departments.`,
    );
    result.notes.push(
      'If this parcel was annexed by a municipality it may still carry older county history; the county notes that annexation dates matter.',
    );
    return result;
  }

  log(`pbc: searching unincorporated Palm Beach for PCN ${pcn}`);

  try {
    const r = await scrapePermits(ctx, pcn);
    if (r.kind === 'ran') {
      result.permits = r.permits;
      result.ok = true;
    } else if (r.kind === 'gated') {
      // Say exactly what happened. "No permits found" would be a lie here: we
      // were never allowed to look, and an empty permit list on a lien check is
      // the most dangerous wrong answer this product can give.
      result.notes.push(
        'Open permits were NOT checked. Palm Beach County publishes its permit search free and without an account, but it refuses automated sessions, and we do not work around that. Run it yourself with this PCN using the "PBC building permit search" link below - it takes about a minute. Treat the permit side of this report as unchecked, not as clear.',
      );
    } else {
      result.notes.push('Permit search: the county portal did not run our search this time - use the portal link to confirm.');
    }
  } catch (e: any) {
    log(`pbc permit error: ${e?.message ?? e}`);
    result.notes.push('Permit search could not be completed automatically this run.');
  }

  try {
    const r = await scrapeCodeCases(ctx, pcn);
    if (r.ran) {
      result.violations = r.violations;
      result.ok = true;
      if (r.matchedAddress) result.matchedAddress = r.matchedAddress;
    } else {
      result.notes.push('Code compliance search: the county portal did not run our search this time - use the portal link to confirm.');
    }
  } catch (e: any) {
    log(`pbc code error: ${e?.message ?? e}`);
    result.notes.push('Code compliance search could not be completed automatically this run.');
  }

  if (result.ok) {
    result.notes.push(
      'Covers unincorporated Palm Beach County only. Case status "Fine" means a fine was imposed; the county does not publish the amount or the lien recording in its free search - those come from its certified Fine/Lien search ($65, or $97 rush, 7-10 business days).',
    );
  } else {
    result.notes.unshift(
      'We could not read the Palm Beach County portal on this run. The links below go straight to the same free searches.',
    );
  }
  return result;
}
