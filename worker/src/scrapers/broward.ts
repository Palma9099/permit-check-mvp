// Broward County BCS (Posse / Computronix) platform flow.
//
// Broward is not an Accela customer. The registry used to point this county at
// aca-prod.accela.com/BROWARD/, which returns HTTP 404, so every Broward deep
// scan had been falling through to "portal could not be read". What the county
// actually runs is Posse at dpepp.broward.org/BCS, and it is pleasant to work
// with: the parcel search is one postback, and everything after that is a plain
// GET with no session, no cookie and no viewstate.
//
//   parcel search  Default.aspx?PossePresentation=ParcelSearchForEnforcement
//   code cases     Default.aspx?PossePresentation=ParcelEnforcementList&PosseObjectId=N
//   permits        Default.aspx?PossePresentation=ParcelPermitList&PosseObjectId=N
//   one case       Default.aspx?PossePresentation=ViewEnforcementCase&PosseObjectId=M
//
// One PosseObjectId keys both the code cases and the permits for a parcel, so a
// single search buys both datasets.
//
// JURISDICTION, which is the whole correctness story here:
// Broward County's code enforcement covers UNINCORPORATED Broward - the BMSD
// neighbourhoods - which is 16,888 of the county's 1,944,375 people. Roughly
// 92-95% of the county's caseload reads "Jurisdiction: Unincorporated". The
// municipal cases that do appear are Unsafe Structure only, the county's Unsafe
// Structures Board acting for cities under interlocal agreement.
//
// So an empty result from this county means almost nothing on its own. Unlike
// Palm Beach, a Broward folio does not encode whether the parcel is in a city,
// so we resolve the real authority from the parcel point against the county's
// own municipality layer - never from the postal city, which lies constantly
// here (UNINCORPORATED parcels carry "FORT LAUDERDALE" mailing addresses all
// over this data). If the parcel is in a city, we say the city is the code
// authority and that the county having nothing is not a clean result.
//
// Data hygiene: do not trust the city column in the case list. Observed in live
// data: "NINCORPORATED", "Unicorporated", "FT LAUDERDALE, FL 22211" and
// "THROUGH HIS GRACE 4 LLC" sitting in the city field. Each case record carries
// its own "Jurisdiction:" field; that is the one to read.

import type { ScrapeResult, ScrapedPermit, ScrapedViolation } from '../types.js';
import type { ScraperCtx } from './types.js';
import type { BrowardJurisdiction } from './jurisdictions.js';
import { readTables, colIndex, cell, debugDump } from './util.js';

const BCS = 'https://dpepp.broward.org/BCS/Default.aspx';
const PARCEL_SEARCH = `${BCS}?PossePresentation=ParcelSearchForEnforcement`;
const CITY_BOUNDARIES =
  'https://services.arcgis.com/JMAJrTsHNLrSsWf5/ArcGIS/rest/services/Municipality_Boundaries_with_BMSD/FeatureServer/0/query';

/** How many cases to open for the cited section and the lien recording. */
const DETAIL_LIMIT = Number(process.env.BROWARD_DETAIL_LIMIT ?? 8);

/** Case statuses that decide a sale, enriched before the closed ones. */
const LIVE_STATUSES = ['lien recorded', 'land clearance lien', 'violation', 'open', 'board order issued', 'scheduled for hearing'];

/** Posse case and permit numbers both read YY-NNNN. */
const CASE_NO = /^\d\d-\d{3,5}$/;
const PERMIT_NO = /^\d\d-\d{3,6}$/;

/** The portal prints this literal string where a date is absent. It is not a date. */
const DATE_PLACEHOLDER = /^m{2,3}\s*d{1,2},?\s*y{2,4}$/i;

// --- parcel key -------------------------------------------------------------

export type ParcelKey =
  | { kind: 'parcelId'; value: string }
  | { kind: 'folio'; value: string };

