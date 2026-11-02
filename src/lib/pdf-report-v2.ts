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

interface Badge {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}

function buildBadges(r: DiagnosticReport): Badge[] {
  const age = r.property.yearBuilt ? new Date().getFullYear() - r.property.yearBuilt : null;
  const nPermits = r.permitHistory.totalSubjectPermits;
  const permits: Badge =
    nPermits === 0
      ? {
          label: 'Permits on file',
          value: 'None found',
          detail: age ? `Home is about ${age} years old; no permit appears in county records.` : 'No permit appears in county records.',
          tone: age && age > 15 ? 'amber' : 'grey',
        }
      : { label: 'Permits on file', value: `${nPermits} found`, detail: 'See permit history in the detail pages.', tone: 'green' };

  const roofRisk = r.insurance.band === 'old' || r.insurance.band === 'unknown';
  const roof: Badge = {
    label: 'Roof and insurability',
    value: roofRisk ? 'Needs a closer look' : 'No roof concern on record',
    detail: roofRisk ? 'No roof permit on file, so the roof may be original. Insurers often require replacement at this age.' : 'No roof concern on the permit record.',
    tone: roofRisk ? 'red' : 'green',
  };

  const flood: Badge = {
    label: 'Flood zone',
    value: r.flood.zone ? `FEMA Zone ${r.flood.zone}` : 'Not determined',
    detail: r.flood.inSFHA ? 'Inside a high-risk flood area.' : 'Outside the mapped high-risk flood areas.',
    tone: r.flood.zone ? (r.flood.inSFHA ? 'red' : 'green') : 'grey',
  };

  const recertNA = /no|unlikely|not/i.test(String(r.recert.applies));
  const recert: Badge = {
    label: 'Milestone / recert',
    value: recertNA ? 'Unlikely to apply' : 'May apply',
    detail: recertNA ? 'Aimed at condos and larger buildings, not single-family homes.' : firstSentence(r.recert.detail) + '.',
    tone: recertNA ? 'grey' : 'amber',
  };

  const openCases = r.codeEnforcement.openCount;
  const code: Badge = {
    label: 'Code enforcement',
    value: openCases === 0 ? 'No open cases' : `${openCases} open`,
    detail: `${r.codeEnforcement.closedPast5yCount} closed in the past 5 years.`,
    tone: openCases === 0 ? 'green' : 'red',
  };

  const vc = r.thenVsNow.visualComparison;
  const flags = vc?.performed ? vc.observations.filter((o) => o.severity === 'flag').length : 0;
  const imagery: Badge = vc?.performed
    ? {
        label: 'Aerial changes since 2010',
        value: flags ? `${flags} to review` : 'Nothing notable',
        detail: 'Compared 2010 and 2022 aerials against the permit record. Details on the next pages.',
        tone: flags ? 'amber' : 'green',
      }
    : { label: 'Aerial changes', value: 'Not compared', detail: 'Historical imagery was not available.', tone: 'grey' };

  return [permits, roof, flood, recert, code, imagery];
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
  const [sat, ctxSat, thenImg, nowImg, street, qr] = await Promise.all([
    fetchImage(th.satelliteImageUrl),
    fetchImage(th.contextSatelliteImageUrl),
    fetchImage(th.historicalAerials?.then?.imageUrl),
    fetchImage(th.historicalAerials?.now?.imageUrl),
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
  text('RECORDS AND IMAGERY TRIAGE', M, 150, { size: 9, font: 'Helvetica-Bold', color: C.gold, spacing: 2 });
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
  text('CURRENT SATELLITE VIEW. RED OUTLINE MARKS THE SUBJECT PARCEL.', M, heroY + heroH + 7, { size: 7, color: '#9fb3d6', spacing: 0.8 });
  // Footer band: facts + QR
  const fy = 690;
  doc.rect(0, fy - 20, W, H - (fy - 20)).fill('#0b1c38');
  doc.image(qr, W - M - 70, fy - 4, { width: 70 });
  text(`Report ID  ${reportId}`, M, fy, { size: 9, font: 'Helvetica-Bold', color: C.white });
  text('Scan to open or re-run this report on the live site.', M, fy + 14, { size: 8, color: '#9fb3d6', w: 360 });
  text('A records-level review for context. It is not an official compliance determination, legal advice, or an inspection.', M, fy + 34, { size: 7.5, color: '#9fb3d6', w: 400 });

  // ===== PAGE 2: SCORECARD =================================================
  doc.addPage({ size: 'LETTER', margin: 0 });
  header('At a glance', 'Scorecard');
  const badges = buildBadges(r);
  const bw = (CW - 24) / 3;
  const bh = 124;
  badges.forEach((b, i) => {
    const x = M + (i % 3) * (bw + 12);
    const y = 122 + Math.floor(i / 3) * (bh + 12);
    const t = TONE[b.tone];
    doc.roundedRect(x, y, bw, bh, 8).fill(C.white).lineWidth(0.8).stroke(C.line);
    doc.roundedRect(x, y, bw, 5, 2.5).fill(t.fg);
    text(b.label.toUpperCase(), x + 12, y + 16, { w: bw - 24, size: 7, font: 'Helvetica-Bold', color: C.muted, spacing: 0.8 });
    const vh = text(b.value, x + 12, y + 32, { w: bw - 24, size: 14, font: 'Times-Bold', color: t.fg, gap: 0 });
    text(b.detail, x + 12, y + 36 + vh, { w: bw - 24, size: 8.5, color: C.soft });
  });
  let y2 = 122 + 2 * (bh + 12) + 14;
  y2 = sectionTitle('Bottom line', y2);
  for (const line of r.bottomLine) {
    doc.circle(M + 4, y2 + 5, 2).fill(C.gold);
    y2 += text(line, M + 16, y2, { w: CW - 16, size: 10.5, color: C.ink, gap: 3 }) + 8;
  }
  y2 += 6;
  const top = [...r.flags.strong, ...r.flags.medium].filter((f) => !/homestead/i.test(f.title)).slice(0, 3);
  if (top.length) {
    y2 = sectionTitle('Top items to ask about', y2);
    for (const f of top) {
      const tone: Tone = f.severity === 'strong' ? 'red' : 'amber';
      const h = toneCard(M, y2, CW, tone, f.severity === 'strong' ? 'Strong signal' : 'Worth a question', f.title, f.detail);
      y2 += h + 10;
    }
  }

  // ===== PAGE 3: IMAGERY ===================================================
  doc.addPage({ size: 'LETTER', margin: 0 });
  header('Then and now', 'Aerial and street imagery');
  const hw = (CW - 14) / 2;
  const thenYear = th.historicalAerials?.then?.captureYear;
  const nowYear = th.historicalAerials?.now?.captureYear;
  const imgH = 250;
  image(thenImg, M, 122, hw, imgH, `THEN, ${thenYear ?? ''} (USDA NAIP aerial)`);
  image(nowImg, M + hw + 14, 122, hw, imgH, `NOW, ${nowYear ?? ''} (USDA NAIP aerial)`);
  let y3 = 122 + imgH + 30;
  if (th.visualComparison?.performed) {
    y3 += toneCard(M, y3, CW, 'grey', 'What the comparison shows', firstSentence(th.visualComparison.summary, 170) + '.', 'This is an automated visual comparison, a starting point for questions. Confirm anything notable with the county.') + 14;
  }
  const lowerH = 190;
  image(street, M, y3, hw, lowerH, 'CURRENT STREET VIEW, FRONT OF PROPERTY (Google)');
  image(ctxSat, M + hw + 14, y3, hw, lowerH, 'BLOCK CONTEXT, SUBJECT VS NEIGHBORS (Google)');

  // ===== PAGE 4: RISK DETAIL ==============================================
  doc.addPage({ size: 'LETTER', margin: 0 });
  header('Insurance, flood and recertification', 'Florida risk factors');
  let y4 = 124;
  const roofTone: Tone = r.insurance.band === 'old' || r.insurance.band === 'unknown' ? 'red' : 'green';
  y4 += toneCard(M, y4, CW, roofTone, 'Roof and insurability', firstSentence(r.insurance.roofBasis, 150) + '.', clean(r.insurance.insurabilityNote), 'Estimate from the permit record, not an insurance quote.') + 12;
  for (const rec of r.insurance.recommendations.slice(0, 4)) {
    doc.circle(M + 4, y4 + 5, 2).fill(C.gold);
    y4 += text(rec, M + 16, y4, { w: CW - 16, size: 9.5, color: C.soft }) + 5;
  }
  y4 += 10;
  y4 += toneCard(M, y4, CW, r.flood.inSFHA ? 'red' : 'green', 'Flood zone', `FEMA Zone ${r.flood.zone ?? 'unknown'}`, clean(r.flood.summary) + ' ' + clean(r.flood.insuranceNote), 'The mapped zone can differ for a specific parcel. Confirm on the FEMA Map Service Center (msc.fema.gov).') + 12;
  y4 += toneCard(M, y4, CW, 'grey', 'Milestone and recertification', 'Applicability', clean(r.recert.detail), 'Thresholds and timing are set by each jurisdiction. Confirm the current requirement with the county.') + 12;

  // ===== PAGE 5: NEGOTIATION ==============================================
  doc.addPage({ size: 'LETTER', margin: 0 });
  header('What this means and how to use it', 'Negotiation guide');
  const neg = r.negotiation ?? { exposureSummary: 'No negotiation items were generated for this property.', items: [], sellerQuestions: [], contingencyItems: [] };
  let y5 = 124;
  y5 += text(clean(neg.exposureSummary), M, y5, { size: 10.5, color: C.soft, gap: 3 }) + 14;
  for (const it of neg.items.slice(0, 2)) {
    const h = toneCard(M, y5, CW, it.engineeringLikely ? 'amber' : 'grey', it.engineeringLikely ? 'Sealed engineering likely' : 'Resolution path', it.finding, `${clean(it.what)} ${clean(it.path)}`);
    y5 += h + 10;
  }
  y5 += 4;
  y5 = sectionTitle('Questions to ask the seller', y5);
  for (const q of neg.sellerQuestions.slice(0, 4)) {
    doc.circle(M + 4, y5 + 5, 2).fill(C.gold);
    y5 += text(q, M + 16, y5, { w: CW - 16, size: 9.5, color: C.ink }) + 6;
  }
  y5 += 8;
  y5 = sectionTitle('Contingencies to consider', y5);
  for (const q of neg.contingencyItems.slice(0, 4)) {
    doc.circle(M + 4, y5 + 5, 2).fill(C.gold);
    y5 += text(q, M + 16, y5, { w: CW - 16, size: 9.5, color: C.ink }) + 6;
  }

  // ===== PAGE 6: FACTS, SOURCES, CTA ======================================
  doc.addPage({ size: 'LETTER', margin: 0 });
  header('Property facts and sources', 'Reference');
  let y6 = 124;
  const p = r.property;
  const facts: Array<[string, string]> = [
    ['Folio', clean(p.folio)],
    ['Year built', String(p.yearBuilt ?? '-')],
    ['Heated / total area', `${p.heatedArea?.toLocaleString('en-US') ?? '-'} / ${p.totalArea?.toLocaleString('en-US') ?? '-'} sq ft`],
    ['Lot size', `${p.lotSize?.toLocaleString('en-US') ?? '-'} sq ft`],
    ['Bedrooms / bathrooms', `${p.bedrooms ?? '-'} / ${p.bathrooms ?? '-'}`],
    ['Use', /single family/i.test(p.dorDescription ?? '') ? 'Single family' : clean(p.dorDescription).slice(0, 26)],
    ['Homestead', p.homesteadPercent ? `${p.homesteadPercent}%` : 'None on file'],
    ['Permits on file', String(r.permitHistory.totalSubjectPermits)],
    ['Open code cases', String(r.codeEnforcement.openCount)],
  ];
  facts.forEach((f, i) => {
    const x = M + (i % 3) * (bw + 12);
    const y = y6 + Math.floor(i / 3) * 44;
    text(f[0].toUpperCase(), x, y, { w: bw, size: 7, font: 'Helvetica-Bold', color: C.muted, spacing: 0.8 });
    text(f[1], x, y + 12, { w: bw, size: 11, font: 'Helvetica-Bold', color: C.ink });
  });
  y6 += 3 * 44 + 6;
  y6 = sectionTitle('Sales history', y6);
  for (const s of r.sales.slice(0, 5)) {
    text(clean(s.date), M, y6, { w: 90, size: 9, color: C.soft });
    text(s.price ? '$' + s.price.toLocaleString('en-US') : '$0', M + 90, y6, { w: 90, size: 9, font: 'Helvetica-Bold' });
    text(clean(s.qualificationDescription), M + 190, y6, { w: CW - 190, size: 9, color: C.soft });
    y6 += 15;
  }
  y6 += 12;
  y6 = sectionTitle('How we sourced this', y6);
  for (const c of r.confidenceAssessment.slice(0, 5)) {
    const tone: Tone = c.grade === 'high' ? 'green' : c.grade === 'medium' ? 'amber' : 'grey';
    pill(c.grade, M, y6 - 1, tone);
    const h = text(`${clean(c.topic)}. ${clean(c.note)}`, M + 70, y6, { w: CW - 70, size: 8.5, color: C.soft });
    y6 += Math.max(h, 15) + 7;
  }
  y6 += 4;
  text('Sources: ' + r.dataSources.map(clean).filter((s) => !/anthropic|claude/i.test(s)).join('; ') + '.', M, y6, { size: 7.5, color: C.muted, gap: 2 });
  // CTA band
  const ctaY = 640;
  doc.roundedRect(M, ctaY, CW, 74, 10).fill(C.navy);
  text('Want a second set of eyes on this property?', M + 20, ctaY + 16, { w: CW - 40, size: 14, font: 'Times-Bold', color: C.white });
  text(`Palma Building Solutions can walk through these records, explain the options, and scope any sealed engineering. Call ${phone}.`, M + 20, ctaY + 38, { w: CW - 150, size: 9, color: '#c8d5ee' });
  doc.image(qr, M + CW - 62, ctaY + 8, { width: 58 });

  // ---- footers on pages 2..n ----------------------------------------------
  const range = doc.bufferedPageRange();
  for (let i = 1; i < range.count; i++) {
    doc.switchToPage(i);
    doc.moveTo(M, H - 38).lineTo(W - M, H - 38).lineWidth(0.5).stroke(C.line);
    text(`Records-level triage, not legal advice or an official determination. Verify with ${clean(r.ahj.name)} before acting.`, M, H - 30, { w: CW - 90, size: 7, color: C.muted });
    text(`${reportId}   |   Page ${i + 1} of ${range.count}`, M, H - 30, { w: CW, size: 7, color: C.muted, align: 'right' });
  }

  doc.end();
  return done;
}
