import { NextRequest, NextResponse } from 'next/server';
import { adminKeyOk } from '@/lib/verified';
import { compactFolio } from '@/lib/miami-dade-raw';
import { runLienSearch } from '@/lib/lien-search';
import { publishLienRecord, recordFound, type StaffResult } from '@/lib/lien-records';
import { SITE_ORIGIN } from '@/lib/record-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const clean = (v: unknown, max = 240) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '') || null;

// Staff only: finish a lien search. The county part is re-run here, so the
// delivered record is fresh and cannot be edited in the browser; every staff
// step must be answered; nothing is published while a county source is down.
export async function POST(req: NextRequest) {
  if (!adminKeyOk(req.headers.get('x-admin-key'))) return NextResponse.json({ error: 'Staff key required.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const digits = String(body?.folio ?? '').replace(/\D+/g, '');
  if (digits.length < 12 || digits.length > 13) return NextResponse.json({ error: 'A 13-digit folio is required.' }, { status: 400 });
  const reviewer = clean(body?.reviewer, 80);
  if (!reviewer) return NextResponse.json({ error: 'Add the reviewer name.' }, { status: 400 });

  const search = await runLienSearch(compactFolio(digits));
  if (!search.address) return NextResponse.json({ error: 'No Miami-Dade parcel found for that folio.' }, { status: 404 });
  if (search.failed) {
    return NextResponse.json({ error: 'A county source did not answer just now, so the search cannot be finished. Try again in a few minutes.' }, { status: 503 });
  }

  const given = (body?.staff ?? {}) as Record<string, { result?: string; amount?: string; note?: string }>;
  const staff: StaffResult[] = search.staffSteps.map((s) => ({
    key: s.key,
    title: s.title,
    result: given[s.key]?.result === 'found' ? 'found' : given[s.key]?.result === 'clear' ? 'clear' : (null as any),
    amount: clean(given[s.key]?.amount, 40),
    note: clean(given[s.key]?.note),
  }));
  const missing = staff.filter((s) => !s.result).map((s) => s.title);
  if (missing.length) return NextResponse.json({ error: `Answer every staff check: ${missing.join(', ')}.` }, { status: 400 });
  const unexplained = staff.filter((s) => s.result === 'found' && !s.amount && !s.note).map((s) => s.title);
  if (unexplained.length) return NextResponse.json({ error: `Add the amount or a note for: ${unexplained.join(', ')}.` }, { status: 400 });

  const email = clean(body?.client?.email, 200);
  const client = {
    company: clean(body?.client?.company, 120),
    name: clean(body?.client?.name, 120),
    email: email && /.+@.+\..+/.test(email) ? email : null,
    closingDate: clean(body?.client?.closingDate, 20),
  };

  let rec;
  try {
    rec = await publishLienRecord({
      folio: search.folio,
      address: search.address,
      searched_at: search.searchedAt,
      reviewer,
      client,
      search,
      staff,
      notes: clean(body?.notes, 1000),
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
  const url = `${SITE_ORIGIN}/lien/${rec.id}`;

  // Optional: email the link to the client from the same verified sender the
  // lead form uses.
  let emailed: string | null = null;
  if (body?.sendEmail === true && client.email && process.env.RESEND_API_KEY) {
    const from = process.env.RESEND_FROM || 'Palma Building Solutions <notifications@send.palma.llc>';
    const n = recordFound(rec);
    const text = [
      `Your Miami-Dade lien search for ${search.address.split(',')[0]} (folio ${search.prettyFolio}) is ready.`,
      n ? `${n} item${n > 1 ? 's' : ''} found. Details and Official Records references are in the search.` : 'Nothing found to resolve.',
      '',
      `View it: ${url}`,
      `PDF: ${url}/pdf`,
      '',
      `Completed by ${reviewer}, Palma Building Solutions.`,
    ].join('\n');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: client.email, reply_to: process.env.LEAD_TO || 'office@palma.llc', subject: `Lien search: ${search.address.split(',')[0]}`, text }),
    }).catch(() => null);
    if (res?.ok) emailed = client.email;
  }

  return NextResponse.json({ id: rec.id, url, pdf: `${url}/pdf`, found: recordFound(rec), emailed });
}
