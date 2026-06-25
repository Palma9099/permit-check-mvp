// Email delivery via Resend (same provider as palma-permit's lead notifier).

export async function sendEmail(to: string, subject: string, html: string, text: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Palma Property Intelligence <onboarding@resend.dev>';
  if (!key) throw new Error('RESEND_API_KEY is required to send results.');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  if (!res.ok) {
    throw new Error(`Resend send failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}
