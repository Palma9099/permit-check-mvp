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
import type { DiagnosticReport, VisionObservation } from './types';
import { pickDisplayFrames, resolutionLabel } from './images/historical-aerial';
import { computeReadiness } from './readiness';
import { PACKET_PRICE_NOTE, buildFixIts, buildInsurancePacket } from './fix-it';
import { SITE_ORIGIN } from './record-token';
import { PERSONAS, bandSummaryFor, personaCopy, type Persona } from './persona';
import { FOUND_NOTE, collectFindings, foundHeadline, sourceLabel } from './found';
import { buildGlance, glanceNextSteps, glanceVerdict, tipSections } from './glance';

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
  const frames = pickDisplayFrames(th.historicalAerials?.allFrames ?? []).slice(0, 3);
  const hsv = th.historicalStreetView;
  const googleHistory = (opts.streetHistory ?? []).slice(0, 4);
  const hasGoogleHistory = googleHistory.length >= 2;
  const hasStreetPair = !hasGoogleHistory && !!(hsv?.then && hsv?.now);
  const [sat, ctxSat, street, qr, svThen, svNow, ...frameImgs] = await Promise.all([
    fetchImage(th.satelliteImageUrl),
    fetchImage(th.contextSatelliteImageUrl),
    fetchImage(th.streetViewImages?.[0]?.imageUrl),
    QRCode.toBuffer(liveUrl, { margin: 1, width: 240, color: { dark: '#0f2547', light: '#ffffff' } }),
    hasStreetPair ? fetchImage(hsv!.then!.imageUrl) : Promise.resolve(null),
    hasStreetPair ? fetchImage(hsv!.now!.imageUrl) : Promise.resolve(null),
    ...frames.map((f) => fetchImage(f.displayImageUrl)),
  ]);
  const googleHistoryImgs = hasGoogleHistory ? await Promise.all(googleHistory.map((f) => fetchImage(f.imageUrl))) : [];

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
  text(`Folio ${r.property.folio ?? '-'}   |   ${clean(r.county.name)}   |   ${reportDate}${role && role !== 'other' ? `   |   Prepared for: ${PERSONAS[role].short}` : ''}`, M, metaY, { size: 9, color: '#9fb3d6' });
  // Visible changes with no permit: stated on the cover, detailed on the next page.
  const found = r.thenVsNow?.visualComparison?.performed ? collectFindings(r, opts.streetFindings) : null;
  if (found && found.length) {
    text(foundHeadline(role, found.length).toUpperCase(), M, metaY + 16, { size: 10, font: 'Helvetica-Bold', color: '#ff9b8f', spacing: 0.6 });
  }
  // Hero image
  const heroY = metaY + (found && found.length ? 44 : 30);
  const heroH = found && found.length ? 314 : 330;
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
  text(r.record?.path ? 'Scan to open the shareable property record.' : 'Scan to open this report online.', M, fy + 14, { size: 8, color: '#9fb3d6', w: 360 });
  text('Records review. Not an inspection or official determination.', M, fy + 34, { size: 7.5, color: '#9fb3d6', w: 400 });

  // ===== WHAT WE FOUND (right after the cover) ============================
  if (found && found.length) {
    doc.addPage({ size: 'LETTER', margin: 0 });
    header('What we found', 'Visible changes with no permit');
    doc.roundedRect(M, 118, CW, 54, 10).fill('#7a1d14');
    text(foundHeadline(role, found.length), M + 18, 135, { w: CW - 36, size: 17, font: 'Times-Bold', color: C.white });
    let yw = 186;
    for (const f of found) {
      const body = `${f.text}\nNo permit found for it in county records.`;
      const h = cardHeight(CW, f.area, body);
      if (yw + h > 720) {
        doc.addPage({ size: 'LETTER', margin: 0 });
        header('What we found', 'Continued');
        yw = 124;
      }
      toneCard(M, yw, CW, 'red', sourceLabel(f), f.area, body);
      yw += h + 10;
    }
    // Evidence: the photos the changes were read from.
    const ev: Array<{ buf: Buffer | null; cap: string; bbox?: Bbox }> = [];
    if (found.some((f) => f.sources.includes('aerial')) && frames.length >= 2) {
      ev.push({ buf: frameImgs[0] ?? null, cap: `AERIAL ${frames[0].captureYear}`, bbox: frames[0].displayBbox });
      ev.push({ buf: frameImgs[frames.length - 1] ?? null, cap: `AERIAL ${frames[frames.length - 1].captureYear}`, bbox: frames[frames.length - 1].displayBbox });
    }
    if (found.some((f) => f.sources.includes('street')) && hasGoogleHistory) {
      ev.push({ buf: googleHistoryImgs[0] ?? null, cap: `STREET VIEW ${googleHistory[0].label}`.toUpperCase() });
      ev.push({ buf: googleHistoryImgs[googleHistory.length - 1] ?? null, cap: `STREET VIEW ${googleHistory[googleHistory.length - 1].label}`.toUpperCase() });
    }
    if (ev.length) {
      // Square tiles, so the parcel outline maps exactly onto the aerial crops.
      const ew = Math.min((CW - (ev.length - 1) * 10) / ev.length, 180);
      const eh = ew;
      if (yw + eh + 70 > 740) {
        doc.addPage({ size: 'LETTER', margin: 0 });
        header('What we found', 'The photos');
        yw = 124;
      }
      yw += 6;
      ev.forEach((e, i) => {
        const x = M + i * (ew + 10);
        image(e.buf, x, yw, ew, eh, e.cap);
        if (e.bbox) outline(e.bbox, x, yw, ew, eh);
      });
      yw += eh + 26;
    }
    text(FOUND_NOTE, M, yw, { w: CW, size: 8.5, color: C.muted });
  }

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
    doc.note(ix - 2, y + 11, 14, 14, clean(`${b.label}\n\nWhat it is: ${b.info.what}${tipSections(role, b.info).map((t) => `\n\n${t.label}: ${t.text}`).join('')}`), { Name: 'Comment', Open: false } as any);
    const vh = text(b.value, x + 12, y + 32, { w: bw - 24, size: 16, font: 'Times-Bold', color: t.fg, gap: 0 });
    text(b.detail, x + 12, y + 38 + vh, { w: bw - 24, size: 9, color: C.soft });
  });
  let y2 = 122 + 2 * (bh + 12) + 10;
  doc.roundedRect(M, y2, CW, 64, 10).fill(C.navy);
  text(glanceVerdict(badges, role), M + 22, y2 + 20, { w: CW - 44, size: 19, font: 'Times-Bold', color: C.white });
  y2 += 64 + 26;
  y2 = sectionTitle('Do this next', y2);
  for (const step of glanceNextSteps(badges, role, r)) {
    doc.roundedRect(M, y2 + 1, 12, 12, 3).lineWidth(1.2).stroke(C.gold);
    y2 += text(step, M + 24, y2, { w: CW - 24, size: 12, color: C.ink }) + 12;
  }

  // ===== PAGE: CLOSING READINESS ==========================================
  const rd = r.readiness ?? computeReadiness(r);
  const RINGC: Record<string, string> = { ready: '#059669', 'fix-first': '#d97706', hard: '#ea580c', 'high-risk': '#b91c1c' };
  doc.addPage({ size: 'LETTER', margin: 0 });
  header(pc.readinessTitle, pc.readinessAsk);
  {
    const cx = M + 52;
    const cy = 190;
    doc.circle(cx, cy, 42).lineWidth(9).stroke('#e5e7eb');
    const steps = Math.max(2, Math.round((rd.score / 100) * 90));
    doc.lineWidth(9).lineCap('round').strokeColor(RINGC[rd.band]);
    for (let k = 0; k <= steps; k++) {
      const ang = -Math.PI / 2 + (k / 90) * 2 * Math.PI;
      const px = cx + 42 * Math.cos(ang);
      const py = cy + 42 * Math.sin(ang);
      if (k === 0) doc.moveTo(px, py);
      else doc.lineTo(px, py);
    }
    doc.stroke();
    doc.lineCap('butt');
    text(String(rd.score), cx - 40, cy - 17, { w: 80, size: 30, font: 'Times-Bold', color: C.navy, align: 'center' });
    text('out of 100', cx - 40, cy + 17, { w: 80, size: 7.5, color: C.muted, align: 'center' });
    text(rd.bandLabel, M + 124, 160, { w: CW - 124, size: 20, font: 'Times-Bold', color: RINGC[rd.band] });
    text(bandSummaryFor(role, rd), M + 124, 188, { w: CW - 124, size: 10, color: C.soft });
    text('A records-based indicator. It is not an insurer or lender decision.', M + 124, 222, { w: CW - 124, size: 8, color: C.muted });
  }
  let yr = 262;
  yr = sectionTitle('What moved the score', yr);
  // Clean items are already on the At a glance page; list them on one line.
  for (const f of rd.factors.filter((x) => x.penalty > 0)) {
    const col = f.tone === 'red' ? C.red : f.tone === 'amber' ? C.amber : f.tone === 'green' ? C.green : C.grey;
    text(f.label, M, yr, { w: 220, size: 9.5, font: 'Helvetica-Bold', color: C.ink });
    text(f.penalty === 0 ? 'No points lost' : `-${f.penalty} of ${f.max}`, M, yr, { w: CW, size: 8.5, font: 'Helvetica-Bold', color: col, align: 'right' });
    doc.roundedRect(M, yr + 14, CW, 4, 2).fill('#eef1f5');
    if (f.penalty > 0) doc.roundedRect(M, yr + 14, Math.max(8, (f.penalty / f.max) * CW), 4, 2).fill(col);
    text(f.reason, M, yr + 22, { w: CW, size: 8, color: C.soft });
    yr += 40;
  }
  const cleanItems = rd.factors.filter((x) => x.penalty === 0).map((x) => x.label);
  if (cleanItems.length) {
    text(`No points lost: ${cleanItems.join(', ')}.`, M, yr, { w: CW, size: 8.5, color: C.green });
    yr += 18;
  }
  yr += 6;
  yr = sectionTitle(pc.packetTitle, yr);
  for (const pk of buildInsurancePacket(r, rd)) {
    if (yr > 712) {
      doc.addPage({ size: 'LETTER', margin: 0 });
      header(pc.packetTitle, 'Continued');
      yr = 124;
    }
    const tone: Tone = pk.status === 'needed' ? 'red' : pk.status === 'recommended' ? 'amber' : 'green';
    pill(pk.status === 'ok' ? 'have' : pk.status, M, yr - 1, tone);
    text(pk.price ? `${pk.item}  ${pk.price}` : pk.item, M + 82, yr, { w: 170, size: 9, font: 'Helvetica-Bold' });
    text(pk.note, M + 255, yr, { w: CW - 255, size: 8, color: C.soft });
    yr += 28;
  }
  if (yr > 726) {
    doc.addPage({ size: 'LETTER', margin: 0 });
    header(pc.packetTitle, 'Continued');
    yr = 124;
  }
  text(PACKET_PRICE_NOTE, M, yr - 6, { w: CW, size: 8, color: C.muted });

  // ===== PAGE: FIX IT =====================================================
  const fixes = buildFixIts(r, rd);
  if (fixes.length) {
    doc.addPage({ size: 'LETTER', margin: 0 });
    header(pc.fixTitle, 'A real route for each problem');
    let yf = 124;
    const fw = (CW - 14) / 2;
    const cardOf = (f: (typeof fixes)[number]) => {
      const steps = f.steps.map((st, n) => `${n + 1}. ${st}`).join('\n');
      const meta = `Done by: ${f.owner}${f.cost ? `. Typical cost: ${f.cost}` : ''}${f.timeline ? `. Typical time: ${f.timeline}` : ''}.`;
      return { body: `${f.why}\n\n${steps}`, meta };
    };
    for (let i = 0; i < fixes.length; i += 2) {
      const row = fixes.slice(i, i + 2);
      const need = Math.max(...row.map((f) => cardHeight(fw, f.title, cardOf(f).body, cardOf(f).meta)));
      // Leave room for the quote band (y 690) on the page that ends the list.
      const limit = i + 2 >= fixes.length ? 678 : 740;
      if (yf + need > limit) {
        doc.addPage({ size: 'LETTER', margin: 0 });
        header(pc.fixTitle, 'Continued');
        yf = 124;
      }
      row.forEach((f, k) => {
        const x = M + k * (fw + 14);
        const tone: Tone = f.tone === 'red' ? 'red' : 'amber';
        const c = cardOf(f);
        toneCard(x, yf, fw, tone, tone === 'red' ? 'Fix first' : 'Worth fixing', f.title, c.body, c.meta);
      });
      yf += need + 12;
    }
    doc.roundedRect(M, 690, CW, 46, 8).fill(C.navy);
    text(`Get a fixed quote on any of these: call ${phone}, or request it from the live report.`, M + 18, 699, { w: CW - 36, size: 10.5, font: 'Helvetica-Bold', color: C.white });
    text(fixes[0].vendorNote, M + 18, 716, { w: CW - 36, size: 8, color: C.white });
  }

  // ===== PAGE 3: AERIAL TIMELINE ==========================================
  doc.addPage({ size: 'LETTER', margin: 0 });
  header('Then and now', 'Aerial timeline');
  const hw = (CW - 14) / 2;
  const cells: Array<{ buf: Buffer | null; caption: string; bbox?: Bbox }> = [
    ...frames.map((f, i) => ({
      buf: frameImgs[i] ?? null,
      caption: `${f.captureYear}${f.gsdMeters ? `, ${resolutionLabel(f.gsdMeters)}` : ''}`,
      bbox: f.displayBbox,
    })),
    { buf: sat, caption: 'TODAY, Google (sharpest available)' },
  ];
  cells.slice(0, 4).forEach((c, i) => {
    const x = M + (i % 2) * (hw + 14);
    const y = 122 + Math.floor(i / 2) * (hw + 34);
    image(c.buf, x, y, hw, hw, c.caption.toUpperCase());
    outline(c.bbox, x, y, hw, hw);
  });
  text('Older public aerials are softer than today. They are a starting point for questions, not a record. Confirm with the county.', M, 122 + 2 * (hw + 34) - 6, { w: CW, size: 8.5, color: C.muted });

  // ===== STREET VIEW HISTORY (Google, read in the browser) ================
  if (hasGoogleHistory) {
    doc.addPage({ size: 'LETTER', margin: 0 });
    header('Street view, then and now', 'Same spot, same direction');
    const sw = (CW - 14) / 2;
    const sh = 190;
    googleHistory.forEach((f, i) => {
      const x = M + (i % 2) * (sw + 14);
      const y = 122 + Math.floor(i / 2) * (sh + 38);
      image(googleHistoryImgs[i] ?? null, x, y, sw, sh, `${f.label}${i === 0 ? ', earliest' : i === googleHistory.length - 1 ? ', latest' : ''}`.toUpperCase());
    });
    const yy = 122 + Math.ceil(googleHistory.length / 2) * (sh + 38);
    text('Each photo is from the same street position, looking at the property. Compare paint, the roof, doors, gates and windows. A visible difference is a question to ask, not proof of unpermitted work.', M, yy, { w: CW, size: 9.5, color: C.soft });
    text('Street View imagery (c) Google.', M, yy + 42, { w: CW, size: 8, color: C.muted });
  }

  // ===== STREET PHOTOS, THEN AND NOW (when matching older photos exist) ====
  if (hasStreetPair) {
    doc.addPage({ size: 'LETTER', margin: 0 });
    header('Street view, then and now', 'Same spot, same direction');
    const ph = 250;
    image(svThen, M, 122, hw, ph, clean(hsv!.then!.label).toUpperCase());
    image(svNow, M + hw + 14, 122, hw, ph, clean(hsv!.now!.label).toUpperCase());
    text('Compare paint, the front door, gates, the garage door and windows. Photos are a starting point for questions, not a record. Confirm with the county.', M, 122 + ph + 36, { w: CW, size: 9.5, color: C.soft });
    text('Street photos (c) Mapillary contributors, licensed CC BY-SA 4.0. Photos are matched by camera position and direction.', M, 122 + ph + 70, { w: CW, size: 8, color: C.muted });
  }

  // ===== PAGE 4: STREET VIEW + COUNTY FACTS ================================
  doc.addPage({ size: 'LETTER', margin: 0 });
  header('Street level, money and safety', 'On the ground');
  const sv = th.streetViewImages?.[0];
  const svWhen = sv?.captureDate
    ? new Date(`${sv.captureDate}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : null;
  image(street, M, 122, hw, 170, `STREET VIEW${svWhen ? `, ${svWhen}`.toUpperCase() : ''}`);
  image(ctxSat, M + hw + 14, 122, hw, 170, 'SUBJECT VS NEIGHBORS');
  let y4x = 122 + 170 + 38;
  const xt = r.countyExtras;
  const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
  const cards: Array<{ tone: Tone; label: string; title: string; body: string; note?: string }> = [];
  if (xt?.tax) {
    const t = xt.tax;
    cards.push(
      t.increase > 0
        ? { tone: t.increase > t.currentTaxable * 0.1 ? 'amber' : 'green', label: 'Property tax after a sale', title: `+${money(t.increase)} taxable, about ${money(t.estAnnualIncrease)} a year`, body: `Taxes today use ${money(t.currentTaxable)}. The county values the home at ${money(t.marketValue)}. A sale resets the cap.`, note: `Assumes about ${(t.rateAssumed * 100).toFixed(1)}%. Your tax bill sets the exact amount.` }
        : { tone: 'green', label: 'Property tax after a sale', title: 'Little change expected', body: `Taxed value is already near the county value of ${money(t.marketValue)}.` },
    );
  }
  if (xt?.permitHealth) {
    const h = xt.permitHealth;
    cards.push({
      tone: h.expired > 0 ? 'red' : h.noInspection > 0 ? 'amber' : 'green',
      label: 'Permit status',
      title: `${h.expired ? `${h.expired} expired without a final, ` : ''}${h.closedOut} closed out${h.inspectedNoCloseout ? `, ${h.inspectedNoCloseout} inspected` : ''}${h.noInspection ? `, ${h.noInspection} not inspected` : ''}`,
      body: h.items.slice(0, 3).map((p) => `${p.appType ?? 'Permit'} ${p.issueDate?.slice(0, 4) ?? ''}: ${p.status}`).join('. '),
      note: 'Inspected means an approved inspection is logged but no close-out date. The final paperwork should be on file.',
    });
  }
  if (xt?.evacuation) {
    const e = xt.evacuation;
    cards.push({
      tone: 'grey',
      label: 'Hurricane zone',
      title: e.zone ? `Evacuation Zone ${e.zone}` : 'No evacuation zone',
      body: `${e.zone ? `Evacuation is ordered here for Category ${e.category ?? '?'} storms and stronger. ` : ''}Miami-Dade is a High-Velocity Hurricane Zone: roofs, windows and doors need Miami-Dade product approval.`,
    });
  }
  if (xt?.sewer) {
    const w = xt.sewer;
    cards.push({
      tone: w.septicOrWellFlag || !w.inServiceArea ? 'amber' : 'green',
      label: 'Sewer or septic',
      title: w.septicOrWellFlag ? 'Possibly septic or well' : w.inServiceArea ? 'County sewer area' : 'Outside county sewer',
      body: w.summary,
    });
  }
  for (let i = 0; i < cards.length; i += 2) {
    const pair = cards.slice(i, i + 2);
    let rowH = 0;
    pair.forEach((c, k) => {
      const h = toneCard(M + k * (hw + 14), y4x, hw, c.tone, c.label, c.title, c.body, c.note);
      rowH = Math.max(rowH, h);
    });
    y4x += rowH + 12;
  }
  if (!cards.length) text('County tax, permit status, hurricane zone and sewer details are available for Miami-Dade properties.', M, y4x, { w: CW, size: 10, color: C.muted });

  // ===== PAGE 4: NEGOTIATE + FACTS =========================================
  doc.addPage({ size: 'LETTER', margin: 0 });
  header(pc.dealPageTitle, pc.dealPageKicker);
  const colW = (CW - 18) / 2;
  const glanceFixes = buildFixIts(r, r.readiness ?? computeReadiness(r)).map((f) => f.title);
  const packetNames = buildInsurancePacket(r, r.readiness ?? computeReadiness(r))
    .filter((p) => p.status !== 'ok')
    .map((p) => p.item);
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
  const leftTitle = role === 'seller' ? 'Fix before you list' : role === 'owner' ? 'Look after' : role === 'pro' ? 'Questions for the seller' : role === 'other' ? 'Ask the owner or seller' : 'Ask the seller';
  const leftItems = role === 'seller' || role === 'owner' ? (glanceFixes.length ? glanceFixes : ['Nothing urgent found in the records.']) : asks;
  const rightTitle = role === 'seller' ? 'Have ready for buyers' : role === 'owner' ? 'Papers to keep' : role === 'pro' ? 'Terms to put in the offer' : role === 'other' ? 'Worth getting in writing' : 'Put in the offer';
  const rightItems = role === 'seller' || role === 'owner' ? (packetNames.length ? packetNames : ['Permit finals and inspection reports.']) : role === 'other' ? ['Inspection and insurance-quote results.', 'Permit finals and records.', 'A written list of known repairs.'] : offers;
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
  col(leftTitle, leftItems, M, 122);
  col(rightTitle, rightItems, M + colW + 18, 122);

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
    ...(xt?.replacementCostNew ? ([['Rebuild cost (county)', money(xt.replacementCostNew)]] as Array<[string, string]>) : []),
  ];
  facts.forEach((f, i) => {
    const x = M + (i % 3) * (bw + 12);
    const y = y4 + Math.floor(i / 3) * 42;
    text(f[0].toUpperCase(), x, y, { w: bw, size: 7, font: 'Helvetica-Bold', color: C.muted, spacing: 0.8 });
    text(f[1], x, y + 12, { w: bw, size: 12, font: 'Helvetica-Bold', color: C.ink });
  });
  y4 += Math.ceil(facts.length / 3) * 42 + 14;
  y4 = sectionTitle('Where this came from', y4);
  y4 += text(
    /miami-dade/i.test(r.county?.name ?? '')
      ? 'County property appraiser, county permit and code records, FEMA flood map, county aerial photos and Google imagery. Permits: every one issued since 2020, plus older permits still open or expired. Older closed permits need the certified permit history.'
      : 'County property appraiser, county permit and code records, FEMA flood map, USDA aerial photos and Google imagery. Records are digital only. Older paper permits may not appear.',
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
