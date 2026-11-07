'use client';

import { useEffect, useState } from 'react';
import type { LienSearch } from '@/lib/lien-search';
import LienSections from '../../lien-search/LienSections';

// Staff page: finish an ordered lien search. Load the folio (county part runs
// at once), check taxes, Official Records, utilities and any city letter by
// hand, then publish the final search and, if wanted, email the client its
// link. Needs the staff key (VERIFY_ADMIN_KEY), kept in this browser tab only.

type Answer = { result: '' | 'clear' | 'found'; amount: string; note: string };

// Where staff look each step up. Both pages need a person (captcha or bot check).
const LOOKUP: Record<string, (folio: string) => string> = {
  taxes: (f) => `https://miamidade.county-taxes.com/public/search/property_tax?search_query=${f}`,
  records: () => 'https://onlineservices.miamidadeclerk.gov/officialrecords/StandardSearch.aspx',
};

export default function LienAdmin() {
  const [key, setKey] = useState('');
  const [query, setQuery] = useState('');
  const [r, setR] = useState<LienSearch | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [client, setClient] = useState({ company: '', name: '', email: '', closingDate: '' });
  const [reviewer, setReviewer] = useState('');
  const [notes, setNotes] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  // Withdrawing a search already delivered. Separate from publishing on
  // purpose: it acts on a record id, not on whatever folio is loaded, so a
  // half-finished search on screen cannot be confused with the one being
  // pulled back.
  const [wd, setWd] = useState({ id: '', by: '', reason: '', replacedBy: '' });
  const [wdMsg, setWdMsg] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'red' | 'green'; text: string; url?: string; pdf?: string } | null>(null);

  useEffect(() => {
    try {
      setKey(sessionStorage.getItem('pv-key') ?? '');
    } catch {}
    // The order email links here with ?folio=.
    const f = new URLSearchParams(window.location.search).get('folio');
    if (f) setQuery(f);
  }, []);
  const saveKey = (k: string) => {
    setKey(k);
    try {
      sessionStorage.setItem('pv-key', k);
    } catch {}
  };

  async function load() {
    setMsg(null);
    setR(null);
    setBusy(true);
    try {
      const res = await fetch('/api/lien-search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `Error ${res.status}`);
      setR(j);
      setAnswers(Object.fromEntries((j as LienSearch).staffSteps.map((s) => [s.key, { result: '', amount: '', note: '' }])));
    } catch (e: any) {
      setMsg({ tone: 'red', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!r) return;
    setMsg(null);
    setBusy(true);
    try {
      const res = await fetch('/api/lien-search/finish', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-key': key },
        body: JSON.stringify({ folio: r.folio, staff: answers, reviewer, client, notes, sendEmail }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `Error ${res.status}`);
      setMsg({
        tone: 'green',
        text: `Published. ${j.found ? `${j.found} item${j.found > 1 ? 's' : ''} to resolve.` : 'Clear.'} ${j.emailed ? `Emailed to ${j.emailed}.` : sendEmail ? 'Not emailed: check the client email.' : 'Not emailed.'}`,
        url: j.url,
        pdf: j.pdf,
      });
    } catch (e: any) {
      setMsg({ tone: 'red', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setWdMsg(null);
    setBusy(true);
    try {
      const res = await fetch('/api/lien-search/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-key': key },
        body: JSON.stringify({ id: wd.id.trim().toUpperCase(), by: wd.by, reason: wd.reason, replacedBy: wd.replacedBy.trim().toUpperCase() || null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `Error ${res.status}`);
      setWdMsg({
        tone: 'green',
        text: `${j.id} withdrawn. The client page and the PDF now say so.${j.client ? ` Ring or email ${j.client}: they are holding the old PDF.` : ' No client email on the record, so tell them another way.'}`,
      });
      setWd({ id: '', by: '', reason: '', replacedBy: '' });
    } catch (e: any) {
      setWdMsg({ tone: 'red', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const set = (k: string, patch: Partial<Answer>) => setAnswers((a) => ({ ...a, [k]: { ...a[k], ...patch } }));
  const allAnswered = !!r && r.staffSteps.every((s) => answers[s.key]?.result);
  const input = 'w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm';

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#b8893b]">Palma staff</div>
      <h1 className="font-serif text-3xl font-semibold">Lien search: finish and send</h1>

      <div className="mt-6 space-y-3 rounded-2xl bg-white p-5 ring-1 ring-black/10">
        <label className="block text-sm font-semibold">
          Staff key
          <input type="password" autoComplete="off" value={key} onChange={(e) => saveKey(e.target.value)} className={`${input} mt-1`} />
        </label>
        <label className="block text-sm font-semibold">
          Folio or address
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="30-4926-002-1120" className={`${input} mt-1`} />
        </label>
        <button type="button" disabled={busy || !query.trim()} onClick={load} className="rounded-full bg-[#1f3864] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {busy && !r ? 'Searching…' : 'Load'}
        </button>
      </div>

      {r && (
        <div className="mt-6 space-y-6">
          <div className="rounded-2xl bg-white p-5 ring-1 ring-black/10">
            <div className="font-serif text-2xl font-semibold">{r.address}</div>
            <div className="text-sm text-ink-muted">
              Folio {r.prettyFolio} · {r.owner ?? 'Owner not shown'} · {r.municipality}
            </div>
            <div className={`mt-3 rounded-lg px-4 py-2 text-sm font-semibold ${r.failed ? 'bg-amber-50 text-amber-900' : r.found ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>
              County records: {r.failed ? `${r.failed} source(s) did not answer. Reload before publishing.` : r.found ? `${r.found} item(s) found.` : 'clear.'}
            </div>
          </div>

          <LienSections sections={r.sections} />

          <div className="rounded-2xl bg-white p-5 ring-1 ring-black/10">
            <h2 className="font-serif text-xl font-semibold">Staff checks</h2>
            <p className="text-sm text-ink-muted">Look each one up, then mark it. A found item needs the amount or a note.</p>
            <div className="mt-4 space-y-4">
              {r.staffSteps.map((s) => {
                const a = answers[s.key] ?? { result: '', amount: '', note: '' };
                const link = LOOKUP[s.key]?.(r.folio);
                return (
                  <div key={s.key} className="rounded-xl p-4 ring-1 ring-black/10">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold">{s.title}</div>
                        <div className="text-xs text-ink-muted">{s.how}</div>
                      </div>
                      {link && (
                        <a href={link} target="_blank" rel="noreferrer" className="text-xs font-semibold text-[#1f3864] underline">
                          Open source
                        </a>
                      )}
                    </div>
                    <div className="mt-3 flex gap-2" role="group" aria-label={`${s.title} result`}>
                      {(['clear', 'found'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          aria-pressed={a.result === v}
                          onClick={() => set(s.key, { result: v })}
                          className={`rounded-full px-4 py-1.5 text-sm font-semibold ring-1 ${
                            a.result === v ? (v === 'clear' ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-red-600 text-white ring-red-600') : 'bg-white ring-black/15'
                          }`}
                        >
                          {v === 'clear' ? 'Clear' : 'Found'}
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-[10rem,1fr]">
                      <input value={a.amount} onChange={(e) => set(s.key, { amount: e.target.value })} placeholder="Amount, e.g. $1,284.16" className={input} />
                      <input value={a.note} onChange={(e) => set(s.key, { note: e.target.value })} placeholder="Note shown to the client" className={input} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 ring-1 ring-black/10">
            <h2 className="font-serif text-xl font-semibold">Client and sign-off</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['company', 'Title company'],
                  ['name', 'Contact name'],
                  ['email', 'Client email'],
                  ['closingDate', 'Closing date'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="block text-sm font-semibold">
                  {label}
                  <input
                    type={k === 'closingDate' ? 'date' : k === 'email' ? 'email' : 'text'}
                    value={client[k]}
                    onChange={(e) => setClient({ ...client, [k]: e.target.value })}
                    className={`${input} mt-1`}
                  />
                </label>
              ))}
              <label className="block text-sm font-semibold">
                Reviewer name
                <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} className={`${input} mt-1`} />
              </label>
            </div>
            <label className="mt-3 block text-sm font-semibold">
              Notes for the client (optional)
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={`${input} mt-1`} />
            </label>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
              Email the link to the client when published
            </label>
            <button
              type="button"
              disabled={busy || !key || !allAnswered || !reviewer.trim() || r.failed > 0}
              onClick={publish}
              className="mt-4 rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? 'Publishing…' : 'Publish final search'}
            </button>
            {!allAnswered && <div className="mt-2 text-xs text-ink-muted">Mark every staff check before publishing.</div>}
          </div>
        </div>
      )}

      <div className="mt-10 rounded-2xl bg-white p-5 ring-1 ring-red-200">
        <h2 className="font-serif text-xl font-semibold text-[#7f1d1d]">Withdraw a delivered search</h2>
        <p className="text-sm text-ink-muted">
          For a search already sent out that turns out to be wrong. The client page and the PDF stop showing it and say
          it was withdrawn. The record is kept, never deleted. The client is holding the old PDF, so call them too.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold">
            Record id
            <input value={wd.id} onChange={(e) => setWd({ ...wd, id: e.target.value })} placeholder="LS-7K3Q9X2M4P" className={`${input} mt-1`} />
          </label>
          <label className="block text-sm font-semibold">
            Withdrawn by
            <input value={wd.by} onChange={(e) => setWd({ ...wd, by: e.target.value })} placeholder="Your name" className={`${input} mt-1`} />
          </label>
        </div>
        <label className="mt-3 block text-sm font-semibold">
          Reason, in a sentence the client can act on (they see this)
          <textarea
            value={wd.reason}
            onChange={(e) => setWd({ ...wd, reason: e.target.value })}
            rows={2}
            placeholder="A code lien recorded on 10/14/2026 was missed. A corrected search follows today."
            className={`${input} mt-1`}
          />
        </label>
        <label className="mt-3 block text-sm font-semibold">
          Replaced by (optional, the corrected search's id)
          <input value={wd.replacedBy} onChange={(e) => setWd({ ...wd, replacedBy: e.target.value })} placeholder="LS-…" className={`${input} mt-1`} />
        </label>
        <button
          type="button"
          disabled={busy || !key || !wd.id.trim() || !wd.by.trim() || wd.reason.trim().length < 12}
          onClick={withdraw}
          className="mt-4 rounded-full bg-[#7f1d1d] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? 'Withdrawing…' : 'Withdraw this search'}
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
            <>
              <a href={msg.url} target="_blank" rel="noreferrer" className="font-semibold underline">
                Open the search
              </a>{' '}
              ·{' '}
              <a href={msg.pdf} target="_blank" rel="noreferrer" className="font-semibold underline">
                PDF
              </a>
            </>
          )}
        </div>
      )}
    </main>
  );
}