/**
 * Work out which of the BCS search fields a given parcel key belongs in.
 *
 * The app stores Broward folios as 12 compact digits (see compactBrowardFolio
 * in src/lib/lien-providers/broward.ts), and that is exactly what the portal's
 * "Parcel ID" field wants - 504113111610. The portal's separate "Folio Number"
 * field wants the shorter dashed form, 0113-11-1610. The two encodings differ
 * by more than punctuation, so rather than convert between them we send each to
 * the field it belongs to and refuse anything that is neither.
 */
export function parcelKeyFor(raw: string | null): ParcelKey | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  if (d.length === 12) return { kind: 'parcelId', value: d };
  if (d.length === 10) return { kind: 'folio', value: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` };
  return null;
}

// --- who is actually the code authority -------------------------------------

export type Authority =
  | { kind: 'county' }                      // unincorporated / BMSD: the county is it
  | { kind: 'city'; name: string }          // a municipality runs code here
  | { kind: 'unknown' };                    // we could not tell, and must say so

/** Unincorporated Broward shows up as "UNINCORPORATED" or "BMSD- <NAME>". */
export function authorityFromCityName(name: string | null | undefined): Authority {
  if (!name || !name.trim()) return { kind: 'unknown' };
  const n = name.trim();
  if (/unincorporated|^bmsd\b|\bbmsd-/i.test(n)) return { kind: 'county' };
  return { kind: 'city', name: n };
}

/**
 * Resolve the code authority from the parcel point, against Broward's own
 * municipality layer. Never from the postal city: in this county an
 * unincorporated parcel routinely carries a "FORT LAUDERDALE" mailing address.
 */
async function resolveAuthority(ctx: ScraperCtx): Promise<Authority> {
  const { lat, lng, log } = ctx;
  if (!Number.isFinite(lat as number) || !Number.isFinite(lng as number)) return { kind: 'unknown' };
  try {
    const u = new URL(CITY_BOUNDARIES);
    for (const [k, v] of Object.entries({
      f: 'json',
      geometry: `${lng},${lat}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'CITYNAME',
      returnGeometry: 'false',
      resultRecordCount: '1',
    })) u.searchParams.set(k, v);
    const res = await fetch(u, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { kind: 'unknown' };
    const body: any = await res.json();
    if (body?.error) return { kind: 'unknown' };
    const a = authorityFromCityName(body?.features?.[0]?.attributes?.CITYNAME);
    log(`broward: parcel point is in ${a.kind === 'city' ? a.name : a.kind}`);
    return a;
  } catch {
    // A boundary lookup that failed is NOT "unincorporated". Getting that wrong
    // would quietly drop the city, which in Broward is most of the answer.
    return { kind: 'unknown' };
  }
}

// --- page parsing (pure, so it is testable without a browser) ---------------

/**
 * Read a "Label: value" line out of a Posse detail page's rendered text.
 * The label must match the whole label, so "Violation" does not also match
 * "Complaint / Violation", and the value keeps any colons of its own, which
 * matters for "Section: CITATION: 39-275(6)b".
 */
export function fieldFrom(text: string, label: string): string | null {
  // Every class of whitespace here is horizontal on purpose. \s matches a
  // newline, so a pattern like `Label:\s*(.*)` silently walks past an EMPTY
  // field and captures the NEXT line - which made a case with no complaint text
  // report its "Date Established" line as the complaint. An empty field must
  // read as empty.
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[ \\t]*');
  const m = text.match(new RegExp(`^[ \\t]*${esc}[ \\t]*:[ \\t]*(.*)$`, 'im'));
  const v = m?.[1]?.replace(/[ \t]+/g, ' ').trim();
  return v ? v : null;
}

/**
 * Pick a Posse results grid.
 *
 * Two traps make the obvious approaches wrong on these pages.
 *
 * Keyword scoring loses: the page chrome is itself a <table> whose first row
 * flattens the whole document, so it matches every keyword. Worse, a substring
 * match on "case" hits the page heading "BCS Enforcement Cases" and lands on a
 * column that is not the case column at all - which silently returned the case
 * number for every field.
 *
 * So require two things a wrapper table cannot fake: the id column header must
 * match EXACTLY (not as a substring), and the header must be the same width as
 * the data rows. The real grid is 7 columns wide with 7-column rows; every
 * wrapper has a header far wider than its rows.
 */
