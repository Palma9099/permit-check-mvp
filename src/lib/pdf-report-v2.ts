// Designed, shareable PDF report (v2). Same DiagnosticReport data as v1, laid
// out for a homeowner in four pages: photo cover with the score, what we
// found (before and now photos), at a glance and what to do, then details. Built-in AFM fonts only (no font files in serverless).
//
// Shareable by design: omits the owner's name, and uses neutral wording
// ("no permit found in county records") rather than accusing a private owner.

import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { googleImageFetchHeaders } from './images/keys';
import type { DiagnosticReport, VisionObservation } from './types';
import { computeReadiness } from './readiness';
import { PACKET_PRICE_NOTE, buildFixIts, buildInsurancePacket } from './fix-it';
import { SITE_ORIGIN } from './record-token';
import { PERSONAS, personaCopy, shortVerdict, type Persona } from './persona';
import { FOUND_NOTE, collectFindings, foundHeadline, type Finding } from './found';
import { buildGlance } from './glance';

const W = 612;
const H = 792;
const M = 44; // page margin
const CW = W - M * 2;

const C = {
  navy: '#0f2547',
  navy2: '#1c3a6b',
  gold: '#b8893b',
  ink: '#14213d',
  soft: '#4b5563',
  muted: '#8a93a3',
  line: '#e3e7ee',
  paper: '#f6f8fb',
  white: '#ffffff',
  red: '#b42318',
  redBg: '#fef3f2',
  amber: '#b54708',
  amberBg: '#fffaeb',
  green: '#067647',
  greenBg: '#ecfdf3',
  grey: '#475467',
  greyBg: '#f2f4f7',
};

type Tone = 'red' | 'amber' | 'green' | 'grey';
const TONE: Record<Tone, { fg: string; bg: string }> = {
  red: { fg: C.red, bg: C.redBg },
  amber: { fg: C.amber, bg: C.amberBg },
  green: { fg: C.green, bg: C.greenBg },
  grey: { fg: C.grey, bg: C.greyBg },
};

// Built-in fonts only cover WinAnsi, and house style has no long dashes.
function clean(s: unknown): string {
  return String(s ?? '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/→/g, ' to ')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x09\x0a\x20-\x7e -ÿ]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function firstSentence(s: unknown, max = 110): string {
  const t = clean(s).split(/\.\s/)[0].replace(/\.$/, '');
  return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, '') + '...' : t;
}

// "Changed between Mar 2022 and Jan 2025: small window in Mar 2022, black-frame window in Jan 2025."
function splitChange(text: string): { from: string; to: string; before: string; now: string } | null {
  const m = text.match(/^Changed between (.+?) and (.+?): (.+) in \1, (.+) in \2\.?$/);
  return m ? { from: m[1], to: m[2], before: m[3], now: m[4] } : null;
}
const capFirst = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

type Ring = Array<[number, number]>; // [lat, lng]
interface Bbox { lon1: number; lat1: number; lon2: number; lat2: number }

