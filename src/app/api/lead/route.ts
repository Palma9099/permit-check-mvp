import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Lead capture from the free permit-check tool. Someone runs a report, then asks
// Palma to review it / send them a copy — this turns anonymous tool usage into a
// contact by emailing office@palma.llc via Resend (same provider the worker and
// the main-site lead forms use). Same-origin, so no CORS gymnastics.
//
// Env required (Vercel project): RESEND_API_KEY, RESEND_FROM. If they're missing
// the route returns a 503 with a friendly message and the client falls back to
// the phone number — the tool never breaks.

const LEAD_TO = process.env.LEAD_TO || 'office@palma.llc';
const MAX_FIELD = 4000;

function clean(v: unknown, max = 400): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

export async function POST(req: NextRequest) {
  let body: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
    message?: string;
    summary?: string; // short machine summary of what the tool found (optional)
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }

  const name = clean(body.name);
  const email = clean(body.email, 200);
  const phone = clean(body.phone, 40);
  const address = clean(body.address);
  const message = clean(body.message, MAX_FIELD);
  const summary = clean(body.summary, MAX_FIELD);

  // Need at least an email or a phone to be a usable lead.
  const emailValid = /.+@.+\..+/.test(email);
  if (!emailValid && !phone) {
    return NextResponse.json(
      { error: 'Enter a valid email or a phone number so we can reach you.' },
      { status: 400 },
    );
  }

  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Palma Property Intelligence <reports@palma.llc>';
  if (!key) {
    // Not configured — don't pretend it worked. Client shows the phone fallback.
    return NextResponse.json(
      { error: 'notconfigured', message: 'Lead email is not configured yet. Please call 305-393-0690.' },
      { status: 503 },
    );
  }

  const lines = [
    'New lead from the free permit-check tool (tools.palma.llc):',
    '',
    `Name:    ${name || '—'}`,
    `Email:   ${emailValid ? email : '—'}`,
    `Phone:   ${phone || '—'}`,
    `Address: ${address || '—'}`,
    '',
    'Message:',
    message || '(none)',
    '',
    summary ? 'What the tool found:' : '',
    summary || '',
  ].filter((l) => l !== null);
  const text = lines.join('\n');
  const html = `<div style="font-family:system-ui,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1b1813">
    <p><strong>New lead from the free permit-check tool</strong> (tools.palma.llc):</p>
    <table cellpadding="4" style="border-collapse:collapse">
      <tr><td><strong>Name</strong></td><td>${escapeHtml(name) || '—'}</td></tr>
      <tr><td><strong>Email</strong></td><td>${emailValid ? escapeHtml(email) : '—'}</td></tr>
      <tr><td><strong>Phone</strong></td><td>${escapeHtml(phone) || '—'}</td></tr>
      <tr><td><strong>Address</strong></td><td>${escapeHtml(address) || '—'}</td></tr>
    </table>
    ${message ? `<p><strong>Message:</strong><br>${escapeHtml(message)}</p>` : ''}
    ${summary ? `<p><strong>What the tool found:</strong><br>${escapeHtml(summary)}</p>` : ''}
  </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: LEAD_TO,
        subject: `New permit-check lead${name ? ` — ${name}` : ''}${address ? ` (${address})` : ''}`,
        ...(emailValid ? { reply_to: email } : {}),
        text,
        html,
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      console.error('[api/lead] Resend failed:', res.status, detail);
      return NextResponse.json(
        { error: 'sendfailed', message: "We couldn't send that just now. Please call 305-393-0690." },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[api/lead] error:', String(err?.message ?? err));
    return NextResponse.json(
      { error: 'sendfailed', message: "We couldn't send that just now. Please call 305-393-0690." },
      { status: 502 },
    );
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
