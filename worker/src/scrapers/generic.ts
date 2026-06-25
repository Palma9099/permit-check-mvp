// Generic county-portal scraper. Drives a real browser through the portal's
// search form, then reads the results table. Designed to degrade safely: any
// failure returns ok:false with portal links + a note (never fabricated data).

import type { ScrapeResult, ScrapedPermit, ScrapedViolation } from '../types.js';
import type { ScraperCtx, PortalConfig } from './types.js';
import { readTables, pickTable, colIndex, cell, fillFirst, clickFirst } from './util.js';

async function searchAndRead(
  ctx: ScraperCtx,
  searchUrl: string,
  addressSelectors: string[],
  folioSelectors: string[] | undefined,
  submitSelectors: string[],
  resultHeaderKeywords: string[],
): Promise<{ read: boolean; headers: string[]; rows: string[][] }> {
  const { page, address, folio, log } = ctx;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Prefer folio when the portal supports it (most precise); else address.
  let filled = false;
  if (folio && folioSelectors && folioSelectors.length) {
    filled = await fillFirst(page, folioSelectors, folio);
    if (filled) log(`filled folio into one of: ${folioSelectors.join(', ')}`);
  }
  if (!filled && address) {
    filled = await fillFirst(page, addressSelectors, address);
    if (filled) log(`filled address into one of: ${addressSelectors.join(', ')}`);
  }
  if (!filled) {
    log('could not locate a search input — portal layout may have changed (needs calibration)');
    return { read: false, headers: [], rows: [] };
  }

  const submitted = await clickFirst(page, submitSelectors);
  if (submitted) {
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  } else {
    // Fall back to pressing Enter in the focused field.
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }
  await page.waitForTimeout(1500);

  const tables = await readTables(page);
  const table = pickTable(tables, resultHeaderKeywords);
  if (!table) {
    log(`no results table matched keywords [${resultHeaderKeywords.join(', ')}]`);
    return { read: false, headers: [], rows: [] };
  }
  return { read: true, headers: table.headers, rows: table.rows };
}

export async function runPortalScrape(ctx: ScraperCtx, cfg: PortalConfig): Promise<ScrapeResult> {
  const { log } = ctx;
  const result: ScrapeResult = {
    ok: false,
    county: cfg.county,
    matchedAddress: ctx.address,
    folio: ctx.folio,
    permits: [],
    violations: [],
    notes: [],
    portalLinks: cfg.portalLinks,
    source: cfg.source,
  };

  // --- Permits ---
  try {
    const r = await searchAndRead(
      ctx,
      cfg.permit.searchUrl,
      cfg.permit.addressInputSelectors,
      cfg.permit.folioInputSelectors,
      cfg.permit.submitSelectors,
      cfg.permit.resultHeaderKeywords,
    );
    if (r.read) {
      const iNum = colIndex(r.headers, ['permit', 'number', 'process', 'record']);
      const iType = colIndex(r.headers, ['type', 'description', 'work', 'scope']);
      const iStatus = colIndex(r.headers, ['status', 'state']);
      const iIssued = colIndex(r.headers, ['issue', 'applied', 'date']);
      const iFinaled = colIndex(r.headers, ['final', 'complete', 'closed']);
      const permits: ScrapedPermit[] = r.rows.map((row) => ({
        permitNumber: cell(row, iNum),
        type: cell(row, iType),
        status: cell(row, iStatus),
        issuedDate: cell(row, iIssued),
        finaledDate: cell(row, iFinaled),
        description: cell(row, iType),
        value: null,
        contractor: null,
      }));
      result.permits = permits;
      result.ok = true;
      log(`permits: read ${permits.length} row(s)`);
    } else {
      result.notes.push('Permit portal: automated read did not return a results table — use the portal link to confirm.');
    }
  } catch (e: any) {
    log(`permit scrape error: ${e?.message ?? e}`);
    result.notes.push('Permit portal could not be read automatically this run.');
  }

  // --- Code enforcement (optional) ---
  if (cfg.code) {
    try {
      const r = await searchAndRead(
        ctx,
        cfg.code.searchUrl,
        cfg.code.addressInputSelectors,
        undefined,
        cfg.code.submitSelectors,
        cfg.code.resultHeaderKeywords,
      );
      if (r.read) {
        const iNum = colIndex(r.headers, ['case', 'number', 'record']);
        const iStatus = colIndex(r.headers, ['status', 'state']);
        const iOpened = colIndex(r.headers, ['open', 'date', 'created']);
        const iDesc = colIndex(r.headers, ['description', 'violation', 'type', 'problem']);
        const violations: ScrapedViolation[] = r.rows.map((row) => ({
          caseNumber: cell(row, iNum),
          status: cell(row, iStatus),
          openedDate: cell(row, iOpened),
          closedDate: null,
          description: cell(row, iDesc),
          lastAction: null,
        }));
        result.violations = violations;
        result.ok = true;
        log(`violations: read ${violations.length} row(s)`);
      } else {
        result.notes.push('Code-enforcement portal: automated read did not return a results table — use the portal link to confirm.');
      }
    } catch (e: any) {
      log(`code scrape error: ${e?.message ?? e}`);
      result.notes.push('Code-enforcement portal could not be read automatically this run.');
    }
  }

  if (!result.ok) {
    result.notes.unshift(
      'We could not automatically read this county portal on this run. This usually means the portal layout changed or required an extra step (CAPTCHA, disambiguation). The links below go straight to the records.',
    );
  }
  return result;
}