async function fetchImage(url: string | null | undefined, timeoutMs = 25000): Promise<Buffer | null> {
  if (!url) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: googleImageFetchHeaders(url) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function buildPdfV2(
  r: DiagnosticReport,
  opts: {
    liveUrl?: string;
    phone?: string;
    role?: Persona | null;
    streetHistory?: Array<{ imageUrl: string; label: string }>;
    streetFindings?: VisionObservation[];
  } = {},
): Promise<Buffer> {
  const phone = opts.phone ?? '305-393-0690';
  const role = opts.role ?? null;
  const pc = personaCopy(role);
  const siteAddr = clean(r.property.siteAddress ?? r.query.address);
  const [streetPart, ...restParts] = siteAddr.split(',');
  const cityLine = restParts.join(',').trim();
  const reportDate = new Date(r.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const reportId =
    'PBS-' + createHash('sha1').update(`${r.property.folio}|${r.generatedAt}`).digest('hex').slice(0, 8).toUpperCase();
  const liveUrl =
    opts.liveUrl ??
    (r.record?.path ? `${SITE_ORIGIN}${r.record.path}` : `${SITE_ORIGIN}/?address=${encodeURIComponent(r.query.address ?? siteAddr)}`);

  const th = r.thenVsNow;
  const ring = (th.parcelPolygon as Ring | null) ?? null;
  const rd = r.readiness ?? computeReadiness(r);
  const found = th?.visualComparison?.performed ? collectFindings(r, opts.streetFindings) : null;
  const street = (opts.streetHistory ?? []).slice(0, 4);
  const aerials = (th.historicalAerials?.allFrames ?? []).filter((f) => f.displayImageUrl);
  const heroFrame = aerials[aerials.length - 1] ?? null;

  // Before and now photos for each finding: the frames named in its dates when
  // we have them, else the oldest and newest of the right kind.
  type Pic = { url: string; label: string; bbox?: Bbox };
  const picsFor = (f: Finding): [Pic | null, Pic | null] => {
    const ch = splitChange(f.text);
    if (f.source === 'street' && street.length >= 2) {
      const a = (ch && street.find((x) => x.label === ch.from)) || street[0];
      const b = (ch && street.find((x) => x.label === ch.to)) || street[street.length - 1];
      return [{ url: a.imageUrl, label: a.label }, { url: b.imageUrl, label: b.label }];
    }
    if (!aerials.length) return [null, null];
    const a = (ch && aerials.find((x) => String(x.captureYear) === ch.from)) || aerials[0];
    const b = (ch && aerials.find((x) => String(x.captureYear) === ch.to)) || aerials[aerials.length - 1];
    return [
      { url: a.displayImageUrl!, label: String(a.captureYear), bbox: a.displayBbox },
      { url: b.displayImageUrl!, label: String(b.captureYear), bbox: b.displayBbox },
    ];
  };
  const findingPics = (found ?? []).slice(0, 6).map(picsFor);
  const urls = Array.from(new Set(findingPics.flat().filter((p): p is Pic => !!p).map((p) => p.url)));
  const [heroImg, sat, qr, ...fetched] = await Promise.all([
    fetchImage(heroFrame?.displayImageUrl),
    fetchImage(th.satelliteImageUrl),
    QRCode.toBuffer(liveUrl, { margin: 1, width: 240, color: { dark: '#0f2547', light: '#ffffff' } }),
    ...urls.map((u) => fetchImage(u)),
  ]);
  const imgOf = new Map(urls.map((u, i) => [u, fetched[i] ?? null]));

  const doc = new PDFDocument({ size: 'LETTER', margin: 0, autoFirstPage: false, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  // ---- helpers ------------------------------------------------------------
  const text = (
    s: string,
    x: number,
    y: number,
    o: { w?: number; size?: number; font?: string; color?: string; align?: 'left' | 'center' | 'right'; gap?: number; spacing?: number } = {},
  ) => {
    doc.font(o.font ?? 'Helvetica').fontSize(o.size ?? 10).fillColor(o.color ?? C.ink);
    const opt: PDFKit.Mixins.TextOptions = { width: o.w ?? CW, align: o.align ?? 'left', lineGap: o.gap ?? 2, characterSpacing: o.spacing ?? 0 };
    doc.text(clean(s), x, y, opt);
    return doc.heightOfString(clean(s), opt);
  };
  const hOf = (s: string, w: number, size: number, font = 'Helvetica', gap = 2) => {
    doc.font(font).fontSize(size);
    return doc.heightOfString(clean(s), { width: w, lineGap: gap });
  };
  const pill = (label: string, x: number, y: number, tone: Tone) => {
    const t = TONE[tone];
    doc.font('Helvetica-Bold').fontSize(7.5);
    const w = doc.widthOfString(label.toUpperCase(), { characterSpacing: 0.6 }) + 14;
    doc.roundedRect(x, y, w, 15, 7.5).fill(t.bg);
    doc.fillColor(t.fg).text(label.toUpperCase(), x + 7, y + 4.2, { characterSpacing: 0.6, lineBreak: false });
    return w;
  };
  const image = (buf: Buffer | null, x: number, y: number, w: number, h: number, caption?: string) => {
    doc.save();
    doc.roundedRect(x, y, w, h, 6).clip();
    if (buf) {
      try {
        doc.image(buf, x, y, { cover: [w, h], align: 'center', valign: 'center' });
      } catch {
        doc.rect(x, y, w, h).fill(C.greyBg);
      }
    } else {
      doc.rect(x, y, w, h).fill(C.greyBg);
      doc.fillColor(C.muted).font('Helvetica').fontSize(9).text('Image not available', x, y + h / 2 - 5, { width: w, align: 'center' });
    }
    doc.restore();
    doc.roundedRect(x, y, w, h, 6).lineWidth(0.6).stroke(C.line);
    if (caption) text(caption, x, y + h + 5, { w, size: 8, color: C.soft });
  };
  const outline = (bbox: Bbox | undefined, x: number, y: number, w: number, h: number) => {
    if (!bbox || !ring) return;
    const pts = ring.map(([lat, lng]) => [
      x + ((lng - bbox.lon1) / (bbox.lon2 - bbox.lon1)) * w,
      y + ((bbox.lat2 - lat) / (bbox.lat2 - bbox.lat1)) * h,
    ]);
    doc.save();
    doc.roundedRect(x, y, w, h, 6).clip();
    doc.lineWidth(2).strokeColor('#ff2d2d');
    doc.moveTo(pts[0][0], pts[0][1]);
    for (const q of pts.slice(1)) doc.lineTo(q[0], q[1]);
    doc.closePath().stroke();
    doc.restore();
  };
  const header = (title: string, kicker: string) => {
    doc.rect(0, 0, W, 6).fill(C.navy);
    doc.rect(0, 6, 120, 2).fill(C.gold);
    text('PALMA BUILDING SOLUTIONS', M, 24, { size: 7.5, font: 'Helvetica-Bold', color: C.navy, spacing: 1.2, w: 260 });
    text(streetPart, M, 24, { size: 7.5, color: C.muted, align: 'right', w: CW });
    text(kicker.toUpperCase(), M, 62, { size: 8, font: 'Helvetica-Bold', color: C.gold, spacing: 1.4 });
    text(title, M, 76, { size: 24, font: 'Times-Bold', color: C.navy });
  };
  const sectionTitle = (s: string, y: number) => {
    text(s, M, y, { size: 13, font: 'Times-Bold', color: C.navy });
    doc.moveTo(M, y + 19).lineTo(M + CW, y + 19).lineWidth(0.6).stroke(C.line);
    return y + 27;
  };
  const cardHeight = (w: number, title: string, body: string, note?: string) => {
    const inner = w - 28;
    let h = 14 + 16 + hOf(title, inner, 11, 'Helvetica-Bold') + 5 + hOf(body, inner, 9) + 12;
    if (note) h += 6 + hOf(note, inner, 8, 'Helvetica-Oblique');
    return h;
  };
  const toneCard = (x: number, y: number, w: number, tone: Tone, label: string, title: string, body: string, note?: string) => {
    const t = TONE[tone];
    const inner = w - 28;
    let h = 14 + 16 + hOf(title, inner, 11, 'Helvetica-Bold') + 5 + hOf(body, inner, 9) + 12;
    if (note) h += 6 + hOf(note, inner, 8, 'Helvetica-Oblique');
    doc.roundedRect(x, y, w, h, 8).fill(t.bg);
    doc.rect(x, y + 8, 3, h - 16).fill(t.fg);
    let cy = y + 12;
    text(label.toUpperCase(), x + 16, cy, { w: inner, size: 7.5, font: 'Helvetica-Bold', color: t.fg, spacing: 0.8 });
    cy += 14;
    cy += text(title, x + 16, cy, { w: inner, size: 11, font: 'Helvetica-Bold' }) + 5;
    cy += text(body, x + 16, cy, { w: inner, size: 9, color: C.soft }) ;
    if (note) text(note, x + 16, cy + 6, { w: inner, size: 8, font: 'Helvetica-Oblique', color: C.muted });
    return h;
  };

  const chip = (label: string, x: number, y: number, fg: string, bg: string) => {
    doc.font('Helvetica-Bold').fontSize(9);
    const w = doc.widthOfString(clean(label)) + 18;
    doc.roundedRect(x, y, w, 18, 9).fill(bg);
    doc.fillColor(fg).text(clean(label), x + 9, y + 5, { lineBreak: false });
    return w;
  };

  // ===== PAGE 1: COVER ======================================================
  // The house from above, its score, one plain line and three facts.
  doc.addPage({ size: 'LETTER', margin: 0 });
  const HERO_H = 470;
  doc.rect(0, 0, W, H).fill(C.white);
  doc.save();
  doc.rect(0, 0, W, HERO_H).clip();
  const heroBuf = heroImg ?? sat;
  if (heroBuf) {
    try {
      doc.image(heroBuf, 0, 0, { cover: [W, HERO_H], align: 'center', valign: 'center' });
    } catch {
      doc.rect(0, 0, W, HERO_H).fill(C.navy2);
    }
  } else doc.rect(0, 0, W, HERO_H).fill(C.navy2);
  // Lot outline on the hero: the square aerial is scaled to the page width and
  // centred vertically, so map its box onto that.
  if (heroImg && heroFrame?.displayBbox && ring) {
    const bb = heroFrame.displayBbox;
    const off = (W - HERO_H) / 2;
    const pts = ring.map(([lat, lng]) => [((lng - bb.lon1) / (bb.lon2 - bb.lon1)) * W, ((bb.lat2 - lat) / (bb.lat2 - bb.lat1)) * W - off]);
    doc.lineWidth(2.5).strokeColor('#ff3b30').moveTo(pts[0][0], pts[0][1]);
    for (const q of pts.slice(1)) doc.lineTo(q[0], q[1]);
    doc.closePath().stroke();
  }
  const shadeL = doc.linearGradient(0, 0, W, 0);
  shadeL.stop(0, '#0b1730', 0.94).stop(0.55, '#0b1730', 0.62).stop(1, '#0b1730', 0.12);
  doc.rect(0, 0, W, HERO_H).fill(shadeL);
  const shadeB = doc.linearGradient(0, HERO_H - 140, 0, HERO_H);
  shadeB.stop(0, '#0b1730', 0).stop(1, '#0b1730', 0.75);
  doc.rect(0, HERO_H - 140, W, 140).fill(shadeB);
  doc.restore();
  doc.rect(0, 0, W, 6).fill(C.gold);
  text('PALMA BUILDING SOLUTIONS', M, 34, { size: 8.5, font: 'Helvetica-Bold', color: C.white, spacing: 2, w: 300 });
  text(`Property check  |  ${reportDate}`, M, 34, { size: 8.5, color: '#c8d5ee', align: 'right' });
  const addrH = hOf(streetPart, 330, 42, 'Times-Bold', 0);
  const addrY = 300 - addrH;
  text(streetPart, M, addrY, { w: 330, size: 42, font: 'Times-Bold', color: C.white, gap: 0 });
  text(cityLine.replace(/Unincorporated\s+/i, '').replace(/-0000\b/, ''), M, addrY + addrH + 4, { w: 330, size: 12, color: '#c8d5ee' });
  text(shortVerdict(role, rd.band), M, 352, { w: 330, size: 24, font: 'Times-Roman', color: C.white, gap: 1 });
  // Score ring
  {
    const RC: Record<string, string> = { ready: '#34d399', 'fix-first': '#fbbf24', hard: '#fb923c', 'high-risk': '#f87171' };
    const cx = W - M - 70;
    const cy = 330;
    const rr = 56;
    doc.save();
    doc.fillOpacity(0.45).circle(cx, cy, rr + 8).fill('#000000');
    doc.restore();
    doc.circle(cx, cy, rr).lineWidth(11).strokeOpacity(0.25).stroke('#ffffff');
    doc.strokeOpacity(1);
    const n = Math.max(2, Math.round((rd.score / 100) * 120));
    doc.lineWidth(11).lineCap('round').strokeColor(RC[rd.band] ?? '#fbbf24');
    for (let k = 0; k <= n; k++) {
      const ang = -Math.PI / 2 + (k / 120) * 2 * Math.PI;
      const px = cx + rr * Math.cos(ang);
      const py = cy + rr * Math.sin(ang);
      if (k === 0) doc.moveTo(px, py);
      else doc.lineTo(px, py);
    }
    doc.stroke();
    doc.lineCap('butt');
    text(String(rd.score), cx - 50, cy - 22, { w: 100, size: 38, font: 'Times-Bold', color: C.white, align: 'center' });
    text('OUT OF 100', cx - 50, cy + 18, { w: 100, size: 7, color: '#c8d5ee', align: 'center', spacing: 1 });
    text(rd.bandLabel, cx - 80, cy + rr + 16, { w: 160, size: 10, font: 'Helvetica-Bold', color: C.white, align: 'center' });
  }
  // Three facts
  const glance = Object.fromEntries(buildGlance(r).map((g) => [g.key, g]));
  const facts: Array<{ label: string; value: string; tone: Tone }> = [];
  if (found && found.length) facts.push({ label: 'What we found', value: `${found.length} change${found.length > 1 ? 's' : ''}, no permit`, tone: 'red' });
  else if (glance.permits) facts.push({ label: 'Permits', value: glance.permits.value, tone: glance.permits.tone });
  if (glance.roof) facts.push({ label: 'Roof and insurance', value: glance.roof.value, tone: glance.roof.tone });
  if (glance.flood) facts.push({ label: 'Flood zone', value: glance.flood.value, tone: glance.flood.tone });
  {
    const fw = (CW - 24) / 3;
    facts.forEach((f, i) => {
      const x = M + i * (fw + 12);
      const y = HERO_H + 30;
      const t = TONE[f.tone];
      doc.roundedRect(x, y, fw, 96, 10).fill(C.paper);
      doc.roundedRect(x, y, 5, 96, 2.5).fill(t.fg);
      text(f.label.toUpperCase(), x + 18, y + 18, { w: fw - 30, size: 7.5, font: 'Helvetica-Bold', color: C.muted, spacing: 0.9 });
      text(f.value, x + 18, y + 36, { w: fw - 30, size: 17, font: 'Times-Bold', color: t.fg, gap: 0 });
    });
  }
  const who = role && role !== 'other' ? `Prepared for: ${PERSONAS[role].short}   |   ` : '';
  text(`${who}Folio ${r.property.folio ?? '-'}   |   Report ID ${reportId}`, M, HERO_H + 146, { size: 8.5, color: C.muted });
  // Footer band with QR
  const fy = 690;
  doc.rect(0, fy - 14, W, H - (fy - 14)).fill(C.navy);
  doc.image(qr, W - M - 74, fy - 2, { width: 74 });
  text('See the live report, photos and full details', M, fy + 8, { size: 13, font: 'Times-Bold', color: C.white, w: 380 });
  text(r.record?.path ? 'Scan the code, or call ' + phone + '.' : 'Scan the code to open it online.', M, fy + 28, { size: 9, color: '#c8d5ee', w: 380 });
  text('Records review. Not an inspection or an official determination.', M, fy + 52, { size: 7.5, color: '#9fb3d6', w: 380 });

  // ===== PAGE 2: WHAT WE FOUND ==============================================
  doc.addPage({ size: 'LETTER', margin: 0 });
  header(found && found.length ? `${found.length} change${found.length > 1 ? 's' : ''} with no permit` : 'What we found', 'What we found');
  if (!found || !found.length) {
    doc.roundedRect(M, 140, CW, 90, 12).fill(C.greenBg);
    doc.circle(M + 40, 185, 16).fill(C.green);
    text('OK', M + 28, 180, { w: 24, size: 9, font: 'Helvetica-Bold', color: C.white, align: 'center' });
    text(found ? foundHeadline(role, 0) : 'Photos could not be compared', M + 70, 168, { w: CW - 90, size: 17, font: 'Times-Bold', color: C.green });
    text(found ? 'Older and newer photos match the permit record.' : 'Older photos were not available for this property.', M + 70, 192, { w: CW - 90, size: 10, color: C.soft });
  } else {
    // One or two findings get full-width cards with bigger photos.
    const cols = found.length <= 2 ? 1 : 2;
    const cw = cols === 1 ? CW : (CW - 16) / 2;
    const pw = cw / 2;
    const ph = Math.round(pw * (cols === 1 ? 0.62 : 0.75));
    const tag = (s: string, x: number, y: number) => {
      doc.font('Helvetica-Bold').fontSize(7);
      const w = doc.widthOfString(clean(s)) + 12;
      doc.save();
      doc.fillOpacity(0.62).roundedRect(x, y, w, 14, 7).fill('#000000');
      doc.restore();
      text(s, x + 6, y + 3.6, { w: w, size: 7, font: 'Helvetica-Bold', color: C.white });
    };
    const cardH = (f: Finding) => {
      const ch = splitChange(f.text);
      const line = ch ? `${capFirst(ch.now)}. Was: ${ch.before}.` : f.text;
      return ph + 14 + 18 + Math.min(hOf(line, cw - 28, cols === 1 ? 10.5 : 9), 48) + 16;
    };
    let y = 124;
    for (let i = 0; i < Math.min(found.length, 6); i += cols) {
      const row = found.slice(i, i + cols);
      const rowH = Math.max(...row.map(cardH));
      if (y + rowH > 700) {
        doc.addPage({ size: 'LETTER', margin: 0 });
        header('What we found', 'Continued');
        y = 124;
      }
      row.forEach((f, k) => {
        const x = M + k * (cw + 16);
        const [before, now] = findingPics[i + k] ?? [null, null];
        doc.roundedRect(x, y, cw, rowH, 10).fill(C.white);
        doc.roundedRect(x, y, cw, rowH, 10).lineWidth(0.8).stroke(C.line);
        [before, now].forEach((pic, j) => {
          const px = x + j * pw;
          doc.save();
          doc.roundedRect(x, y, cw, ph + 10, 10).clip();
          doc.rect(px, y, pw, ph).clip();
          const buf = pic ? imgOf.get(pic.url) ?? null : null;
          if (buf) {
            try {
              doc.image(buf, px, y, { cover: [pw, ph], align: 'center', valign: 'center' });
            } catch {
              doc.rect(px, y, pw, ph).fill(C.greyBg);
            }
          } else doc.rect(px, y, pw, ph).fill(C.greyBg);
          if (buf && pic?.bbox && ring) {
            // Aerial crops are square; cover() trims top and bottom equally.
            const s = pw;
            const off = (s - ph) / 2;
            const pts = ring.map(([lat, lng]) => [px + ((lng - pic.bbox!.lon1) / (pic.bbox!.lon2 - pic.bbox!.lon1)) * s, y + ((pic.bbox!.lat2 - lat) / (pic.bbox!.lat2 - pic.bbox!.lat1)) * s - off]);
            doc.lineWidth(1.4).strokeColor('#ff3b30').moveTo(pts[0][0], pts[0][1]);
            for (const q of pts.slice(1)) doc.lineTo(q[0], q[1]);
            doc.closePath().stroke();
          }
          doc.restore();
          tag(`${j === 0 ? 'BEFORE' : 'NOW'}${pic ? ` · ${pic.label}` : ''}`, px + 6, y + 6);
        });
        doc.moveTo(x + pw, y).lineTo(x + pw, y + ph).lineWidth(1).stroke(C.white);
        const ty = y + ph + 12;
        text(f.area.replace(/\s*\/\s*/g, ' / '), x + 14, ty, { w: cw - 100, size: 13, font: 'Times-Bold', color: C.ink });
        pill('No permit', x + cw - 74, ty, 'red');
        const ch = splitChange(f.text);
        const line = ch ? `${capFirst(ch.now)}. Was: ${ch.before}.` : f.text;
        doc.save();
        doc.rect(x + 14, ty + 20, cw - 28, 48).clip();
        text(line, x + 14, ty + 20, { w: cw - 28, size: cols === 1 ? 10.5 : 9, color: C.soft });
        doc.restore();
      });
      y += rowH + 14;
    }
    text(`${FOUND_NOTE}${found.some((f) => f.sources.includes('street')) ? ' Street View imagery (c) Google.' : ''}`, M, y + 2, { w: CW, size: 8.5, color: C.muted });
  }

  // ===== PAGE 3: AT A GLANCE + WHAT TO DO ====================================
  doc.addPage({ size: 'LETTER', margin: 0 });
  header('Your home at a glance', 'Scorecard');
  const badges = buildGlance(r);
  const bw = (CW - 24) / 3;
  const bh = 80;
  badges.forEach((b, i) => {
    const x = M + (i % 3) * (bw + 12);
    const y = 120 + Math.floor(i / 3) * (bh + 10);
    const t = TONE[b.tone];
    doc.roundedRect(x, y, bw, bh, 10).fill(C.paper);
    doc.roundedRect(x, y, bw, 5, 2.5).fill(t.fg);
    text(b.label.toUpperCase(), x + 12, y + 15, { w: bw - 24, size: 7, font: 'Helvetica-Bold', color: C.muted, spacing: 0.8 });
    const vh = text(b.value, x + 12, y + 30, { w: bw - 24, size: 15, font: 'Times-Bold', color: t.fg, gap: 0 });
    text(firstSentence(b.detail, 44), x + 12, y + 34 + vh, { w: bw - 24, size: 8.5, color: C.soft });
  });
  let y3 = 120 + 2 * (bh + 10) + 14;
  const fixes = buildFixIts(r, rd, found?.length ?? 0);
  if (fixes.length) {
    y3 = sectionTitle(pc.fixTitle, y3);
    const fw2 = (CW - 14) / 2;
    fixes.slice(0, 4).forEach((f, i) => {
      const x = M + (i % 2) * (fw2 + 14);
      const y = y3 + Math.floor(i / 2) * 76;
      doc.roundedRect(x, y, fw2, 66, 10).fill(C.white);
      doc.roundedRect(x, y, fw2, 66, 10).lineWidth(0.8).stroke(C.line);
      doc.circle(x + fw2 - 16, y + 16, 4).fill(f.tone === 'red' ? C.red : C.amber);
      text(f.title, x + 14, y + 11, { w: fw2 - 40, size: 12.5, font: 'Times-Bold', color: C.ink });
      let px = x + 14;
      if (f.price) px += chip(f.price, px, y + 38, C.navy, '#e8edf6') + 6;
      if (f.timeline) chip(f.timeline, px, y + 38, C.soft, C.greyBg);
    });
    y3 += Math.ceil(Math.min(fixes.length, 4) / 2) * 76 + 8;
  }
  const papers = buildInsurancePacket(r, rd).filter((p) => p.status !== 'ok');
  if (papers.length) {
    y3 = sectionTitle(pc.packetTitle, y3);
    for (const pk of papers.slice(0, 5)) {
      doc.circle(M + 5, y3 + 5, 3.5).fill(pk.status === 'needed' ? C.red : C.amber);
      text(pk.item, M + 16, y3, { w: CW - 100, size: 10.5, font: 'Helvetica-Bold', color: C.ink });
      if (pk.price) text(pk.price, M, y3, { w: CW, size: 10.5, font: 'Helvetica-Bold', color: C.navy, align: 'right' });
      y3 += 21;
    }
    text(PACKET_PRICE_NOTE, M, y3 + 2, { w: CW, size: 8, color: C.muted });
  }
  doc.roundedRect(M, 680, CW, 52, 10).fill(C.navy);
  text(`Get a fixed quote on any of these. Call ${phone} or scan the code on the cover.`, M + 20, 693, { w: CW - 40, size: 11, font: 'Helvetica-Bold', color: C.white });
  text(fixes[0]?.vendorNote ?? '', M + 20, 711, { w: CW - 40, size: 8, color: '#c8d5ee' });

  // ===== PAGE 4: DETAILS ====================================================
  doc.addPage({ size: 'LETTER', margin: 0 });
  header('The details', 'For your agent or inspector');
  let y4 = 118;
  y4 = sectionTitle('Why this score', y4);
  for (const f of rd.factors.filter((x) => x.penalty > 0)) {
    const col = f.tone === 'red' ? C.red : f.tone === 'amber' ? C.amber : C.grey;
    text(f.label, M, y4, { w: 220, size: 9.5, font: 'Helvetica-Bold', color: C.ink });
    text(`-${f.penalty} of ${f.max}`, M, y4, { w: CW, size: 8.5, font: 'Helvetica-Bold', color: col, align: 'right' });
    doc.roundedRect(M, y4 + 14, CW, 4, 2).fill('#eef1f5');
    doc.roundedRect(M, y4 + 14, Math.max(8, (f.penalty / f.max) * CW), 4, 2).fill(col);
    text(firstSentence(f.reason, 120), M, y4 + 22, { w: CW, size: 8, color: C.soft });
    y4 += 38;
  }
  const cleanItems = rd.factors.filter((x) => x.penalty === 0).map((x) => x.label);
  if (cleanItems.length) {
    text(`No points lost: ${cleanItems.join(', ')}.`, M, y4, { w: CW, size: 8.5, color: C.green });
    y4 += 20;
  }
  // Money and safety: short cards, two per row
  const xt = r.countyExtras;
  const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
  const cards: Array<{ tone: Tone; label: string; title: string; body: string }> = [];
  if (xt?.tax && xt.tax.increase > 0)
    cards.push({ tone: 'amber', label: 'Tax after a sale', title: `About ${money(xt.tax.estAnnualIncrease)} a year more`, body: 'A sale resets the tax cap.' });
  if (xt?.permitHealth) {
    const h = xt.permitHealth;
    cards.push({
      tone: h.expired > 0 ? 'red' : h.noInspection > 0 ? 'amber' : 'green',
      label: 'Permit status',
      title: h.expired ? `${h.expired} expired without a final` : `${h.closedOut} closed out`,
      body: h.items[0] ? `${h.items[0].appType ?? 'Permit'} ${h.items[0].issueDate?.slice(0, 4) ?? ''}: ${h.items[0].status ?? ''}` : '',
    });
  }
  if (xt?.evacuation?.zone) cards.push({ tone: 'grey', label: 'Hurricane zone', title: `Evacuation Zone ${xt.evacuation.zone}`, body: 'Miami-Dade product approvals required.' });
  if (xt?.sewer)
    cards.push({
      tone: xt.sewer.septicOrWellFlag || !xt.sewer.inServiceArea ? 'amber' : 'green',
      label: 'Sewer or septic',
      title: xt.sewer.septicOrWellFlag ? 'Possibly septic or well' : xt.sewer.inServiceArea ? 'County sewer' : 'Outside county sewer',
      body: '',
    });
  if (cards.length) {
    y4 = sectionTitle('Money and safety', y4 + 4);
    const hw = (CW - 14) / 2;
    cards.forEach((c, i) => {
      const x = M + (i % 2) * (hw + 14);
      const y = y4 + Math.floor(i / 2) * 62;
      const t = TONE[c.tone];
      doc.roundedRect(x, y, hw, 54, 8).fill(t.bg);
      doc.rect(x, y + 8, 3, 38).fill(t.fg);
      text(c.label.toUpperCase(), x + 14, y + 9, { w: hw - 24, size: 7, font: 'Helvetica-Bold', color: t.fg, spacing: 0.8 });
      text(c.title, x + 14, y + 21, { w: hw - 24, size: 10.5, font: 'Helvetica-Bold', color: C.ink });
      if (c.body) {
        doc.save();
        doc.rect(x + 14, y + 36, hw - 24, 12).clip();
        text(c.body, x + 14, y + 37, { w: hw - 24, size: 8, color: C.soft });
        doc.restore();
      }
    });
    y4 += Math.ceil(cards.length / 2) * 62 + 4;
  }
  y4 = sectionTitle('The property', y4 + 4);
  const p = r.property;
  const props: Array<[string, string]> = [
    ['Built', String(p.yearBuilt ?? '-')],
    ['Living area', `${p.heatedArea?.toLocaleString('en-US') ?? '-'} sq ft`],
    ['Lot', `${p.lotSize?.toLocaleString('en-US') ?? '-'} sq ft`],
    ['Beds / baths', `${p.bedrooms ?? '-'} / ${p.bathrooms ?? '-'}`],
    ['Folio', clean(p.folio)],
    ...(xt?.replacementCostNew ? ([['Rebuild cost (county)', money(xt.replacementCostNew)]] as Array<[string, string]>) : []),
  ];
  const pcw = (CW - 24) / 3;
  props.forEach((f, i) => {
    const x = M + (i % 3) * (pcw + 12);
    const y = y4 + Math.floor(i / 3) * 34;
    text(f[0].toUpperCase(), x, y, { w: pcw, size: 7, font: 'Helvetica-Bold', color: C.muted, spacing: 0.8 });
    text(f[1], x, y + 11, { w: pcw, size: 11, font: 'Helvetica-Bold', color: C.ink });
  });
  y4 += Math.ceil(props.length / 3) * 34 + 6;
  y4 = sectionTitle('Where this came from', y4);
  y4 += text(
    /miami-dade/i.test(r.county?.name ?? '')
      ? 'County property appraiser, permit and code records, FEMA flood map, county aerial photos and Google imagery. Permits: every one since 2020, plus older ones still open or expired. Older closed permits need the certified permit history.'
      : 'County property appraiser, permit and code records, FEMA flood map, aerial photos and Google imagery. Older paper permits may not appear.',
    M, y4, { size: 8.5, color: C.soft, gap: 2 },
  );
  if (y4 > 650) {
    doc.addPage({ size: 'LETTER', margin: 0 });
    header('The details', 'Continued');
  }
  doc.roundedRect(M, 668, CW, 66, 10).fill(C.navy);
  text('Want us to sort it out?', M + 20, 682, { w: CW - 130, size: 16, font: 'Times-Bold', color: C.white });
  text(`Call ${phone} for a fixed quote. No obligation.`, M + 20, 704, { w: CW - 130, size: 10, color: '#c8d5ee' });
  doc.image(qr, M + CW - 62, 674, { width: 54 });

  // ---- footers on pages 2..n ----------------------------------------------
  const range = doc.bufferedPageRange();
  for (let i = 1; i < range.count; i++) {
    doc.switchToPage(i);
    doc.moveTo(M, H - 38).lineTo(W - M, H - 38).lineWidth(0.5).stroke(C.line);
    text('Records review, not legal advice or an official determination. Verify with the county.', M, H - 30, { w: CW - 90, size: 7, color: C.muted });
    text(`${reportId}   |   Page ${i + 1} of ${range.count}`, M, H - 30, { w: CW, size: 7, color: C.muted, align: 'right' });
  }

  doc.end();
  return done;
}
