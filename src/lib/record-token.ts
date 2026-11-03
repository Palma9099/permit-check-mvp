// Shareable property record link. No database: the record's key facts are
// packed into the link itself and signed, so the link can be checked later
// without storing anything. Tampering breaks the signature. Links carry a
// date and read as expired after RECORD_DAYS, because county records change.
//
// Signing secret: RECORD_SIGNING_SECRET, falling back to SUPABASE_SECRET_KEY
// (server only). With neither set the feature switches itself off.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { DiagnosticReport } from './types';
import { buildGlance } from './glance';
import { buildFixIts } from './fix-it';
import { computeReadiness } from './readiness';

export const RECORD_DAYS = 30;
export const SITE_ORIGIN = process.env.NEXT_PUBLIC_SITE_ORIGIN || 'https://permit-check-mvp.vercel.app';

export interface RecordPayload {
  a: string; // address
  f: string; // folio
  t: number; // checked at, epoch seconds
  s: number; // closing readiness score
  b: string; // band label
  i: Array<[string, string, string, string]>; // [label, tone letter, value, detail]
  x: string[]; // titles of things to resolve
}

const TONE_CODE: Record<string, string> = { red: 'r', amber: 'a', green: 'g', grey: 'n' };
const CODE_TONE: Record<string, 'red' | 'amber' | 'green' | 'grey'> = { r: 'red', a: 'amber', g: 'green', n: 'grey' };
export const toneFromCode = (c: string) => CODE_TONE[c] ?? 'grey';

function secret(): string | null {
  return process.env.RECORD_SIGNING_SECRET || process.env.SUPABASE_SECRET_KEY || null;
}

const b64 = (b: Buffer) => b.toString('base64url');
const sign = (part: string, key: string) => b64(createHmac('sha256', key).update(part).digest()).slice(0, 24);

export function createRecordToken(r: DiagnosticReport): { token: string; path: string; expiresAt: string } | null {
  const key = secret();
  if (!key) return null;
  const glance = buildGlance(r);
  const rd = r.readiness ?? computeReadiness(r);
  const payload: RecordPayload = {
    a: (r.property.siteAddress ?? r.query.address ?? '').slice(0, 90),
    f: r.property.folio ?? '',
    t: Math.floor(Date.parse(r.generatedAt) / 1000) || Math.floor(Date.now() / 1000),
    s: rd.score,
    b: rd.bandLabel,
    i: glance.map((g) => [g.label, TONE_CODE[g.tone] ?? 'n', g.value, g.detail.slice(0, 70)]),
    x: buildFixIts(r, rd).map((f) => f.title).slice(0, 5),
  };
  const part = b64(deflateRawSync(Buffer.from(JSON.stringify(payload))));
  const token = `${part}.${sign(part, key)}`;
  return { token, path: `/record/${token}`, expiresAt: new Date((payload.t + RECORD_DAYS * 86400) * 1000).toISOString() };
}

export function verifyRecordToken(token: string): { payload: RecordPayload; expired: boolean; expiresAt: Date } | null {
  const key = secret();
  if (!key) return null;
  const [part, sig] = token.split('.');
  if (!part || !sig) return null;
  const want = sign(part, key);
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const payload = JSON.parse(inflateRawSync(Buffer.from(part, 'base64url')).toString('utf8')) as RecordPayload;
    const expiresAt = new Date((payload.t + RECORD_DAYS * 86400) * 1000);
    return { payload, expired: Date.now() > expiresAt.getTime(), expiresAt };
  } catch {
    return null;
  }
}
