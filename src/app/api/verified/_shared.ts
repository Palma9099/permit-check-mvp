import { verifyRecordToken, type RecordPayload } from '@/lib/record-token';

// The report a reviewer is verifying, read from its signed record link (the
// full URL or just the token). Address, folio and score come from the signed
// record, never from what the browser sends.
export function recordFrom(linkOrToken: unknown): RecordPayload | null {
  const s = typeof linkOrToken === 'string' ? linkOrToken.trim() : '';
  if (!s) return null;
  const token = decodeURIComponent(s.includes('/record/') ? s.split('/record/')[1].split(/[?#]/)[0] : s);
  const v = verifyRecordToken(token);
  return v ? v.payload : null;
}

export const itemValue = (p: RecordPayload, label: RegExp) => p.i.find((x) => label.test(x[0]))?.[2] ?? null;