/**
 * Index of the header that equals one of `names` exactly. Needed wherever a
 * substring would collide: the permit grid has both "Permit Number" and
 * "Permit", so colIndex(['permit']) returns the number column and every
 * description comes out as the permit number repeated.
 */
export function exactIndex(headers: string[], names: string[]): number {
  const want = names.map((n) => n.toLowerCase());
  return headers.findIndex((h) => want.includes(h.trim().toLowerCase()));
}

export function pickGrid(
  tables: { headers: string[]; rows: string[][] }[],
  idHeaders: string[],
  idPattern: RegExp,
): { headers: string[]; rows: string[][]; idIndex: number } | null {
  const want = idHeaders.map((h) => h.toLowerCase());
  let best: { headers: string[]; rows: string[][]; idIndex: number; hits: number } | null = null;

  for (const t of tables) {
    const i = t.headers.findIndex((h) => want.includes(h.trim().toLowerCase()));
    if (i < 0) continue;
    const rows = t.rows.filter((r) => r.length === t.headers.length);
    const hits = rows.filter((r) => idPattern.test((r[i] ?? '').trim())).length;
    if (!hits) continue;
    // A nested wrapper can satisfy the width test by accident, so prefer the
    // table that actually holds the most id-shaped rows, and on a tie the
    // narrowest - which is always the innermost, real grid.
    const better =
      !best || hits > best.hits || (hits === best.hits && t.headers.length < best.headers.length);
    if (better) best = { headers: t.headers, rows, idIndex: i, hits };
  }
  return best ? { headers: best.headers, rows: best.rows, idIndex: best.idIndex } : null;
}

export interface BrowardCaseDetail {
  status: string | null;
  enforcementType: string | null;
  caseType: string | null;
  complaint: string | null;
  established: string | null;
  inspector: string | null;
  folio: string | null;
  address: string | null;
  jurisdiction: string | null;
  legal: string | null;
  owner: string | null;
}

export function parseCaseDetail(text: string): BrowardCaseDetail {
  return {
    status: fieldFrom(text, 'Status'),
    enforcementType: fieldFrom(text, 'Enforcement Type'),
    caseType: fieldFrom(text, 'Case Type'),
    complaint: fieldFrom(text, 'Complaint / Violation'),
    established: fieldFrom(text, 'Date Established'),
    inspector: fieldFrom(text, 'Inspector'),
    folio: fieldFrom(text, 'Folio Number'),
    address: fieldFrom(text, 'Address'),
    jurisdiction: fieldFrom(text, 'Jurisdiction'),
    legal: fieldFrom(text, 'Legal Description'),
    owner: fieldFrom(text, 'Owner'),
  };
}

export interface BrowardActivities {
  novIssued: string | null;
  section: string | null;
  violation: string | null;
  crNumber: string | null;
  recordingDate: string | null;
}

export function parseActivities(text: string): BrowardActivities {
  return {
    novIssued: fieldFrom(text, 'NOV Issued'),
    section: fieldFrom(text, 'Section'),
    violation: fieldFrom(text, 'Violation'),
    crNumber: fieldFrom(text, 'CR Number'),
    recordingDate: fieldFrom(text, 'Recording Date'),
  };
}

/**
 * A one-line summary of the recorded lien, or null. The CR number is Broward's
 * Official Records instrument number, so this is the string that lets a person
 * pull the actual recorded document.
 */
export function lienSummary(a: BrowardActivities): string | null {
  if (!a.crNumber && !a.recordingDate) return null;
  const parts = ['Lien recorded'];
  if (a.recordingDate) parts.push(a.recordingDate);
  if (a.crNumber) parts.push(`(Broward Official Records CR ${a.crNumber})`);
  return parts.join(' ');
}

