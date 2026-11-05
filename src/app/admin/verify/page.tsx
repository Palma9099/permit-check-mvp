'use client';

import { useEffect, useState } from 'react';
import { VERIFIED_CHECKS } from '@/lib/verified-checks';

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
      const j = await call('/api/verified/publish', { record, checks, reviewer, roofYear, notes });
      setMsg({ tone: 'green', text: `Published. Valid until ${new Date(j.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.`, url: j.url });
    } catch (e: any) {
      setMsg({ tone: 'red', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const allOk = CHECKS.every((c) => checks[c.key]?.ok);
  const input = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm';

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
          <label className="mt-3 block text-sm font-semibold">
            Public note (optional)
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={`${input} mt-1`} />
          </label>
          <button
            type="button"
            disabled={busy || !allOk || !reviewer.trim()}
            onClick={publish}
            className="mt-4 rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            Publish Palma Verified
          </button>
          {!allOk && <div className="mt-2 text-xs text-ink-muted">Every check must be confirmed before publishing.</div>}
        </div>
      )}

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
