/**
 * Palma Ledger ingest — vendored from Palma9099/palma-ledger SDK.
 *
 * Writes every diagnostic run to the central property ledger so that the
 * thousands of one-off lookups Palma's tools generate accumulate into a
 * proprietary dataset over time.
 *
 * Ingest is fire-and-log: ledger failures NEVER break the user-facing
 * report. Disabled by default; enable by setting LEDGER_INGEST_ENABLED=true
 * in Vercel env, plus SUPABASE_URL and SUPABASE_SECRET_KEY.
 *
 * When palma-ledger becomes a published package, replace this file with:
 *   import { ingestPermitCheckReport } from 'palma-ledger/sdk';
 */

import type { DiagnosticReport, Permit, CodeCase } from './types';

type County = 'miami-dade' | 'broward' | 'palm-beach';

const LEDGER_COUNTIES: ReadonlySet<County> = new Set<County>([
  'miami-dade',
  'broward',
  'palm-beach',
]);

function isLedgerCounty(c: string | null | undefined): c is County {
  return !!c && LEDGER_COUNTIES.has(c as County);
}

interface IngestResult {
  upid: string;
  propertyCreated: boolean;
  permitEventsCreated: number;
  violationEventsCreated: number;
  durationMs: number;
}

/**
 * Public entry. Returns null on any failure or when ingest is disabled.
 */
