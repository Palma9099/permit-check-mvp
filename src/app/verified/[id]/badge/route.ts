import { NextRequest } from 'next/server';
import { getVerified, isLive } from '@/lib/verified';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string);

// Listing badge: a small image that always shows the record's current state,
// so an expired record can never keep a "verified" badge on a listing.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const v = await getVerified(params.id);
  const live = !!v && isLive(v);
  const line = !v
    ? 'Record not found'
    : live
    ? `Valid until ${new Date(v.expires_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`
    : 'Expired, ask for a new one';
  const bg = live ? '#047857' : '#64748b';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="64" viewBox="0 0 240 64" role="img" aria-label="Palma Verified">
  <rect width="240" height="64" rx="14" fill="#0b1730"/>
  <circle cx="32" cy="32" r="20" fill="${bg}"/>
  <path d="M23 32 L30 39 L42 26" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="62" y="29" font-family="Georgia, serif" font-size="17" font-weight="700" fill="#ffffff">${live ? 'Palma Verified' : 'Palma Verified'}</text>
  <text x="62" y="47" font-family="Helvetica, Arial, sans-serif" font-size="11" fill="#c8d5ee">${esc(line)}</text>
</svg>`;
  return new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' } });
}
