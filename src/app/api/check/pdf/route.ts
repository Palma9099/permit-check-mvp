import { NextRequest } from 'next/server';
import { buildPdf } from '@/lib/pdf-report';
import { buildPdfV2 } from '@/lib/pdf-report-v2';
import { parsePersona } from '@/lib/persona';
import { runDiagnostic } from '@/lib/orchestrator';
import type { DiagnosticReport, VisionObservation } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Older Street View photos the browser found. Only Google's Street View image
// address is accepted, so this cannot be used to make the server fetch anything else.
function cleanStreetHistory(v: unknown): Array<{ imageUrl: string; label: string }> {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, 6)
    .filter(
      (f): f is { imageUrl: string; label: string } =>
        !!f && typeof f.imageUrl === 'string' && typeof f.label === 'string' && f.imageUrl.startsWith('https://maps.googleapis.com/maps/api/streetview?'),
    )
    .map((f) => ({ imageUrl: f.imageUrl, label: f.label.slice(0, 40) }));
}

// Street View findings the browser got back from /api/street-compare. Text only,
// capped, and only flagged items, since they go on the PDF as findings.
function cleanFindings(v: unknown): VisionObservation[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, 8)
    .filter((o: any) => o && typeof o.area === 'string' && typeof o.whatWeSaw === 'string' && o.severity === 'flag')
    .map((o: any) => ({
      area: o.area.slice(0, 40),
      whatWeSaw: o.whatWeSaw.slice(0, 300),
      vsPermitRecord: typeof o.vsPermitRecord === 'string' ? o.vsPermitRecord.slice(0, 200) : '',
      severity: 'flag' as const,
    }));
}

export async function POST(req: NextRequest) {
  let body: Partial<DiagnosticReport> & { address?: string; folio?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  // Accept either a full report (UI resubmitting what it already fetched)
  // or a short { address } / { folio } request, in which case we regenerate.
  let report: DiagnosticReport;
  if (body && (body as DiagnosticReport).flags && (body as DiagnosticReport).property) {
    report = body as DiagnosticReport;
  } else if (body.address || body.folio) {
    try {
      report = await runDiagnostic({ address: body.address, folio: body.folio });
    } catch (err: any) {
      return new Response(err?.message ?? 'Diagnostic failed', { status: 500 });
    }
  } else {
    return new Response(
      'POST a DiagnosticReport object, or { address } / { folio } to regenerate.',
      { status: 400 },
    );
  }

  try {
    // New designed layout first; the original builder is the safety net so a
    // download never fails because of the new layout.
    let buf: Buffer;
    try {
      buf = await buildPdfV2(report, {
        role: parsePersona((body as { role?: unknown }).role),
        streetHistory: cleanStreetHistory((body as { streetHistory?: unknown }).streetHistory),
        streetFindings: cleanFindings((body as { streetFindings?: unknown }).streetFindings),
      });
    } catch (err) {
      console.error('[pdf] v2 failed, falling back to v1', err);
      buf = await buildPdf(report);
    }
    const blob = new Blob([new Uint8Array(buf)], { type: 'application/pdf' });
    const safe =
      (report.property.siteAddress ?? report.query.address ?? 'report')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return new Response(blob, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="Permit_History_${safe}.pdf"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err: any) {
    return new Response(`PDF build failed: ${err?.message ?? 'unknown'}`, {
      status: 500,
    });
  }
}
