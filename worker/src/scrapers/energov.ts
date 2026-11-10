// Tyler EnerGov Citizen Self Service platform flow.
//
// One flow, many jurisdictions: EnerGov CSS serves Hialeah, St Lucie County,
// Marion, Okaloosa and several Palm Beach cities from the same application on
// tylerhost.net, so only the host and the tenant's module set change.
//
//   search page  https://<tenant>.tylerhost.net/apps/selfservice#/search
//
// Flow: open the search page, confirm the tenant exposes module 5 (Code Case),
// set it, type the address, submit, and read the rows.
//
// HOW THE ROWS ARE READ. The page's own search is an XHR to
// api/energov/search/search, and this adapter listens for that response rather
// than scraping the rendered grid. That is a deliberate choice, not a
// shortcut: the grid is virtualised and in several tenants renders nothing
// until a category filter is clicked, so DOM scraping produced empty results
// for addresses that genuinely had cases. Listening to the response the
// browser already received while we drive the page normally is both the
// honest reading of what the portal returned and far more stable. This adapter
// never calls that endpoint itself.
//
// WHY module 5 is checked every run. It is per-tenant configuration and the
// two Florida tenants tested disagree: Hialeah has Code Case enabled, St Lucie
// County has it removed. Assuming it exists would mean searching nothing and
// reporting a clean property, which is the failure this whole area exists to
// prevent - a Hialeah property with a recorded lien was reported "None open"
// because only the county was searched.

import type { ScrapeResult, ScrapedViolation } from '../types.js';
import type { ScraperCtx } from './types.js';
import type { EnergovJurisdiction } from './jurisdictions.js';
import { debugDump } from './util.js';
import {
  MODULE,
  moduleIdsFrom,
  hasCodeModule,
  parseSearchResponse,
  isEncumbering,
  noCodeModuleNote,
  coverageNote,
  truncationNote,
  searchUrl,
  AMOUNT_NOTE,
  type EnergovCase,
} from './energov-parse.js';

export {
  MODULE,
  moduleIdsFrom,
  hasCodeModule,
  parseSearchResponse,
  isEncumbering,
  noCodeModuleNote,
  coverageNote,
  truncationNote,
  searchUrl,
  AMOUNT_NOTE,
  type EnergovCase,
};

const SEARCH_API = /\/api\/energov\/search\/search\b/i;

/** Read the module ids the tenant actually exposes, live. */
async function liveModules(ctx: ScraperCtx): Promise<number[]> {
  const values = await ctx.page
    .$$eval('#SearchModule option', (opts) => opts.map((o) => (o as HTMLOptionElement).value))
    .catch(() => [] as string[]);
  return moduleIdsFrom(values as string[]);
}

/**
 * Run one code-case search and return what the portal's own XHR answered.
 *
 * The listener is armed BEFORE the click, because the response can arrive
 * before any DOM change and would otherwise be missed.
 */
/**
 * One attempt. Returns null when the portal answered but refused to work -
 * `{"Result":null,"Success":false}` with an HTTP 200 - which it does
 * intermittently, most often on the first search after a cold page load.
 * Measured on Hialeah: roughly one run in three. That is the portal's own
 * flakiness, not ours, so the caller retries rather than reporting a property
 * unreadable because Tyler hiccuped.
 */
async function attemptSearch(
  ctx: ScraperCtx,
  address: string,
): Promise<{ ran: boolean; cases: EnergovCase[]; reported: number } | null> {
  const { page, log } = ctx;

  await page.selectOption('#SearchModule', { value: `number:${MODULE.CodeCase}` }).catch(async () => {
    // Some builds label the option value plainly.
    await page.selectOption('#SearchModule', String(MODULE.CodeCase)).catch(() => {});
  });
  await page.fill('#SearchKeyword', address, { timeout: 10000 });

  // The keyword box has an autocomplete that can swallow the first Enter, so
  // dismiss it and use the button.
  await page.keyboard.press('Escape').catch(() => {});

  // Match OUR search, not just any search.
  //
  // The app fires its own POST to the same endpoint while the page settles, so
  // a predicate of "first POST to search/search" is a race: roughly half the
  // runs caught the app's empty startup search instead of ours and reported a
  // property with a recorded lien as unreadable. Check the request payload
  // carries the address we typed.
  const needle = address.replace(/\s+/g, ' ').trim().toLowerCase();
  const answer = page
    .waitForResponse(
      (r) => {
        if (!SEARCH_API.test(r.url()) || r.request().method() !== 'POST') return false;
        const sent = (r.request().postData() ?? '').toLowerCase();
        return sent.includes(needle);
      },
      { timeout: 30000 },
    )
    .catch(() => null);

  const button = page.locator('#button-Search');
  if (await button.count()) {
    await button.click({ timeout: 10000 }).catch(() => {});
  } else {
    await page.locator('button:has-text("Search")').last().click({ timeout: 10000 }).catch(() => {});
  }

  const res = await answer;
  if (!res) {
    log('energov: the portal never ran our search (no response from its search API)');
    await debugDump(page, 'energov-search', log);
    return { ran: false, cases: [], reported: 0 };
  }

  // Read the body as text and parse it ourselves. res.json() returns null on
  // any hiccup - a body already consumed elsewhere, an empty 204, a content
  // type the helper dislikes - and a null there is indistinguishable from a
  // portal that answered nothing, which would be reported as a failed read on
  // a property that actually has cases.
  const raw = await res.text().catch(() => '');
  let body: unknown = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }

  const parsed = parseSearchResponse(body);
  if (!parsed.ok) {
    const refusal = (body as any)?.Success === false;
    log(
      refusal
        ? 'energov: the portal answered Success:false - retrying'
        : `energov: search response was not readable (HTTP ${res.status()}, ${raw.length} bytes, starts "${raw.slice(0, 80).replace(/\s+/g, ' ')}")`,
    );
    return refusal ? null : { ran: false, cases: [], reported: 0 };
  }

  log(`energov: ${parsed.cases.length} code case row(s), portal reported ${parsed.counts.codeCases}`);
  return { ran: true, cases: parsed.cases, reported: parsed.counts.codeCases };
}