/** Drop the portal's "mmm dd, yyyy" placeholder rather than passing it off as a date. */
export function cleanDate(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  return !t || DATE_PLACEHOLDER.test(t) ? null : t;
}

// --- the flow ---------------------------------------------------------------

type SearchOutcome =
  | { kind: 'parcel'; objectId: string }
  | { kind: 'noParcel' }
  | { kind: 'failed' };

async function findParcel(ctx: ScraperCtx, key: ParcelKey): Promise<SearchOutcome> {
  const { page, log } = ctx;
  await page.goto(PARCEL_SEARCH, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(800);

  const sel = key.kind === 'parcelId' ? 'input[id^="ParcelID_"]' : 'input[id^="FolioNumber_"]';
  const field = page.locator(sel).first();
  if (!(await field.count())) {
    log(`broward: ${key.kind} field not found on the parcel search`);
    await debugDump(page, 'broward-parcel-search', log);
    return { kind: 'failed' };
  }
  await field.fill(key.value, { timeout: 10000 });
  await page.locator('input[id$="PerformSearch"]').last().click({ timeout: 10000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const m = page.url().match(/PosseObjectId=(\d+)/i);
  if (m) return { kind: 'parcel', objectId: m[1] };

  const body = (await page.innerText('body').catch(() => '')) ?? '';
  if (/No information was found matching your selection criteria/i.test(body)) {
    log(`broward: no parcel matched ${key.value}`);
    return { kind: 'noParcel' };
  }
  log(`broward: parcel search did not resolve (url=${page.url()})`);
  await debugDump(page, 'broward-parcel-result', log);
  return { kind: 'failed' };
}

interface CaseRow {
  caseNo: string | null;
  address: string | null;
  established: string | null;
  type: string | null;
  status: string | null;
  objectId: string | null;
}

/** Pull the case rows plus each row's deep link, which the list embeds. */
async function readCaseList(ctx: ScraperCtx, objectId: string): Promise<{ ran: boolean; rows: CaseRow[] }> {
  const { page, log } = ctx;
  await page.goto(`${BCS}?PossePresentation=ParcelEnforcementList&PosseObjectId=${objectId}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(800);

  const body = (await page.innerText('body').catch(() => '')) ?? '';
  if (/BCS - Error/i.test(body)) return { ran: false, rows: [] };
  if (/No Enforcement Cases were found for this parcel/i.test(body)) {
    log('broward: portal reports no enforcement cases for this parcel');
    return { ran: true, rows: [] };
  }

  // Each row carries its own ViewEnforcementCase link; map case number -> id.
  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll('tr'))
      .map((tr) => {
        const a = tr.querySelector('a[href*="ViewEnforcementCase"]');
        const span = tr.querySelector('span[id^="ExternalFileNum_"]');
        const href = a ? a.getAttribute('href') || '' : '';
        const id = href.match(/PosseObjectId=(\d+)/i);
        return { caseNo: (span?.textContent || '').trim(), objectId: id ? id[1] : '' };
      })
      .filter((x) => x.caseNo && x.objectId),
  );
  const byCase = new Map(links.map((l) => [l.caseNo, l.objectId]));

  const table = pickGrid(await readTables(page), ['case #', 'case no', 'case number'], CASE_NO);
  if (!table) {
    await debugDump(page, 'broward-case-list', log);
    return { ran: false, rows: [] };
  }
  const iCase = table.idIndex;
  const iAddr = colIndex(table.headers, ['street address', 'address']);
  const iEst = colIndex(table.headers, ['established']);
  const iType = colIndex(table.headers, ['enforcement type', 'type']);
  const iStat = colIndex(table.headers, ['status']);

  const rows = table.rows
    .map((r) => {
      const caseNo = cell(r, iCase);
      return {
        caseNo,
        address: cell(r, iAddr),
        established: cleanDate(cell(r, iEst)),
        type: cell(r, iType),
        status: cell(r, iStat),
        objectId: caseNo ? byCase.get(caseNo) ?? null : null,
      };
    })
    .filter((r) => r.caseNo && CASE_NO.test(r.caseNo));

  log(`broward: ${rows.length} case row(s) on parcel ${objectId}`);
  return { ran: true, rows };
}

/** Open one case by its deep link and read its detail plus the Activities tab. */
async function readCase(
  ctx: ScraperCtx,
  caseObjectId: string,
): Promise<{ detail: BrowardCaseDetail; activities: BrowardActivities } | null> {
  const { page, log } = ctx;
  try {
    await page.goto(`${BCS}?PossePresentation=ViewEnforcementCase&PosseObjectId=${caseObjectId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    await page.waitForTimeout(600);
    const detailText = (await page.innerText('body').catch(() => '')) ?? '';
    if (!/Case Details/i.test(detailText)) return null;
    const detail = parseCaseDetail(detailText);

    // Activities is a tab postback on the same page, and it is where the cited
    // section and the recorded lien live.
    let activities: BrowardActivities = {
      novIssued: null,
      section: null,
      violation: null,
      crNumber: null,
      recordingDate: null,
    };
    const tab = page.locator('a:text-is("Activities")').first();
    if (await tab.count()) {
      await tab.click({ timeout: 10000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(600);
      const actText = (await page.innerText('body').catch(() => '')) ?? '';
      if (/Activities/i.test(actText)) activities = parseActivities(actText);
    }
    return { detail, activities };
  } catch (e: any) {
    log(`broward: case ${caseObjectId} unreadable (${e?.message ?? e})`);
    return null;
  }
}

async function readPermits(ctx: ScraperCtx, objectId: string): Promise<{ ran: boolean; permits: ScrapedPermit[] }> {
  const { page, log } = ctx;
  await page.goto(`${BCS}?PossePresentation=ParcelPermitList&PosseObjectId=${objectId}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(800);

  const body = (await page.innerText('body').catch(() => '')) ?? '';
  if (/BCS - Error/i.test(body)) return { ran: false, permits: [] };

  const table = pickGrid(await readTables(page), ['permit number', 'permit no'], PERMIT_NO);
  if (!table) {
    // A parcel with no permits renders the grid's headers and no matching rows,
    // which pickGrid cannot tell from a layout change - so report it as a read
    // we could not complete rather than as a property with no permits.
    await debugDump(page, 'broward-permit-list', log);
    return { ran: false, permits: [] };
  }
  const iNo = table.idIndex;
  const iKind = exactIndex(table.headers, ['permit']);
  const iType = colIndex(table.headers, ['type']);
  const iStatus = colIndex(table.headers, ['status']);
  const iIssued = colIndex(table.headers, ['issue']);
  const iContractor = colIndex(table.headers, ['contractor']);

  const permits = table.rows
    .map((r) => ({
      permitNumber: cell(r, iNo),
      type: cell(r, iType),
      status: cell(r, iStatus),
      issuedDate: cleanDate(cell(r, iIssued)),
      finaledDate: null,
      description: [cell(r, iKind), cell(r, iType)].filter(Boolean).join(' - ') || null,
      value: null,
      contractor: cell(r, iContractor),
    }))
    .filter((p) => p.permitNumber && PERMIT_NO.test(p.permitNumber));

  log(`broward: ${permits.length} permit row(s) on parcel ${objectId}`);
  return { ran: true, permits };
}

// --- entry point ------------------------------------------------------------

export async function runBrowardScrape(ctx: ScraperCtx, j: BrowardJurisdiction): Promise<ScrapeResult> {
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

  const key = parcelKeyFor(ctx.folio);
  if (!key) {
    result.notes.push(
      ctx.folio
        ? `"${ctx.folio}" is not a Broward parcel number. Broward folios are 12 digits (e.g. 504113111610). Look it up on the Property Appraiser link below and re-run.`
        : 'Broward County records are keyed by parcel number. Look the folio up on the Property Appraiser link below and re-run with it.',
    );
    return result;
  }

  // Work out who the code authority actually is before reading anything, so we
  // can say what an empty county result means.
  const authority = await resolveAuthority(ctx);

  let objectId: string | null = null;
  try {
    const found = await findParcel(ctx, key);
    if (found.kind === 'parcel') {
      objectId = found.objectId;
    } else if (found.kind === 'noParcel') {
      result.notes.push(`No Broward County parcel matched ${key.value}. Confirm the folio on the Property Appraiser link below.`);
      return result;
    } else {
      result.notes.push('Broward County portal: we could not run the parcel search this run - use the portal link to confirm.');
      return result;
    }
  } catch (e: any) {
    log(`broward parcel search error: ${e?.message ?? e}`);
    result.notes.push('Broward County portal could not be reached this run.');
    return result;
  }

  try {
    const r = await readPermits(ctx, objectId);
    if (r.ran) {
      result.permits = r.permits;
      result.ok = true;
    } else {
      result.notes.push('County permit list: automated read did not return a table - use the portal link to confirm.');
    }
  } catch (e: any) {
    log(`broward permit error: ${e?.message ?? e}`);
    result.notes.push('County permit list could not be read this run.');
  }

  try {
    const list = await readCaseList(ctx, objectId);
    if (!list.ran) {
      result.notes.push('County code-case list: automated read did not return a table - use the portal link to confirm.');
    } else {
      result.ok = true;
      // Enrich what matters: a recorded lien or an open violation first.
      const ordered = [...list.rows].sort((a, b) => {
        const score = (s: string | null) => (s && LIVE_STATUSES.includes(s.toLowerCase()) ? 0 : 1);
        return score(a.status) - score(b.status);
      });
      for (const row of ordered) {
        let codes: string[] | undefined;
        let details: string | null = null;
        let lastAction: string | null = null;
        let description = row.type ? `${row.type}` : null;

        if (result.violations.length < DETAIL_LIMIT && row.objectId) {
          const read = await readCase(ctx, row.objectId);
          if (read) {
            description = read.detail.complaint ?? description;
            details = read.activities.violation ?? read.detail.complaint ?? null;
            if (read.activities.section) codes = [read.activities.section];
            lastAction = lienSummary(read.activities);
            // The record's own jurisdiction beats the dirty city column.
            if (read.detail.jurisdiction && !result.matchedAddress && read.detail.address) {
              result.matchedAddress = read.detail.address;
            }
          }
        }
        result.violations.push({
          caseNumber: row.caseNo,
          status: row.status,
          openedDate: row.established,
          closedDate: null,
          description,
          lastAction,
          codes,
          details,
        });
      }
    }
  } catch (e: any) {
    log(`broward code error: ${e?.message ?? e}`);
    result.notes.push('County code-case list could not be read this run.');
  }

  // What an empty county result actually means.
  const nothingFound = result.violations.length === 0;
  if (authority.kind === 'city') {
    result.notes.push(
      `${authority.name} is the code authority for this parcel, not Broward County. The county searched above covers unincorporated Broward, so ${nothingFound ? 'finding nothing here says nothing about the property' : 'these county records are only part of the picture'} - the city's own code and permit records still need checking.`,
    );
  } else if (authority.kind === 'county') {
    result.notes.push(
      'This parcel is in unincorporated Broward (BMSD), so Broward County is the code authority and the searches above are the right ones.',
    );
  } else {
    result.notes.push(
      'We could not confirm whether this parcel sits in a city or in unincorporated Broward. Broward County code enforcement covers unincorporated areas only, and about 99% of the county lives in one of its 31 cities, so treat an empty county result as unchecked rather than clear until the city is identified.',
    );
  }

  if (result.ok) {
    result.notes.push(
      'County case status "Lien Recorded" carries a CR number for Broward Official Records; the county does not publish the dollar amount, so the recorded document is where the figure lives.',
    );
  } else {
    result.notes.unshift(
      'We could not read the Broward County portal on this run. The links below go straight to the same free searches.',
    );
  }
  return result;
}
