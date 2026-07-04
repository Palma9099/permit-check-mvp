'use client';

import { useState } from 'react';

// In-tool lead capture. Turns an anonymous report view into a contact by
// emailing office@palma.llc (via /api/lead → Resend). Non-blocking: the whole
// report is already visible above; this is the "have Palma take it from here"
// step. Falls back to the phone number if email delivery isn't configured.

export default function LeadCapture({
  address,
  summary,
}: {
  address?: string | null;
  summary?: string | null;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle');
  const [errMsg, setErrMsg] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrMsg('');
    const emailOk = /.+@.+\..+/.test(email.trim());
    if (!emailOk && !phone.trim()) {
      setStatus('err');
      setErrMsg('Enter a valid email or a phone number so we can reach you.');
      return;
    }
    setStatus('sending');
    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          address: address ?? '',
          message: message.trim(),
          summary: summary ?? '',
        }),
      });
      if (res.ok) {
        try {
          // Fire a GA4 conversion if analytics is present on the page.
          (window as any).gtag?.('event', 'generate_lead', { source: 'permit_check_tool' });
        } catch {
          /* no-op */
        }
        setStatus('ok');
        return;
      }
      const data = await res.json().catch(() => null);
      setStatus('err');
      setErrMsg(data?.message || "We couldn't send that just now. Please call 305-393-0690.");
    } catch {
      setStatus('err');
      setErrMsg('Network error. Please call 305-393-0690.');
    }
  }

  if (status === 'ok') {
    return (
      <div className="rounded-lg bg-gradient-to-br from-[#1f3864] to-[#102447] text-white px-6 py-7 sm:px-8">
        <h3 className="font-serif text-xl sm:text-2xl font-semibold !text-white">Thanks — we've got it.</h3>
        <p className="mt-2 text-sm !text-white/90 max-w-2xl">
          A Palma specialist will review your results and reach out shortly. Need us sooner? Call{' '}
          <a href="tel:+13053930690" className="underline font-semibold !text-white">305-393-0690</a>.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-gradient-to-br from-[#1f3864] to-[#102447] text-white px-6 py-6 sm:px-8 sm:py-7">
      <h3 className="font-serif text-xl sm:text-2xl font-semibold leading-snug !text-white">
        Want Palma to take it from here?
      </h3>
      <p className="mt-2 text-sm !text-white/90 max-w-2xl">
        Send us your info and we'll review this report, map the exact fix, and connect you with
        licensed Florida pros — after-the-fact permits, expired-permit closeouts, and violation
        resolution, from first call to final sign-off. No obligation.
      </p>

      <form onSubmit={submit} className="mt-4 grid gap-3 max-w-2xl" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            autoComplete="name"
            className="w-full rounded-md px-3 py-2.5 text-sm text-[#102447] bg-white placeholder-slate-400 outline-none"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone"
            type="tel"
            autoComplete="tel"
            className="w-full rounded-md px-3 py-2.5 text-sm text-[#102447] bg-white placeholder-slate-400 outline-none"
          />
        </div>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          type="email"
          autoComplete="email"
          className="w-full rounded-md px-3 py-2.5 text-sm text-[#102447] bg-white placeholder-slate-400 outline-none"
        />
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Anything we should know? (optional)"
          rows={2}
          className="w-full rounded-md px-3 py-2.5 text-sm text-[#102447] bg-white placeholder-slate-400 outline-none resize-y"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={status === 'sending'}
            className="px-5 py-2.5 rounded-md bg-white text-[#102447] text-sm font-semibold hover:bg-white/90 disabled:opacity-60"
          >
            {status === 'sending' ? 'Sending…' : 'Send my info to Palma'}
          </button>
          <span className="text-sm !text-white/80">
            or call{' '}
            <a href="tel:+13053930690" className="underline font-semibold !text-white">305-393-0690</a>
          </span>
        </div>
        {status === 'err' && errMsg && (
          <p className="text-sm !text-amber-200" role="status">{errMsg}</p>
        )}
        <p className="text-xs !text-white/60">
          We only use this to contact you about your property. No spam.
        </p>
      </form>
    </div>
  );
}
