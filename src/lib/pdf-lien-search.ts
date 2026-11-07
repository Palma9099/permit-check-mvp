// PDF of a lien search. Without `final` it is the preliminary county search,
// with the staff steps (taxes, Official Records, utilities, city letter) listed
// as pending. With `final` it is the finished search Palma delivers: staff
// results in place of "pending", the reviewer, and the record id.

import PDFDocument from 'pdfkit';
import type { LienSearch, LienTone } from './lien-search';
import type { LienClient, StaffResult } from './lien-records';
import { LIEN_SEARCH_PRICE, LIEN_SEARCH_TURNAROUND } from './lien-search-config';

const C = {
  navy: '#0b1730',
  ink: '#101828',
  soft: '#475467',
  muted: '#667085',
  line: '#e4e7ec',
  gold: '#d9b46a',
  red: '#b42318',
  redBg: '#fef3f2',
  amber: '#b54708',
  amberBg: '#fffaeb',
  green: '#067647',
  greenBg: '#ecfdf3',
};
const TONE: Record<LienTone, string> = { red: C.red, amber: C.amber, green: C.green };

// Built-in fonts only cover WinAnsi, and house style has no long dashes.
const clean = (s: unknown) =>
  String(s ?? '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x09\x0a\x20-\x7e -ÿ]/g, '')
    .trim();

export interface FinalInfo {
  id: string;
  reviewer: string;
  completedAt: string;
  staff: StaffResult[];
  notes: string | null;
  client: LienClient | null;
}

const et = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

export async function lienSearchPdf(r: LienSearch, final?: FinalInfo): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 0, bottom: 40, left: 0, right: 0 }, info: { Title: `Lien search ${r.prettyFolio}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  const W = doc.page.width;
  const M = 48;
  const CW = W - M * 2;
  const bottom = () => doc.page.height - 56;
  const room = (h: number) => {
    if (doc.y + h > bottom()) {
      doc.addPage();
      doc.y = 48;
    }
  };

  // Header band.
  doc.rect(0, 0, W, 150).fill(C.navy);
  doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(9).text(final ? 'FINAL LIEN SEARCH  ·  MIAMI-DADE COUNTY' : 'PALMA LIEN SEARCH  ·  MIAMI-DADE COUNTY', M, 34, { characterSpacing: 1.5 });
  const [street, ...rest] = clean(r.address).split(',');
  doc.fillColor('#ffffff').font('Times-Bold').fontSize(28).text(street, M, 52, { width: CW });
  doc.fillColor('#c8d5ee').font('Helvetica').fontSize(10).text(rest.join(',').replace(/-0000\b/, '').trim(), M, doc.y + 2, { width: CW });
  doc.fillColor('#c8d5ee').fontSize(9).text(`County records searched ${et(r.searchedAt)} ET`, M, final ? 112 : 122);
  if (final) doc.text(`Completed ${et(final.completedAt)} ET by ${clean(final.reviewer)}, Palma Building Solutions  ·  Record ${final.id}`, M, 126);

  // Property facts.
  doc.y = 172;
  const facts: Array<[string, string]> = [
    ['Folio', r.prettyFolio],
    ['Owner of record', clean(r.owner) || 'Not shown'],
    ['Municipality', clean(r.municipality) || 'Not shown'],
    ['Legal description', clean(r.legal) || 'Not shown'],
  ];
  const ordered = [final?.client?.company, final?.client?.name].map(clean).filter(Boolean).join(', ');
  if (ordered) facts.push(['Ordered by', ordered]);
  if (final?.client?.closingDate) facts.push(['Closing date', clean(final.client.closingDate)]);
  for (const [k, v] of facts) {
    const y = doc.y;
    doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(8).text(k.toUpperCase(), M, y, { width: 120, characterSpacing: 0.6 });
    doc.fillColor(C.ink).font('Helvetica').fontSize(10).text(v, M + 125, y - 1, { width: CW - 125 });
    doc.y = Math.max(doc.y, y + 12) + 6;
  }

  // Result banner.
  doc.y += 6;
  const staffFound = final ? final.staff.filter((s) => s.result === 'found').length : 0;
  const total = r.found + staffFound;
  const bad = total > 0;
  const by = doc.y;
  doc.roundedRect(M, by, CW, 44, 8).fill(bad ? C.redBg : r.failed ? C.amberBg : C.greenBg);
  doc
    .fillColor(bad ? C.red : r.failed ? C.amber : C.green)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(
      final
        ? bad
          ? `${total} item${total > 1 ? 's' : ''} to resolve before closing`
          : 'Clear: nothing found to resolve'
        : bad
        ? `${r.found} item${r.found > 1 ? 's' : ''} found in county records`
        : r.failed
        ? 'Some county sources did not answer'
        : 'County records are clear',
      M + 16,
      by + 9,
    );
  doc
    .fillColor(C.soft)
    .font('Helvetica')
    .fontSize(9)
    .text(
      final
        ? 'County records, property taxes, Official Records and utilities, checked on the dates shown.'
        : 'Preliminary: county records only. Taxes, Official Records and utilities are completed by Palma staff before delivery.',
      M + 16,
      by + 27,
      { width: CW - 32 },
    );
  doc.y = by + 60;

  // Staff steps: what staff found (first, when final) or "pending" (last).
  const drawStaff = () => {
    if (final) {
      room(40 + final.staff.length * 34);
      doc.fillColor(C.ink).font('Times-Bold').fontSize(14).text('Taxes, Official Records and utilities', M, doc.y);
      doc.fillColor(C.soft).font('Helvetica').fontSize(9.5).text(`Checked by ${clean(final.reviewer)}, Palma Building Solutions.`, M, doc.y + 2, { width: CW });
      for (const s of final.staff) {
        const y = doc.y + 8;
        const found = s.result === 'found';
        doc.circle(M + 4, y + 5, 3).fill(found ? C.red : C.green);
        doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(9.5).text(`${clean(s.title)}  `, M + 14, y, { continued: true });
        doc.fillColor(found ? C.red : C.green).font('Helvetica-Bold').fontSize(8).text(found ? `FOUND${s.amount ? `  ${clean(s.amount)}` : ''}` : 'CLEAR');
        if (s.note) doc.fillColor(C.soft).font('Helvetica').fontSize(9).text(clean(s.note), M + 14, doc.y + 1, { width: CW - 14 });
      }
      if (final.notes) {
        room(50);
        doc.fillColor(C.ink).font('Times-Bold').fontSize(14).text('Notes', M, doc.y + 14);
        doc.fillColor(C.soft).font('Helvetica').fontSize(9.5).text(clean(final.notes), M, doc.y + 2, { width: CW });
      }
    } else {
      room(40 + r.staffSteps.length * 30);
      doc.fillColor(C.ink).font('Times-Bold').fontSize(14).text('Completed by Palma staff before delivery', M, doc.y);
      doc.fillColor(C.soft).font('Helvetica').fontSize(9.5).text(`These sources sit behind a captcha or a request form. Full search: ${LIEN_SEARCH_PRICE}, ${LIEN_SEARCH_TURNAROUND.toLowerCase()}.`, M, doc.y + 2, { width: CW });
      for (const s of r.staffSteps) {
        const y = doc.y + 8;
        doc.rect(M, y + 1, 9, 9).lineWidth(0.8).strokeColor(C.muted).stroke();
        doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(9.5).text(`${s.title}  `, M + 16, y, { continued: true });
        doc.fillColor(C.amber).font('Helvetica-Bold').fontSize(8).text('PENDING');
        doc.fillColor(C.soft).font('Helvetica').fontSize(9).text(clean(s.how), M + 16, doc.y + 1, { width: CW - 16 });
      }
    }

  };

  if (final) {
    drawStaff();
    doc.y += 22;
  }

  // Sections.
  for (const s of r.sections) {
    room(60);
    const y = doc.y;
    const chip = s.state === 'clear' ? 'CLEAR' : s.state === 'failed' ? 'NOT CHECKED' : 'FOUND';
    const color = s.state === 'clear' ? C.green : s.state === 'failed' ? C.amber : C.red;
    doc.fillColor(C.ink).font('Times-Bold').fontSize(14).text(s.title, M, y, { width: CW - 100 });
    doc.fillColor(color).font('Helvetica-Bold').fontSize(8).text(chip, M + CW - 90, y + 3, { width: 90, align: 'right', characterSpacing: 1 });
    doc.fillColor(C.soft).font('Helvetica').fontSize(9.5).text(s.summary, M, doc.y + 2, { width: CW });
    for (const l of s.lines.slice(0, 14)) {
      doc.font('Helvetica').fontSize(9);
      const h = doc.heightOfString(clean(l.detail), { width: CW - 14 }) + 18;
      room(h);
      const ly = doc.y + 6;
      doc.circle(M + 4, ly + 5, 3).fill(TONE[l.tone]);
      doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(9.5).text(clean(l.title), M + 14, ly, { width: CW - 14 });
      doc.fillColor(C.soft).font('Helvetica').fontSize(9).text(clean(l.detail), M + 14, doc.y + 1, { width: CW - 14 });
    }
    if (s.lines.length > 14) doc.fillColor(C.muted).fontSize(8.5).text(`And ${s.lines.length - 14} more.`, M + 14, doc.y + 2);
    doc.fillColor(C.muted).font('Helvetica').fontSize(7.5).text(`Source: ${s.source}`, M, doc.y + 5, { width: CW });
    doc.moveTo(M, doc.y + 10).lineTo(M + CW, doc.y + 10).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.y += 20;
  }

  if (!final) drawStaff();

  // Disclaimer.
  room(70);
  doc.y += 16;
  doc
    .fillColor(C.muted)
    .font('Helvetica')
    .fontSize(7.5)
    .text(
      'A search of Miami-Dade County public records on the date and time shown, by folio. It reports what those records show and is not title insurance, a payoff letter, an estoppel letter or a guarantee. Amounts owed are confirmed with the agency that holds the lien. Palma Building Solutions, palma.llc.',
      M,
      doc.y,
      { width: CW },
    );

  doc.end();
  return done;
}