/** Up to three attempts, because the portal's first search often fails. */
async function searchCodeCases(
  ctx: ScraperCtx,
  address: string,
): Promise<{ ran: boolean; cases: EnergovCase[]; reported: number }> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await attemptSearch(ctx, address);
    if (r) return r;
    // Short, polite pause; the portal recovers on its own.
    await ctx.page.waitForTimeout(1500 * attempt);
  }
  ctx.log('energov: the portal refused the search on every attempt');
  return { ran: false, cases: [], reported: 0 };
}

export async function runEnergovScrape(
  ctx: ScraperCtx,
  j: EnergovJurisdiction,
): Promise<ScrapeResult> {
  const { log } = ctx;
  const t = j.tenant;
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

  // Nothing is read until proven otherwise, on every path out of here.
  result.permitsChecked = false;
  result.violationsChecked = false;

  // Refuse before searching if this tenant never published code cases.
  if (!hasCodeModule(t.modules)) {
    result.notes.push(noCodeModuleNote(t));
    return result;
  }

  if (!ctx.address) {
    result.notes.push(
      `${t.name}'s portal searches code cases by street address. We did not have one for this property, so nothing was checked.`,
    );
    return result;
  }

  try {
    await ctx.page.goto(searchUrl(t), { waitUntil: 'domcontentloaded', timeout: 45000 });
    // The app is script-rendered; wait for the control, attached not visible,
    // for the same reason the citizenserve adapter does.
    await ctx.page.waitForSelector('#SearchModule', { state: 'attached', timeout: 30000 });
    await ctx.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

    // Trust the live page over the registry snapshot: a tenant can switch the
    // module off between releases.
    const live = await liveModules(ctx);
    if (live.length && !hasCodeModule(live)) {
      log(`energov: ${t.name} no longer exposes Code Case (live modules: ${live.join(', ')})`);
      result.notes.push(noCodeModuleNote({ ...t, modules: live }));
      return result;
    }

    const r = await searchCodeCases(ctx, ctx.address);
    if (!r.ran) {
      result.notes.push(
        `Code case search: ${t.name}'s portal did not run our search this time - use the portal link below to confirm.`,
      );
      return result;
    }

    result.ok = true;
    // This adapter searches module 5 (Code Case) and nothing else, so the
    // permit side was never looked at. Without this the email printed
    // "No permits found" for a permit history nobody queried.
    result.violationsChecked = true;
    result.permitsChecked = false;
    result.violations = r.cases.map(
      (c): ScrapedViolation => ({
        caseNumber: c.caseNumber,
        status: c.status,
        openedDate: c.appliedDate,
        closedDate: null,
        description: [c.caseType, c.description].filter(Boolean).join(' - ') || null,
        // A recorded lien is the single most important thing on this platform,
        // so say so in the field a reader scans.
        lastAction: isEncumbering(c.status) ? `Status "${c.status}" - attached to the property` : null,
        details: c.description,
      }),
    );
    if (r.cases[0]?.address) result.matchedAddress = r.cases[0].address;
    if (r.cases[0]?.parcel) result.folio = result.folio ?? r.cases[0].parcel;

    const truncated = truncationNote(r.cases.length, r.reported, t.name);
    if (truncated) result.notes.push(truncated);
    result.notes.push(coverageNote(t, r.cases.length === 0));
    result.notes.push(AMOUNT_NOTE);
  } catch (e: any) {
    log(`energov error: ${e?.message ?? e}`);
    result.notes.unshift(
      `We could not read ${t.name}'s portal on this run. The link below goes straight to the same free search.`,
    );
  }

  return result;
}
