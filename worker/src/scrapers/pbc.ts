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
import { normalizePcn, isUnincorporatedPcn, parseCaseDetailText, pcnRefusal, readMatchesReport, shortfallNote, type CaseDetail } from './pbc-parse.js';

export { normalizePcn, isUnincorporatedPcn, parseCaseDetailText, pcnRefusal, type CaseDetail };

const CODE_SEARCH_URL = 'https://pbc.gov/iPZB.CodeCompliance.Service/search';
const PERMIT_SEARCH_URL = 'https://pbc.gov/iPZB.Building/guest/searchpermits';

/** How many code cases to open for full detail (code sections + narrative). */
const DETAIL_LIMIT = Number(process.env.PBC_DETAIL_LIMIT ?? 8);

/** Case statuses that matter most to a buyer, enriched before the closed ones. */
const OPEN_STATUSES = ['fine', 'active', 'open', 'scheduled'];

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
interface SearchOutcome {
  kind: 'ran' | 'rejected' | 'unknown';
  /**
   * The number ePZB printed after "Total Records:", or null when it printed a
   * label with no readable number.
   *
   * Reading the LABEL alone was not enough. "Total Records: 7" beside a table
   * our selectors no longer recognise produced ok=true with zero cases, so a
   * property with seven records printed as clean. The count is the portal
   * telling us how many rows should exist; reconciling it against the rows we
   * actually parsed is what turns a silent parse failure into a refusal.
   */
  reported: number | null;
}

async function searchOutcome(ctx: ScraperCtx): Promise<SearchOutcome> {
  const body = (await ctx.page.innerText('body').catch(() => '')) ?? '';
  const m = body.match(/Total Records\s*:\s*([\d,]+)/i);
  if (m) {
    const n = Number(m[1].replace(/,/g, ''));
    return { kind: 'ran', reported: Number.isFinite(n) ? n : null };
  }
  if (/Total Records\s*:/i.test(body)) return { kind: 'ran', reported: null };
  if (/please enter|please provide|valid format/i.test(body)) return { kind: 'rejected', reported: null };
  return { kind: 'unknown', reported: null };
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
): Promise<{ ran: boolean; violations: ScrapedViolation[]; matchedAddress: string | null; refusal?: string }> {
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
  if (outcome.kind !== 'ran') {
    log(`pbc/code: search did not execute (${outcome.kind})`);
    await debugDump(page, 'pbc-code-results', log);
    return { ran: false, violations: [], matchedAddress: null };
  }

  const table = pickTable(await readTables(page), ['case', 'violation', 'address', 'status']);
  const rows = table ? parseCodeRows(table.headers, table.rows) : [];
  log(`pbc/code: ${rows.length} case row(s) for ${pcn} (portal reported ${outcome.reported ?? 'no count'})`);

  // Reconcile what the portal says it holds against what we read. Reading
  // fewer rows than the portal reports means our parse lost records, and
  // publishing that as the property's case list understates it. Refuse.
  if (!readMatchesReport(rows.length, outcome.reported)) {
    log(`pbc/code: read ${rows.length} of ${outcome.reported} reported rows - refusing to report a partial set as complete`);
    await debugDump(page, 'pbc-code-shortfall', log);
    return {
      ran: false,
      violations: [],
      matchedAddress: null,
      refusal: shortfallNote(rows.length, outcome.reported as number, 'code compliance cases'),
    };
  }

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
  if (outcome.kind !== 'ran') {
    log(`pbc/permits: search did not execute (${outcome.kind})`);
    await debugDump(page, 'pbc-permit-results', log);
    return { kind: 'failed' };
  }

  const table = pickTable(await readTables(page), ['permit', 'status', 'owner', 'address']);
  // Same reconciliation as the code side: a positive reported count with no
  // table we recognise is a parse failure, not an empty permit history.
  if (!readMatchesReport(table ? table.rows.length : 0, outcome.reported)) {
    log(`pbc/permits: portal reported ${outcome.reported} rows, read ${table ? table.rows.length : 0} - treating as a failed read`);
    await debugDump(page, 'pbc-permit-shortfall', log);
    return { kind: 'failed' };
  }
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

  // One pure decision covers both "that is not a PCN" and "the county is not
  // the authority here"; see pcnRefusal in pbc-parse.ts.
  const refusal = pcnRefusal(ctx.folio);
  if (refusal) {
    result.notes.push(...refusal.notes);
    return result;
  }
  const pcn = normalizePcn(ctx.folio)!;

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
      result.notes.push(
        r.refusal ??
          'Code compliance search: the county portal did not run our search this time - use the portal link to confirm.',
      );
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
