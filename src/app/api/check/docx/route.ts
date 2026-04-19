import { NextRequest } from 'next/server';
import { buildDocx } from '@/lib/docx-report';
import { runDiagnostic } from '@/lib/miami-dade';
import type { DiagnosticReport } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: Partial<DiagnosticReport> & { address?: string; folio?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  // Accept either a full report (from the UI re-submitting what it already fetched)
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
    const buf = await buildDocx(report);
    // Wrap in a Blob — always an acceptable BodyInit across Node / Edge / Browser
    // fetch, and avoids the Uint8Array<ArrayBufferLike> typing gotcha.
    const blob = new Blob([new Uint8Array(buf)], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const safe =
      (report.property.siteAddress ?? report.query.address ?? 'report')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return new Response(blob, {
      status: 200,
      headers: {
        'content-type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition': `attachment; filename="Permit_History_${safe}.docx"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err: any) {
    return new Response(`DOCX build failed: ${err?.message ?? 'unknown'}`, {
      status: 500,
    });
  }
}
