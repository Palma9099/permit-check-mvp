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
import {
  CASE_NO,
  PERMIT_NO,
  parcelKeyFor,
  authorityFromCityName,
  authorityNote,
  folioRefusal,
  fieldFrom,
  parseCaseDetail,
  parseActivities,
  lienSummary,
  cleanDate,
  pickGrid,
  exactIndex,
  type ParcelKey,
  type Authority,
  type BrowardCaseDetail,
  type BrowardActivities,
} from './broward-parse.js';

export {
  parcelKeyFor,
  authorityFromCityName,
  authorityNote,
  folioRefusal,
  fieldFrom,
  parseCaseDetail,
  parseActivities,
  lienSummary,
  cleanDate,
  pickGrid,
  exactIndex,
  type ParcelKey,
  type Authority,
  type BrowardCaseDetail,
  type BrowardActivities,
};

const BCS = 'https://dpepp.broward.org/BCS/Default.aspx';
const PARCEL_SEARCH = `${BCS}?PossePresentation=ParcelSearchForEnforcement`;
const CITY_BOUNDARIES =
  'https://services.arcgis.com/JMAJrTsHNLrSsWf5/ArcGIS/rest/services/Municipality_Boundaries_with_BMSD/FeatureServer/0/query';

/** How many cases to open for the cited section and the lien recording. */
const DETAIL_LIMIT = Number(process.env.BROWARD_DETAIL_LIMIT ?? 8);

/** Case statuses that decide a sale, enriched before the closed ones. */
const LIVE_STATUSES = ['lien recorded', 'land clearance lien', 'violation', 'open', 'board order issued', 'scheduled for hearing'];

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

  const refusal = folioRefusal(ctx.folio);
  if (refusal) {
    result.notes.push(...refusal.notes);
    return result;
  }
  const key = parcelKeyFor(ctx.folio)!;

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
  result.notes.push(authorityNote(authority, nothingFound));

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
