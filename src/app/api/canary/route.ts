import { NextRequest, NextResponse } from 'next/server';
import { runCanary } from '@/lib/canary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Nightly upstream-schema canary. Runs the real property code paths at known
// fixtures (see lib/canary.ts) and emails office@palma.llc ONLY when something
// fails - so a green run is silent and a broken county gets caught before users
// see blank reports.
//
// Triggered by Vercel Cron (see vercel.json). When CRON_SECRET is set in the
// project env, Vercel sends it as `Authorization: Bearer <CRON_SECRET>` and we
// require it - so the endpoint can't be spammed publicly. Manual runs: hit
// /api/canary with that same header.

const ALERT_TO = process.env.LEAD_TO || 'office@palma.llc';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const checks = await runCanary();
  const failed = checks.filter((c) => !c.ok);

  if (failed.length > 0) {
    await sendAlert(failed, checks).catch((e) =>
      console.error('[api/canary] alert email failed:', String(e?.message ?? e)),
    );
  }

  console.log(
    `[api/canary] ${checks.length - failed.length}/${checks.length} ok` +
      (failed.length ? ` - FAILED: ${failed.map((f) => f.name).join(', ')}` : ''),
  );

  return NextResponse.json(
    {
      ok: failed.length === 0,
      ranAt: new Date().toISOString(),
      passed: checks.length - failed.length,
      total: checks.length,
      checks,
    },
    { status: failed.length ? 500 : 200 },
  );
}

async function sendAlert(failed: { name: string; detail: string }[], all: { name: string; ok: boolean; detail: string }[]) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error('[api/canary] would alert but RESEND_API_KEY is not set');
    return;
  }
  const from = process.env.RESEND_FROM || 'Palma Building Solutions <notifications@send.palma.llc>';

  const text = [
    `permit-check canary FAILED: ${failed.length} of ${all.length} data-source check(s) are broken.`,
    '',
    'This usually means a county changed an ArcGIS field name and property data is',
    'now coming back blank in reports for that county. Failed checks:',
    '',
    ...failed.map((f) => `  ✗ ${f.name}\n      ${f.detail}`),
    '',
    'Full run:',
    ...all.map((c) => `  ${c.ok ? 'ok ' : 'XX '} ${c.name} - ${c.detail}`),
  ].join('\n');

  const html = `<div style="font-family:system-ui,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1b1813">
    <p><strong>permit-check canary FAILED</strong> - ${failed.length} of ${all.length} data-source check(s) are broken.</p>
    <p>This usually means a county changed an ArcGIS field name and property data is coming back blank in reports for that county.</p>
    <p><strong>Failed:</strong></p>
    <ul>${failed.map((f) => `<li><strong>${esc(f.name)}</strong><br><code>${esc(f.detail)}</code></li>`).join('')}</ul>
    <p><strong>Full run:</strong></p>
    <ul>${all.map((c) => `<li>${c.ok ? '✅' : '❌'} ${esc(c.name)} - <code>${esc(c.detail)}</code></li>`).join('')}</ul>
  </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: ALERT_TO,
      subject: `⚠️ permit-check canary: ${failed.length} data source(s) broken`,
      text,
      html,
    }),
  });
  if (!res.ok) {
    console.error('[api/canary] Resend failed:', res.status, (await res.text()).slice(0, 300));
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
