// Designed, shareable PDF report (v2). Same DiagnosticReport data as v1, laid
// out as a professional document: cover, one-page scorecard, imagery spread,
// then detail. Built-in AFM fonts only (no font files in serverless).
//
// Shareable by design: omits the owner's name, and uses neutral wording
// ("no permit found in county records") rather than accusing a private owner.

import { createHash } from 'node:crypto';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { googleImageFetchHeaders } from './images/keys';
import type { DiagnosticReport } from './types';
import { buildGlance, glanceNextSteps, glanceVerdict } from './glance';

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

type Ring = Array<[number, number]>; // [lat, lng]
interface Bbox { lon1: number; lat1: number; lon2: number; lat2: number }

// Re-aim a Planetary Computer NAIP bbox URL at the parcel (tighter, centred).
function tightNaipUrl(url: string | null | undefined, ring: Ring | null | undefined): { url: string; bbox: Bbox } | null {
  if (!url || !ring || ring.length < 3) return null;
  const lats = ring.map((p) => p[0]);
  const lngs = ring.map((p) => p[1]);
  const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const cLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const halfLat = 0.00042; // about 47 m
  const halfLng = halfLat / Math.cos((cLat * Math.PI) / 180);
  const bbox = { lon1: cLng - halfLng, lat1: cLat - halfLat, lon2: cLng + halfLng, lat2: cLat + halfLat };
  const next = url.replace(/\/bbox\/[^/]+\//, `/bbox/${bbox.lon1},${bbox.lat1},${bbox.lon2},${bbox.lat2}/`);
  return next === url ? null : { url: next, bbox };
}

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
  opts: { liveUrl?: string; phone?: string } = {},
): Promise<Buffer> {
  const phone = opts.phone ?? '305-393-0690';
  const siteAddr = clean(r.property.siteAddress ?? r.query.address);
  const [streetPart, ...restParts] = siteAddr.split(',');
  const cityLine = restParts.join(',').trim();
  const reportDate = new Date(r.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const reportId =
    'PBS-' + createHash('sha1').update(`${r.property.folio}|${r.generatedAt}`).digest('hex').slice(0, 8).toUpperCase();
  const liveUrl =
    opts.liveUrl ?? `https://permit-check-mvp.vercel.app/?address=${encodeURIComponent(r.query.address ?? siteAddr)}`;

  const th = r.thenVsNow;
  const ring = (th.parcelPolygon as Ring | null) ?? null;
  const thenTight = tightNaipUrl(th.historicalAerials?.then?.imageUrl, ring);
  const nowTight = tightNaipUrl(th.historicalAerials?.now?.imageUrl, ring);
  const [sat, ctxSat, thenImg, nowImg, street, qr] = await Promise.all([
    fetchImage(th.satelliteImageUrl),
    fetchImage(th.contextSatelliteImageUrl),
    fetchImage(thenTight?.url ?? th.historicalAerials?.then?.imageUrl),
    fetchImage(nowTight?.url ?? th.historicalAerials?.now?.imageUrl),
    fetchImage(th.streetViewImages?.[0]?.imageUrl),
    QRCode.toBuffer(liveUrl, { margin: 1, width: 240, color: { dark: '#0f2547', light: '#ffffff' } }),
  ]);

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

  // ===== PAGE 1: COVER =====================================================
  doc.addPage({ size: 'LETTER', margin: 0 });
  doc.rect(0, 0, W, H).fill(C.navy);
  doc.rect(0, 0, W, 8).fill(C.gold);
  text('PALMA BUILDING SOLUTIONS', M, 44, { size: 9, font: 'Helvetica-Bold', color: C.white, spacing: 2 });
  text('Property Records Report', M, 58, { size: 9, color: '#9fb3d6', spacing: 0.6 });
  text('PROPERTY CHECK', M, 150, { size: 9, font: 'Helvetica-Bold', color: C.gold, spacing: 2 });
  const tH = text(streetPart, M, 168, { size: 40, font: 'Times-Bold', color: C.white, gap: 0 });
  text(cityLine, M, 168 + tH + 4, { size: 14, color: '#c8d5ee' });
  const metaY = 168 + tH + 34;
  text(`Folio ${r.property.folio ?? '-'}   |   ${clean(r.county.name)}   |   ${reportDate}`, M, metaY, { size: 9, color: '#9fb3d6' });
  // Hero image
  const heroY = metaY + 30;
  const heroH = 330;
  doc.save();
  doc.roundedRect(M, heroY, CW, heroH, 10).clip();
  if (sat) doc.image(sat, M, heroY, { cover: [CW, heroH], align: 'center', valign: 'center' });
  else doc.rect(M, heroY, CW, heroH).fill(C.navy2);
  doc.restore();
  doc.roundedRect(M, heroY, CW, heroH, 10).lineWidth(1).stroke(C.gold);
  text('RED OUTLINE = SUBJECT PARCEL', M, heroY + heroH + 7, { size: 7, color: '#9fb3d6', spacing: 0.8 });
  // Footer band: facts + QR
  const fy = 690;
  doc.rect(0, fy - 20, W, H - (fy - 20)).fill('#0b1c38');
  doc.image(qr, W - M - 70, fy - 4, { width: 70 });
  text(`Report ID  ${reportId}`, M, fy, { size: 9, font: 'Helvetica-Bold', color: C.white });
  text('Scan to open this report online.', M, fy + 14, { size: 8, color: '#9fb3d6', w: 360 });
  text('Records review. Not an inspection or official determination.', M, fy + 34, { size: 7.5, color: '#9fb3d6', w: 400 });

  // ===== PAGE 2: AT A GLANCE ==============================================
  doc.addPage({ size: 'LETTER', margin: 0 });
  header('At a glance', 'Scorecard');
  const badges = buildGlance(r);
  const bw = (CW - 24) / 3;
  const bh = 104;
  badges.forEach((b, i) => {
    const x = M + (i % 3) * (bw + 12);
    const y = 122 + Math.floor(i / 3) * (bh + 12);
    const t = TONE[b.tone];
    doc.roundedRect(x, y, bw, bh, 8).fill(C.white).lineWidth(0.8).stroke(C.line);
    doc.roundedRect(x, y, bw, 5, 2.5).fill(t.fg);
    text(b.label.toUpperCase(), x + 12, y + 16, { w: bw - 40, size: 7, font: 'Helvetica-Bold', color: C.muted, spacing: 0.8 });
    // "i" marker. The note opens on hover or click in most PDF viewers.
    const ix = x + bw - 22;
    doc.circle(ix + 5, y + 20, 7).lineWidth(0.8).stroke(C.muted);
    doc.font('Times-BoldItalic').fontSize(9).fillColor(C.muted).text('i', ix + 3.2, y + 15.5, { lineBreak: false });
    doc.note(ix - 2, y + 11, 14, 14, clean(`${b.label}\n\nWhat it is: ${b.info.what}\n\nIf you are buying: ${b.info.buyer}\n\nIf you own it: ${b.info.owner}`), { Name: 'Comment', Open: false } as any);
    const vh = text(b.value, x + 12, y + 32, { w: bw - 24, size: 16, font: 'Times-Bold', color: t.fg, gap: 0 });
    text(b.detail, x + 12, y + 38 + vh, { w: bw - 24, size: 9, color: C.soft });
  });
  let y2 = 122 + 2 * (bh + 12) + 10;
  doc.roundedRect(M, y2, CW, 64, 10).fill(C.navy);
  text(glanceVerdict(badges), M + 22, y2 + 20, { w: CW - 44, size: 19, font: 'Times-Bold', color: C.white });
  y2 += 64 + 26;
  y2 = sectionTitle('Do this next', y2);
  for (const step of glanceNextSteps(badges)) {
    doc.roundedRect(M, y2 + 1, 12, 12, 3).lineWidth(1.2).stroke(C.gold);
    y2 += text(step, M + 24, y2, { w: CW - 24, size: 12, color: C.ink }) + 12;
  }

  // ===== PAGE 3: IMAGERY ===================================================
  doc.addPage({ size: 'LETTER', margin: 0 });
  header('Then and now', 'Aerial and street imagery');
  const hw = (CW - 14) / 2;
  const thenYear = th.historicalAerials?.then?.captureYear;
  const nowYear = th.historicalAerials?.now?.captureYear;
  const imgH = hw; // square, so the outline maps exactly
  image(thenImg, M, 122, hw, imgH, `THEN, ${thenYear ?? ''}`);
  outline(thenTight?.bbox, M, 122, hw, imgH);
  image(nowImg, M + hw + 14, 122, hw, imgH, `NOW, ${nowYear ?? ''}`);
  outline(nowTight?.bbox, M + hw + 14, 122, hw, imgH);
  const y3 = 122 + imgH + 36;
  image(street, M, y3, hw, 200, 'STREET VIEW TODAY');
  image(ctxSat, M + hw + 14, y3, hw, 200, 'SUBJECT VS NEIGHBORS');
  text('Photos are a starting point for questions, not a finding. Confirm with the county.', M, y3 + 222, { w: CW, size: 8.5, color: C.muted });

  // ===== PAGE 4: NEGOTIATE + FACTS =========================================
  doc.addPage({ size: 'LETTER', margin: 0 });
  header('Use it in the deal', 'Negotiate');
  const colW = (CW - 18) / 2;
  const asks: string[] = [];
  if (badges[1].tone === 'red') asks.push('How old is the roof? Is there a permit?');
  if (badges[0].tone === 'amber') asks.push('Were any repairs or additions permitted?');
  if (badges[5].tone === 'amber') asks.push('What changed in the yard since 2010?');
  asks.push('Will you credit repairs or an after-the-fact permit?');
  const offers = [
    'Inspection and insurance-quote contingency.',
    'Permit and records contingency.',
    'Budget for sealed engineering if work is flagged.',
  ];
  const col = (title: string, items: string[], x: number, y: number) => {
    let cy = y;
    doc.roundedRect(x, y, colW, 154, 8).fill(C.paper);
    text(title.toUpperCase(), x + 14, y + 14, { w: colW - 28, size: 8, font: 'Helvetica-Bold', color: C.gold, spacing: 1.2 });
    cy = y + 34;
    for (const it of items.slice(0, 4)) {
      doc.circle(x + 18, cy + 5, 2).fill(C.navy);
      cy += text(it, x + 28, cy, { w: colW - 42, size: 10.5, color: C.ink }) + 8;
    }
  };
  col('Ask the seller', asks, M, 122);
  col('Put in the offer', offers, M + colW + 18, 122);

  let y4 = 122 + 154 + 28;
  y4 = sectionTitle('The property', y4);
  const p = r.property;
  const facts: Array<[string, string]> = [
    ['Built', String(p.yearBuilt ?? '-')],
    ['Living area', `${p.heatedArea?.toLocaleString('en-US') ?? '-'} sq ft`],
    ['Lot', `${p.lotSize?.toLocaleString('en-US') ?? '-'} sq ft`],
    ['Beds / baths', `${p.bedrooms ?? '-'} / ${p.bathrooms ?? '-'}`],
    ['Last sale', r.sales.length ? `$${(r.sales[r.sales.length - 1].price || 0).toLocaleString('en-US')}` : '-'],
    ['Folio', clean(p.folio)],
  ];
  facts.forEach((f, i) => {
    const x = M + (i % 3) * (bw + 12);
    const y = y4 + Math.floor(i / 3) * 42;
    text(f[0].toUpperCase(), x, y, { w: bw, size: 7, font: 'Helvetica-Bold', color: C.muted, spacing: 0.8 });
    text(f[1], x, y + 12, { w: bw, size: 12, font: 'Helvetica-Bold', color: C.ink });
  });
  y4 += 2 * 42 + 14;
  y4 = sectionTitle('Where this came from', y4);
  y4 += text(
    'County property appraiser, county permit and code records, FEMA flood map, USDA aerial photos (2010, 2022) and Google imagery. Records are digital only. Older paper permits may not appear.',
    M, y4, { size: 9, color: C.soft, gap: 3 },
  ) + 10;
  // CTA
  const ctaY = 618;
  doc.roundedRect(M, ctaY, CW, 96, 10).fill(C.navy);
  text('Want a second set of eyes?', M + 22, ctaY + 20, { w: CW - 160, size: 18, font: 'Times-Bold', color: C.white });
  text(`Palma Building Solutions reviews the records and scopes any sealed engineering.`, M + 22, ctaY + 48, { w: CW - 160, size: 10, color: '#c8d5ee' });
  text(phone, M + 22, ctaY + 68, { w: CW - 160, size: 13, font: 'Helvetica-Bold', color: C.gold });
  doc.image(qr, M + CW - 78, ctaY + 12, { width: 70 });

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
