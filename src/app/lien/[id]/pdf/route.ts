import { NextRequest, NextResponse } from 'next/server';
import { getLienRecord } from '@/lib/lien-records';
import { lienSearchPdf } from '@/lib/pdf-lien-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The finished lien search as a PDF, from the saved record (never re-run, so
// it matches what was delivered).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const look = await getLienRecord(id);
  // 503, not 404: we do not know whether this search exists, and the client
  // fetching it is holding the old PDF. Saying "not found" would send them
  // back to that copy.
  if (!look.ok) {
    return NextResponse.json(
      {
        error: 'We could not load this lien search right now. This is not a statement about the search itself. Call us before you rely on any copy you hold.',
        call: '305-393-0690',
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
  const rec = look.record;
  // 410, not 404: this search existed and was withdrawn, and a client fetching
  // the PDF again is exactly the person who must be told the difference.
  if (rec && rec.status === 'revoked') {
    return NextResponse.json(
      {
        error: 'This lien search was withdrawn by Palma Building Solutions and must not be relied on.',
        withdrawn: rec.revoked_at ?? null,
        reason: rec.revoked_reason ?? null,
        replacedBy: rec.replaced_by ?? null,
        call: '305-393-0690',
      },
      { status: 410 },
    );
  }
  if (!rec || rec.status !== 'final') return NextResponse.json({ error: 'No lien search found for that link.' }, { status: 404 });
  const pdf = await lienSearchPdf(rec.search, {
    id: rec.id,
    reviewer: rec.reviewer,
    completedAt: rec.completed_at,
    staff: rec.staff,
    notes: rec.notes,
    client: rec.client,
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="Palma-lien-search-${rec.folio}-${rec.id}.pdf"`,
      'cache-control': 'private, no-store',
    },
  });
}
