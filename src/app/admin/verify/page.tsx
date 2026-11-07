'use client';

import { useEffect, useState } from 'react';
import { TIERS, VERIFIED_CHECKS, type Tier } from '@/lib/verified-checks';

// Staff page: a Palma reviewer checks a home and publishes its Palma Verified
// record. Needs the staff key (VERIFY_ADMIN_KEY), kept in this browser tab only.

const CHECKS = VERIFIED_CHECKS;

type Prefill = { address: string; folio: string; score: number; band: string; checkedAt: string; floodZone: string | null; roof: string | null; toResolve: string[] };

export default function VerifyAdmin() {
  const [key, setKey] = useState('');
  const [record, setRecord] = useState('');
  const [pre, setPre] = useState<Prefill | null>(null);
  const [checks, setChecks] = useState<Record<string, { ok: boolean; note: string }>>({});
  const [reviewer, setReviewer] = useState('');
  const [roofYear, setRoofYear] = useState('');
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string; url?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tier, setTier] = useState<Tier>('premium');
  // Withdrawing a published record. Keyed on the record id, not on whatever is
  // loaded above, so a half-finished review cannot be confused with the record
  // being pulled back.
  const [wd, setWd] = useState({ id: '', by: '', reason: '' });
  const [wdMsg, setWdMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);

  useEffect(() => {
    try {
      setKey(sessionStorage.getItem('pv-key') ?? '');
    } catch {}
  }, []);
  const saveKey = (k: string) => {
    setKey(k);
    try {
      sessionStorage.setItem('pv-key', k);
    } catch {}
  };

  async function call(path: string, body: unknown) {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': key }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error ?? `Error ${res.status}`);
    return j;
  }

  async function load() {
    setMsg(null);
    setBusy(true);
    try {
      setPre(await call('/api/verified/prefill', { record }));
      setChecks({});
    } catch (e: any) {
      setPre(null);
      setMsg({ tone: 'red', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setMsg(null);
    setBusy(true);
    try {
      const j = await call('/api/verified/publish', { tier, record, checks, reviewer, roofYear, notes });
      setMsg({ tone: 'green', text: `Published. Valid until ${new Date(j.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.`, url: j.url });
    } catch (e: any) {
      setMsg({ tone: 'red', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const allOk = tier === 'instant' || CHECKS.every((c) => checks[c.key]?.ok);
  const input = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm';

  async function withdraw() {
    setWdMsg(null);
    setBusy(true);
    try {
      const res = await fetch('/api/verified/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-key': key },
        body: JSON.stringify({ id: wd.id.trim().toUpperCase(), by: wd.by, reason: wd.reason }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `Error ${res.status}`);
      setWdMsg({ tone: 'green', text: `${j.id} withdrawn. The seal and the listing badge clear within a minute. ${j.note}` });
      setWd({ id: '', by: '', reason: '' });
    } catch (e: any) {
      setWdMsg({ tone: 'red', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#b8893b]">Palma staff</div>
      <h1 className="font-serif text-3xl font-semibold">Palma Verified review</h1>

      <div className="mt-6 space-y-3 rounded-2xl bg-white p-5 ring-1 ring-black/10">
        <label className="block text-sm font-semibold">
          Staff key
          <input type="password" autoComplete="off" value={key} onChange={(e) => saveKey(e.target.value)} className={`${input} mt-1`} />
        </label>
        <label className="block text-sm font-semibold">
          Report record link
          <input value={record} onChange={(e) => setRecord(e.target.value)} placeholder="https://.../record/..." className={`${input} mt-1`} />
        </label>
        <button type="button" disabled={busy || !key || !record} onClick={load} className="rounded-full bg-[#1f3864] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">
          Load
        </button>
      </div>

      {pre && (
        <div className="mt-6 rounded-2xl bg-white p-5 ring-1 ring-black/10">
          <div className="font-serif text-2xl font-semibold">{pre.address}</div>
          <div className="text-sm text-ink-muted">
            Folio {pre.folio} · Score {pre.score} ({pre.band}) · Checked {new Date(pre.checkedAt).toLocaleDateString()}
          </div>
          {pre.toResolve.length > 0 && (
            <div className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="font-semibold">The report lists these to resolve:</div>
              <ul className="ml-5 list-disc">
                {pre.toResolve.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5 flex gap-2" role="group" aria-label="Tier">
            {(['instant', 'premium'] as Tier[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                aria-pressed={tier === t}
                className={`flex-1 rounded-xl px-4 py-3 text-left ring-1 ${tier === t ? 'bg-[#1f3864] text-white ring-[#1f3864]' : 'bg-white ring-black/15'}`}
              >
                <span className="block text-sm font-semibold">
                  {TIERS[t].name} · {TIERS[t].price}
                </span>
                <span className={`block text-xs ${tier === t ? 'text-white/80' : 'text-ink-muted'}`}>{TIERS[t].blurb}</span>
              </button>
            ))}
          </div>

          {tier === 'premium' && (
          <ul className="mt-5 space-y-3">
            {CHECKS.map((c) => (
              <li key={c.key} className="rounded-lg border border-black/10 p-3">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={!!checks[c.key]?.ok}
                    onChange={(e) => setChecks((s) => ({ ...s, [c.key]: { ok: e.target.checked, note: s[c.key]?.note ?? '' } }))}
                  />
                  <span>
                    <span className="block text-sm font-semibold">{c.label}</span>
                    <span className="block text-xs text-ink-muted">{c.help}</span>
                  </span>
                </label>
                <input
                  value={checks[c.key]?.note ?? ''}
                  onChange={(e) => setChecks((s) => ({ ...s, [c.key]: { ok: s[c.key]?.ok ?? false, note: e.target.value } }))}
                  placeholder="Note (optional, shown on the record)"
                  className={`${input} mt-2`}
                />
              </li>
            ))}
          </ul>
          )}

          {tier === 'premium' && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold">
              Reviewer name
              <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} className={`${input} mt-1`} />
            </label>
            <label className="block text-sm font-semibold">
              Roof year (if known)
              <input value={roofYear} onChange={(e) => setRoofYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="e.g. 2016" className={`${input} mt-1`} />
            </label>
          </div>
          )}
          <label className="mt-3 block text-sm font-semibold">
            Public note (optional)
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={`${input} mt-1`} />
          </label>
          <button
            type="button"
            disabled={busy || !allOk || (tier === 'premium' && !reviewer.trim())}
            onClick={publish}
            className="mt-4 rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            Publish {TIERS[tier].name}
          </button>
          {!allOk && <div className="mt-2 text-xs text-ink-muted">Every check must be confirmed before publishing.</div>}
        </div>
      )}

      <div className="mt-10 rounded-2xl bg-white p-5 ring-1 ring-red-200">
        <h2 className="font-serif text-xl font-semibold text-[#7f1d1d]">Withdraw a published record</h2>
        <p className="text-sm text-ink-muted">
          For a Verified or Checked record that turns out to be wrong. The seal greys out, the listing badge clears
          within a minute, the folio stops returning it, and the public page says it was withdrawn rather than
          expired. The record is kept, never deleted.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold">
            Record id
            <input value={wd.id} onChange={(e) => setWd({ ...wd, id: e.target.value })} placeholder="PV-7K3Q9X2" className={`${input} mt-1`} />
          </label>
          <label className="block text-sm font-semibold">
            Withdrawn by
            <input value={wd.by} onChange={(e) => setWd({ ...wd, by: e.target.value })} placeholder="Your name" className={`${input} mt-1`} />
          </label>
        </div>
        <label className="mt-3 block text-sm font-semibold">
          Reason, in a sentence (shown publicly on the record page)
          <textarea
            value={wd.reason}
            onChange={(e) => setWd({ ...wd, reason: e.target.value })}
            rows={2}
            placeholder="A 2019 roof permit was finalled under a different folio; the roof age shown here is wrong."
            className={`${input} mt-1`}
          />
        </label>
        <button
          type="button"
          disabled={busy || !key || !wd.id.trim() || !wd.by.trim() || wd.reason.trim().length < 12}
          onClick={withdraw}
          className="mt-4 rounded-full bg-[#7f1d1d] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? 'Withdrawing…' : 'Withdraw this record'}
        </button>
        {wdMsg && (
          <div className={`mt-3 rounded-lg px-4 py-3 text-sm ${wdMsg.tone === 'green' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>
            {wdMsg.text}
          </div>
        )}
      </div>

      {msg && (
        <div className={`mt-6 rounded-lg px-4 py-3 text-sm ${msg.tone === 'green' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>
          {msg.text}{' '}
          {msg.url && (
            <a href={msg.url} target="_blank" rel="noreferrer" className="font-semibold underline">
              Open the Verified page
            </a>
          )}
        </div>
      )}
    </main>
  );
}
