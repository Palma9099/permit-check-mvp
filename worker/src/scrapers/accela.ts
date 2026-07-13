// Accela Citizen Access (ACA) platform flow.
//
// ACA is the dominant Florida permitting portal - the same ASP.NET WebForms app
// serves Broward, Palm Beach, and many cities; only the agency code in the URL
// changes. One flow + the agency registry (jurisdictions.ts) covers all of them.
//
// Flow: open the module search (Building / Enforcement) → fill street number +
// name → submit → read the results GridView → map rows by column keyword.
// Degrades safely: any miss returns what was read (often nothing) and the caller
// falls back to portal links + a note. Never fabricates records.
//
// The field IDs below are the stable ACA product defaults; because the engine
// tries each selector in order and degrades on miss, an out-of-date selector
// yields a "use the link" result, never wrong data. Tighten per agency with the
// calibration script once the worker is deployed.

import type { ScrapeResult, ScrapedPermit, ScrapedViolation } from '../types.js';
import type { ScraperCtx } from './types.js';
import type { AccelaJurisdiction } from './jurisdictions.js';
import { readTables, pickTable, colIndex, cell, fillFirst, clickFirst } from './util.js';

const ACA_BASE = 'https://aca-prod.accela.com';

const STREET_NO_SEL = [
  'input[id$="txtGSStreetNo"]',
  'input[id*="StreetNo" i]',
  'input[id*="StreetNum" i]',
];
const STREET_NAME_SEL = [
  'input[id$="txtGSStreetName"]',
  'input[id*="StreetName" i]',
];
const SUBMIT_SEL = [
  '#ctl00_PlaceHolderMain_btnNewSearch',
  'a[id$="btnNewSearch"]',
  'input[id$="btnNewSearch"]',
  'a[title="Search" i]',
  'input[value="Search" i]',
  'button:has-text("Search")',
];

const PERMIT_KEYWORDS = ['record', 'permit', 'date', 'status', 'type'];
const CODE_KEYWORDS = ['record', 'case', 'date', 'status', 'type', 'violation'];

// Pull a street number + name out of a free-text address (drop city/state/zip
// after the first comma; strip unit tokens ACA's street-name field rejects).
export function parseStreet(address: string | null): { num: string | null; name: string | null } {
  if (!address) return { num: null, name: null };
  const first = address.split(',')[0].trim();
  const m = first.match(/^(\d+)\s+(.*)$/);
  if (m) {
    const name = m[2].replace(/\b(apt|apartment|unit|ste|suite|lot|bldg|#)\b.*$/i, '').trim();
    return { num: m[1], name: name || null };
  }
  return { num: null, name: first || null };
}

async function searchModule(
  ctx: ScraperCtx,
  agency: string,
  moduleName: string,
  keywords: string[],
): Promise<{ read: boolean; headers: string[]; rows: string[][] }> {
  const { page, address, log } = ctx;
  const url = `${ACA_BASE}/${agency}/Cap/CapHome.aspx?module=${moduleName}&TabName=${moduleName}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const { num, name } = parseStreet(address);
  if (!name) {
    log('accela: no street name parsed from address');
    return { read: false, headers: [], rows: [] };
  }
  const filledName = await fillFirst(page, STREET_NAME_SEL, name);
  if (num) await fillFirst(page, STREET_NO_SEL, num); // best-effort; some agencies need only the name
  if (!filledName) {
    log(`accela/${moduleName}: could not locate the street-name field (needs calibration or the form is in an iframe)`);
    return { read: false, headers: [], rows: [] };
  }
  log(`accela/${moduleName}: searching "${num ?? ''} ${name}"`);

  const submitted = await clickFirst(page, SUBMIT_SEL);
  if (!submitted) await page.keyboard.press('Enter').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const table = pickTable(await readTables(page), keywords);
  if (!table) {
    log(`accela/${moduleName}: no results grid matched [${keywords.join(', ')}]`);
    return { read: false, headers: [], rows: [] };
  }
  return { read: true, headers: table.headers, rows: table.rows };
}

export async function runAccelaScrape(ctx: ScraperCtx, j: AccelaJurisdiction): Promise<ScrapeResult> {
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

  // --- Building permits ---
  try {
    const r = await searchModule(ctx, j.agency, j.buildingModule, PERMIT_KEYWORDS);
    if (r.read) {
      const iNum = colIndex(r.headers, ['permit', 'record', 'number', 'process']);
      const iType = colIndex(r.headers, ['type', 'description', 'work', 'scope']);
      const iStatus = colIndex(r.headers, ['status', 'state']);
      const iIssued = colIndex(r.headers, ['issue', 'applied', 'open', 'date']);
      const iFinaled = colIndex(r.headers, ['final', 'complete', 'closed', 'co ']);
      const iValue = colIndex(r.headers, ['value', 'valuation', 'cost']);
      const iContractor = colIndex(r.headers, ['contractor', 'applicant', 'company']);
      const permits: ScrapedPermit[] = r.rows.map((row) => ({
        permitNumber: cell(row, iNum),
        type: cell(row, iType),
        status: cell(row, iStatus),
        issuedDate: cell(row, iIssued),
        finaledDate: cell(row, iFinaled),
        description: cell(row, iType),
        value: cell(row, iValue),
        contractor: cell(row, iContractor),
      }));
      result.permits = permits;
      result.ok = true;
      log(`accela: read ${permits.length} permit row(s)`);
    } else {
      result.notes.push('Permit portal: automated read did not return a results grid - use the portal link to confirm.');
    }
  } catch (e: any) {
    log(`accela permit error: ${e?.message ?? e}`);
    result.notes.push('Permit portal could not be read automatically this run.');
  }

  // --- Code enforcement (optional) ---
  if (j.enforcementModule) {
    try {
      const r = await searchModule(ctx, j.agency, j.enforcementModule, CODE_KEYWORDS);
      if (r.read) {
        const iNum = colIndex(r.headers, ['case', 'record', 'number']);
        const iStatus = colIndex(r.headers, ['status', 'state']);
        const iOpened = colIndex(r.headers, ['open', 'date', 'created', 'applied']);
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
        log(`accela: read ${violations.length} code case row(s)`);
      } else {
        result.notes.push('Code-enforcement portal: automated read did not return a results grid - use the portal link to confirm.');
      }
    } catch (e: any) {
      log(`accela code error: ${e?.message ?? e}`);
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