export async function recordToLedger(
  county: string | null | undefined,
  geo: { lat: number; lng: number },
  report: DiagnosticReport,
): Promise<IngestResult | null> {
  if (process.env.LEDGER_INGEST_ENABLED !== 'true') return null;
  if (!isLedgerCounty(county)) return null;
  if (!report.property.folio) return null;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.warn('[ledger] SUPABASE_URL/SUPABASE_SECRET_KEY missing; skipping ingest');
    return null;
  }

  try {
    const t0 = Date.now();
    const ctx = { url, key, source: 'permit-check-mvp' as const };

    // 1. Property + alias
    const upidResult = await resolveOrCreateProperty(ctx, {
      county,
      folio: report.property.folio,
      address: report.property.siteAddress ?? report.query.address ?? '',
      geom: geo,
    });

    // 2. Permits
    let permitsCreated = 0;
    for (const p of report.permitHistory.subjectPermits) {
      if (!p.permitNumber) continue;
      const created = await maybeRecordPermit(ctx, upidResult.upid, p);
      if (created) permitsCreated++;
    }

    // 3. Violations
    let violationsCreated = 0;
    for (const c of report.codeEnforcement.openCases) {
      if (!c.caseNumber) continue;
      const created = await maybeRecordViolation(ctx, upidResult.upid, c, true);
      if (created) violationsCreated++;
    }
    for (const c of report.codeEnforcement.closedCases) {
      if (!c.caseNumber) continue;
      const created = await maybeRecordViolation(ctx, upidResult.upid, c, false);
      if (created) violationsCreated++;
    }

    // 4. Diagnostic summary event
    await postEvent(ctx, {
      property_id: upidResult.upid,
      event_type: 'palma.diagnostic.generated',
      event_data: {
        bottomLine: report.bottomLine,
        flagsCount: {
          strong: report.flags.strong.length,
          medium: report.flags.medium.length,
          weak: report.flags.weak.length,
        },
        county,
        ahjSlug: report.ahj.slug,
      },
      source: ctx.source,
      occurred_at: new Date().toISOString(),
    });

    const result: IngestResult = {
      upid: upidResult.upid,
      propertyCreated: upidResult.created,
      permitEventsCreated: permitsCreated,
      violationEventsCreated: violationsCreated,
      durationMs: Date.now() - t0,
    };
    console.log(
      `[ledger] upid=${result.upid} created=${result.propertyCreated} ` +
        `permits=+${permitsCreated} violations=+${violationsCreated} dur=${result.durationMs}ms`,
    );
    return result;
  } catch (err) {
    console.error('[ledger] ingest failed (swallowed):', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal: bare-fetch PostgREST calls (no @supabase/supabase-js dependency).
// ---------------------------------------------------------------------------

interface Ctx {
  url: string;
  key: string;
  source: string;
}

interface UpidResult {
  upid: string;
  created: boolean;
}

async function resolveOrCreateProperty(
  ctx: Ctx,
  input: { county: County; folio: string; address: string; geom?: { lat: number; lng: number } },
): Promise<UpidResult> {
  const aliasNormalized = `${input.county}:${input.folio.replace(/[-\s.]/g, '').toLowerCase()}`;

  // Lookup existing alias
  const lookupRes = await pgrest(ctx, 'GET',
    `/property_aliases?select=property_id&alias_type=eq.folio&alias_normalized=eq.${encodeURIComponent(aliasNormalized)}&limit=1`,
  );
  const existing = await lookupRes.json();
  if (Array.isArray(existing) && existing.length > 0) {
    return { upid: existing[0].property_id, created: false };
  }

  // Create new property
  const createRes = await pgrest(ctx, 'POST', '/properties', {
    county: input.county,
    current_folio: input.folio,
    raw_address: input.address,
    normalized_address: normalizeAddress(input.address),
    ...(input.geom ? { geom: `POINT(${input.geom.lng} ${input.geom.lat})` } : {}),
  }, { Prefer: 'return=representation' });
  const created = await createRes.json();
  if (!Array.isArray(created) || created.length === 0) {
    throw new Error('property insert returned no row: ' + JSON.stringify(created));
  }
  const upid = created[0].upid;

  // Insert folio + address aliases
  await pgrest(ctx, 'POST', '/property_aliases', [
    {
      property_id: upid,
      alias_type: 'folio',
      alias_value: input.folio,
      alias_normalized: aliasNormalized,
      source: ctx.source,
    },
    {
      property_id: upid,
      alias_type: 'address',
      alias_value: input.address,
      alias_normalized: normalizeAddress(input.address),
      source: ctx.source,
    },
  ]);

  return { upid, created: true };
}

async function maybeRecordPermit(ctx: Ctx, upid: string, p: Permit): Promise<boolean> {
  // Dedup by permit_number for this property+source
  const lookupRes = await pgrest(ctx, 'GET',
    `/events?select=id&property_id=eq.${upid}&event_type=eq.permit.issued&source=eq.${ctx.source}&event_data->>permit_number=eq.${encodeURIComponent(p.permitNumber!)}&limit=1`,
  );
  const existing = await lookupRes.json();
  if (Array.isArray(existing) && existing.length > 0) return false;

  const issued = p.issueDate ? new Date(p.issueDate) : new Date();
  await postEvent(ctx, {
    property_id: upid,
    event_type: 'permit.issued',
    event_data: {
      permit_number: p.permitNumber,
      scope: p.scope ?? null,
      app_type: p.appType ?? null,
      status: p.status ?? null,
      contractor: p.contractor ?? null,
      est_value: p.estValue ?? null,
    },
    source: ctx.source,
    occurred_at: (isNaN(issued.getTime()) ? new Date() : issued).toISOString(),
  });
  return true;
}

async function maybeRecordViolation(
  ctx: Ctx, upid: string, c: CodeCase, isOpen: boolean,
): Promise<boolean> {
  const eventType = isOpen ? 'violation.opened' : 'violation.closed';
  const lookupRes = await pgrest(ctx, 'GET',
    `/events?select=id&property_id=eq.${upid}&event_type=eq.${eventType}&source=eq.${ctx.source}&event_data->>case_number=eq.${encodeURIComponent(c.caseNumber)}&limit=1`,
  );
  const existing = await lookupRes.json();
  if (Array.isArray(existing) && existing.length > 0) return false;

  const opened = c.caseDate ? new Date(c.caseDate) : new Date();
  await postEvent(ctx, {
    property_id: upid,
    event_type: eventType,
    event_data: {
      case_number: c.caseNumber,
      problem_description: c.problemDescription ?? null,
      status: c.status ?? null,
      last_action: c.lastAction ?? null,
      lien: c.lien ?? null,
    },
    source: ctx.source,
    occurred_at: (isNaN(opened.getTime()) ? new Date() : opened).toISOString(),
  });
  return true;
}

async function postEvent(ctx: Ctx, row: Record<string, unknown>): Promise<void> {
  const res = await pgrest(ctx, 'POST', '/events', row);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`event insert failed: ${res.status} ${body}`);
  }
}

async function pgrest(
  ctx: Ctx,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const url = ctx.url.replace(/\/$/, '') + '/rest/v1' + path;
  const res = await fetch(url, {
    method,
    headers: {
      apikey: ctx.key,
      Authorization: `Bearer ${ctx.key}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res;
}

function normalizeAddress(raw: string): string {
  if (!raw) return '';
  const map: Record<string, string> = {
    st: 'street', str: 'street', ave: 'avenue', av: 'avenue',
    blvd: 'boulevard', rd: 'road', dr: 'drive', ln: 'lane',
    ct: 'court', pl: 'place', ter: 'terrace', pkwy: 'parkway',
    hwy: 'highway', cir: 'circle', trl: 'trail',
    n: 'north', s: 'south', e: 'east', w: 'west',
    ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
  };
  return raw
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((tok, i) => (i === 0 || /^\d{5}(-\d{4})?$/.test(tok) ? tok : map[tok] ?? tok))
    .join(' ');
}
