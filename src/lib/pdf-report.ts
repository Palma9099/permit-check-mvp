// Build a Word-equivalent PDF from a DiagnosticReport using pdfkit.
//
// Uses only the built-in AFM fonts (Helvetica + Times-Roman) so we don't
// need any font files on disk in the Vercel serverless environment. The
// Esri satellite image is fetched server-side and embedded inline so the
// PDF is self-contained — no missing-image icons when viewed offline.

import PDFDocument from 'pdfkit';
import type { DiagnosticReport, Flag } from './types';

// Palette — mirrors the HTML Report.tsx gradient + badge colors.
const COLORS = {
  inkDark: '#0b1628',
  ink: '#1f2937',
  inkSoft: '#374151',
  inkMuted: '#6b7280',
  line: '#d1d5db',
  cover: '#102447',
  coverAccent: '#1f3864',
  strong: '#b91c1c',
  strongBg: '#fee2e2',
  medium: '#b45309',
  mediumBg: '#fef3c7',
  weak: '#4b5563',
  weakBg: '#f3f4f6',
  ok: '#15803d',
  okBg: '#dcfce7',
  card: '#ffffff',
};

function fmtNum(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
  return n.toLocaleString('en-US');
}
function fmtYear(n: number | null | undefined): string {
  // Years should not have a thousands separator.
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
  return String(Math.trunc(n));
}
function fmtMoney(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
  return '$' + n.toLocaleString('en-US');
}

function severityBg(severity: Flag['severity']): string {
  if (severity === 'strong') return COLORS.strongBg;
  if (severity === 'medium') return COLORS.mediumBg;
  return COLORS.weakBg;
}
function severityLabel(severity: Flag['severity']): { label: string; color: string } {
  if (severity === 'strong') return { label: 'STRONG', color: COLORS.strong };
  if (severity === 'medium') return { label: 'MEDIUM', color: COLORS.medium };
  return { label: 'WEAK', color: COLORS.weak };
}
function gradeLabel(grade: string): { label: string; color: string } {
  if (grade === 'high') return { label: 'HIGH', color: COLORS.ok };
  if (grade === 'medium') return { label: 'MEDIUM', color: COLORS.medium };
  if (grade === 'low') return { label: 'LOW', color: COLORS.strong };
  return { label: 'NOT OBSERVED', color: COLORS.weak };
}

async function fetchImageBuffer(url: string, timeoutMs = 8000): Promise<Buffer | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function buildPdf(report: DiagnosticReport): Promise<Buffer> {
  // Pre-fetch the Esri satellite image in parallel with PDF build-up so we're
  // not bottlenecked serially. If the fetch fails we quietly drop the image.
  const satelliteBufferPromise = report.thenVsNow?.satelliteImageUrl
    ? fetchImageBuffer(report.thenVsNow.satelliteImageUrl)
    : Promise.resolve(null);

  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 56, bottom: 64, left: 56, right: 56 },
    bufferPages: true,
    info: {
      Title: `Permit History & Unpermitted Improvement Check — ${report.property.siteAddress ?? report.query.address}`,
      Author: 'Palma Property Intelligence',
      Subject: 'Permit History & Unpermitted Improvement Check',
      Producer: 'Permit Check MVP',
      CreationDate: new Date(report.generatedAt),
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  // ==========================================================================
  // Cover band
  // ==========================================================================
  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - 112; // 56 margin each side
  const coverHeight = 170;
  doc.rect(0, 0, pageWidth, coverHeight).fill(COLORS.cover);
  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('PALMA PROPERTY INTELLIGENCE · DIAGNOSTIC REPORT', 56, 28, {
      characterSpacing: 2,
    });
  doc
    .font('Times-Bold')
    .fontSize(22)
    .fillColor('#ffffff')
    .text(report.property.siteAddress ?? report.query.address, 56, 52, {
      width: contentWidth,
    });
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#c7d2fe')
    .text(
      `Folio ${report.property.folio ?? '—'}  ·  ${report.ahj.name}  ·  ${new Date(report.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
      56,
      doc.y + 6,
      { width: contentWidth },
    );

  // Jump below the cover for body content.
  doc.y = coverHeight + 24;
  doc.x = 56;
  doc.fillColor(COLORS.ink);

  // ==========================================================================
  // Bottom line callout
  // ==========================================================================
  const calloutTop = doc.y;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.inkMuted)
    .text('BOTTOM LINE', 56, calloutTop, { characterSpacing: 1 });
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.ink);
  for (const line of report.bottomLine) {
    const y = doc.y;
    doc.text('·  ', 56, y, { continued: true }).text(line, { width: contentWidth - 8 });
    doc.moveDown(0.15);
  }
  // Rule under the callout
  doc.moveDown(0.5);
  const ruleY = doc.y;
  doc.strokeColor(COLORS.line).lineWidth(0.5).moveTo(56, ruleY).lineTo(pageWidth - 56, ruleY).stroke();
  doc.moveDown(0.8);

  // ==========================================================================
  // Top flags
  // ==========================================================================
  const allFlags = [...report.flags.strong, ...report.flags.medium];
  if (allFlags.length > 0) {
    sectionHeading(doc, 'Top flags');
    for (const f of allFlags) {
      renderFlagCard(doc, f, contentWidth);
    }
  }

  // ==========================================================================
  // Then vs Now — visual review
  // ==========================================================================
  if (report.thenVsNow && report.thenVsNow.coordinates) {
    sectionHeading(doc, 'Then vs Now — visual review');
    paragraph(
      doc,
      "Records tell half the story. The current satellite frame below is the county's own imagery. Flip to Street View and the historical-aerials viewer using the links, then run the checklist against what the permit record does or doesn't confirm.",
      contentWidth,
    );
    doc.moveDown(0.4);

    const satBuf = await satelliteBufferPromise;
    if (satBuf) {
      try {
        const imgWidth = Math.min(contentWidth, 380);
        // Keep the image left-aligned; pdfkit advances doc.y after image draw.
        doc.image(satBuf, 56, doc.y, { width: imgWidth });
        doc.moveDown(0.4);
        doc
          .font('Helvetica-Oblique')
          .fontSize(8.5)
          .fillColor(COLORS.inkMuted)
          .text(
            'Current satellite — Esri World Imagery (centered on geocoded address)',
            56,
            doc.y,
            { width: contentWidth },
          );
        doc.moveDown(0.4);
      } catch {
        /* image decode failed — skip silently */
      }
    }

    // Link block
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.ink)
      .text('Open live imagery', 56, doc.y, { width: contentWidth });
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.ink);
    linkLine(doc, 'Google Street View (with timeline scrub)', report.thenVsNow.streetViewTimelineUrl, contentWidth);
    linkLine(doc, 'Google Maps satellite at this address', report.thenVsNow.satelliteUrl, contentWidth);
    linkLine(doc, 'Miami-Dade Property Search (historical aerials)', report.thenVsNow.historicalAerialUrl, contentWidth);
    linkLine(doc, 'Current Street View pano', report.thenVsNow.streetViewUrl, contentWidth);
    doc.moveDown(0.6);

    if (report.thenVsNow.visualChecklist.length > 0) {
      subHeading(doc, 'Visual-review checklist');
      paragraph(
        doc,
        'For each item below, click through to Street View / satellite / historical aerials and compare the visible reality to the permit record.',
        contentWidth,
      );
      doc.moveDown(0.3);
      for (const c of report.thenVsNow.visualChecklist) {
        renderChecklistCard(doc, c, contentWidth);
      }
    }
  }

  // ==========================================================================
  // Property
  // ==========================================================================
  sectionHeading(doc, 'Property');
  renderKeyValueTable(
    doc,
    [
      ['Owner', report.property.owner ?? '-'],
      ['Year built', fmtYear(report.property.yearBuilt)],
      [
        'Heated / total area',
        `${fmtNum(report.property.heatedArea)} / ${fmtNum(report.property.totalArea)} sq ft`,
      ],
      ['Lot size', `${fmtNum(report.property.lotSize)} sq ft`],
      [
        'Bedrooms / bathrooms',
        `${fmtNum(report.property.bedrooms)} / ${fmtNum(report.property.bathrooms)}`,
      ],
      ['DOR description', report.property.dorDescription ?? '—'],
      ['Zoning', report.property.zoning ?? '—'],
      [
        'Mailing matches site',
        report.property.mailingMatchesSite === null
          ? '—'
          : report.property.mailingMatchesSite
            ? 'Yes'
            : `No — mailing: ${report.property.mailingAddress ?? '?'}`,
      ],
      ['Homestead', report.property.homesteadStatusText],
    ],
    contentWidth,
  );

  // ==========================================================================
  // Permit history
  // ==========================================================================
  sectionHeading(doc, 'Permit history');
  paragraph(
    doc,
    `${report.permitHistory.totalSubjectPermits} permit(s) on file for this folio. ${report.permitHistory.totalInspections} inspection record(s) matched this address. ${report.permitHistory.neighborPermitCount} permit(s) on neighboring parcels in the same block.`,
    contentWidth,
  );
  if (report.permitHistory.subjectPermits.length > 0) {
    renderTable(
      doc,
      ['Process #', 'Type', 'Issued', 'Status', 'Scope'],
      report.permitHistory.subjectPermits.map((p) => [
        p.processNumber ?? '—',
        p.appType ?? '—',
        p.issueDate ?? '—',
        p.status ?? '—',
        p.scope ?? '—',
      ]),
      contentWidth,
      [0.16, 0.14, 0.13, 0.15, 0.42],
    );
  } else {
    doc.moveDown(0.2);
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(COLORS.inkMuted)
      .text('No permits returned by the Miami-Dade BuildingPermit_gdb endpoint.', 56, doc.y, {
        width: contentWidth,
      });
    doc.moveDown(0.4);
  }
  if (report.permitHistory.neighborByAddress.length > 0) {
    subHeading(doc, 'Neighbor permit counts (same block)');
    renderTable(
      doc,
      ['Address', 'Permits'],
      report.permitHistory.neighborByAddress.map((n) => [n.address, String(n.count)]),
      contentWidth,
      [0.75, 0.25],
    );
  }

  // ==========================================================================
  // Extra features
  // ==========================================================================
  if (report.extraFeatures.length > 0) {
    sectionHeading(doc, 'Property Appraiser extra features');
    paragraph(
      doc,
      'These are improvements the county itself dates and values. Compare the dates against the permit table above.',
      contentWidth,
    );
    renderTable(
      doc,
      ['Description', 'Units', 'Year built'],
      report.extraFeatures.map((f) => [
        f.description,
        fmtNum(f.units),
        fmtNum(f.actualYearBuilt),
      ]),
      contentWidth,
      [0.6, 0.18, 0.22],
    );
  }

  // ==========================================================================
  // Code enforcement
  // ==========================================================================
  sectionHeading(doc, 'Code enforcement');
  paragraph(
    doc,
    `${report.codeEnforcement.openCount} open case(s), ${report.codeEnforcement.closedPast5yCount} closed case(s) in the past 5 years.`,
    contentWidth,
  );
  if (report.codeEnforcement.openCases.length > 0) {
    subHeading(doc, 'Open cases');
    renderTable(
      doc,
      ['Case #', 'Date', 'Status', 'Problem'],
      report.codeEnforcement.openCases.map((c) => [
        c.caseNumber,
        c.caseDate ?? '—',
        c.status,
        c.problemDescription,
      ]),
      contentWidth,
      [0.16, 0.14, 0.22, 0.48],
    );
  }
  if (report.codeEnforcement.closedCases.length > 0) {
    subHeading(doc, 'Closed cases (past 5y)');
    renderTable(
      doc,
      ['Case #', 'Date', 'Status', 'Problem'],
      report.codeEnforcement.closedCases.map((c) => [
        c.caseNumber,
        c.caseDate ?? '—',
        c.status,
        c.problemDescription,
      ]),
      contentWidth,
      [0.16, 0.14, 0.22, 0.48],
    );
  }

  // ==========================================================================
  // Sales history
  // ==========================================================================
  if (report.sales.length > 0) {
    sectionHeading(doc, 'Sales history');
    renderTable(
      doc,
      ['Date', 'Price', 'Qualification'],
      report.sales.map((s) => [
        s.date ?? '—',
        fmtMoney(s.price),
        s.qualificationDescription ?? '—',
      ]),
      contentWidth,
      [0.22, 0.22, 0.56],
    );
  }

  // ==========================================================================
  // Confidence
  // ==========================================================================
  sectionHeading(doc, 'Confidence');
  renderConfidenceTable(
    doc,
    report.confidenceAssessment.map((c) => ({
      topic: c.topic,
      grade: c.grade,
      note: c.note,
    })),
    contentWidth,
  );

  // ==========================================================================
  // Next steps
  // ==========================================================================
  sectionHeading(doc, 'Recommended next steps');
  renderBulletList(doc, report.nextSteps, contentWidth);

  // ==========================================================================
  // Limitations
  // ==========================================================================
  sectionHeading(doc, 'Data limitations');
  renderBulletList(doc, report.dataLimitations, contentWidth);

  // ==========================================================================
  // Sources
  // ==========================================================================
  sectionHeading(doc, 'Sources');
  renderBulletList(doc, report.dataSources, contentWidth);

  // ==========================================================================
  // Footer + page numbers
  // ==========================================================================
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const fy = doc.page.height - 40;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLORS.inkMuted)
      .text(
        'Palma Property Intelligence · Permit History & Unpermitted Improvement Check',
        56,
        fy,
        { width: contentWidth, align: 'left' },
      );
    doc.text(
      `Page ${i - range.start + 1} of ${range.count}`,
      56,
      fy,
      { width: contentWidth, align: 'right' },
    );
  }

  doc.end();
  return done;
}

// ============================================================================
// Layout primitives
// ============================================================================

function sectionHeading(doc: PDFKit.PDFDocument, text: string) {
  ensureSpace(doc, 60);
  doc.moveDown(0.4);
  doc
    .font('Times-Bold')
    .fontSize(16)
    .fillColor(COLORS.inkDark)
    .text(text, 56, doc.y, { width: doc.page.width - 112 });
  doc.moveDown(0.3);
}

function subHeading(doc: PDFKit.PDFDocument, text: string) {
  ensureSpace(doc, 40);
  doc.moveDown(0.2);
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLORS.inkDark)
    .text(text, 56, doc.y, { width: doc.page.width - 112 });
  doc.moveDown(0.2);
}

function paragraph(doc: PDFKit.PDFDocument, text: string, width: number) {
  ensureSpace(doc, 30);
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(COLORS.inkSoft)
    .text(text, 56, doc.y, { width, align: 'left' });
  doc.moveDown(0.3);
}

function linkLine(doc: PDFKit.PDFDocument, label: string, url: string | null, width: number) {
  if (!url) return;
  ensureSpace(doc, 16);
  const y = doc.y;
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.ink);
  // Use ASCII "* " as the bullet — the standard AFM Helvetica font doesn't
  // include the U+2192 arrow, which renders as garbled bytes.
  doc.text('* ', 56, y, { continued: true });
  doc.fillColor('#1d4ed8')
    .text(label, { link: url, underline: true, continued: false, width: width - 20 });
  doc.fillColor(COLORS.ink);
  doc.moveDown(0.15);
}

function renderFlagCard(doc: PDFKit.PDFDocument, flag: Flag, width: number) {
  ensureSpace(doc, 90);
  const startY = doc.y;
  const padding = 10;
  const { label, color } = severityLabel(flag.severity);
  // Measure height by laying out text into a scratch area first.
  const title = flag.title;
  const detail = flag.detail;

  doc.font('Helvetica-Bold').fontSize(11);
  const titleHeight = doc.heightOfString(title, { width: width - padding * 2 - 60 });
  doc.font('Helvetica').fontSize(10);
  const detailHeight = doc.heightOfString(detail, { width: width - padding * 2 });
  const boxHeight = titleHeight + detailHeight + padding * 2 + 6;

  ensureSpace(doc, boxHeight + 6);
  const y = doc.y;
  doc.rect(56, y, width, boxHeight).fillOpacity(1).fill(severityBg(flag.severity));
  doc.strokeColor(color).lineWidth(0.5).rect(56, y, width, boxHeight).stroke();

  // Title + severity badge
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLORS.inkDark)
    .text(title, 56 + padding, y + padding, { width: width - padding * 2 - 60 });
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(color)
    .text(label, 56 + width - padding - 55, y + padding + 2, {
      width: 55,
      align: 'right',
      characterSpacing: 1,
    });

  // Detail
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(COLORS.ink)
    .text(detail, 56 + padding, y + padding + titleHeight + 4, {
      width: width - padding * 2,
    });

  doc.y = y + boxHeight + 6;
  doc.x = 56;
}

function renderChecklistCard(
  doc: PDFKit.PDFDocument,
  c: { item: string; whatPermitRecordSays: string; whatToLookFor: string; ifMismatchMeans: string },
  width: number,
) {
  const padding = 10;
  doc.font('Helvetica-Bold').fontSize(11);
  const titleH = doc.heightOfString(c.item, { width: width - padding * 2 });
  doc.font('Helvetica').fontSize(9.5);
  const lineWidth = width - padding * 2 - 12;
  const h1 = doc.heightOfString(c.whatPermitRecordSays, { width: lineWidth });
  const h2 = doc.heightOfString(c.whatToLookFor, { width: lineWidth });
  const h3 = doc.heightOfString(c.ifMismatchMeans, { width: lineWidth });
  doc.font('Helvetica-Bold').fontSize(9.5);
  const labelWidth = 12 + Math.max(
    doc.widthOfString('What the permit record says: '),
    doc.widthOfString('What to look for: '),
    doc.widthOfString("If there's a mismatch: "),
  );
  const boxHeight = padding * 2 + titleH + 6 + h1 + 4 + h2 + 4 + h3;

  ensureSpace(doc, boxHeight + 6);
  const y = doc.y;
  doc.rect(56, y, width, boxHeight).fillOpacity(1).fill(COLORS.card);
  doc.strokeColor(COLORS.line).lineWidth(0.5).rect(56, y, width, boxHeight).stroke();

  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(COLORS.inkDark)
    .text(c.item, 56 + padding, y + padding, { width: width - padding * 2 });

  let cy = y + padding + titleH + 6;
  const bodyX = 56 + padding;

  const writeRow = (label: string, body: string, baseY: number): number => {
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor(COLORS.inkDark)
      .text(label, bodyX, baseY, { continued: true });
    doc
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor(COLORS.inkSoft)
      .text(' ' + body, { width: width - padding * 2 });
    return doc.y + 2;
  };

  cy = writeRow('What the permit record says:', c.whatPermitRecordSays, cy);
  cy = writeRow('What to look for:', c.whatToLookFor, cy);
  cy = writeRow("If there's a mismatch:", c.ifMismatchMeans, cy);

  doc.y = y + boxHeight + 6;
  doc.x = 56;
}

function renderKeyValueTable(doc: PDFKit.PDFDocument, rows: Array<[string, string]>, width: number) {
  const labelW = Math.round(width * 0.35);
  const valueW = width - labelW;
  const rowPad = 6;

  for (const [k, v] of rows) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.inkMuted);
    const kH = doc.heightOfString(k, { width: labelW - rowPad });
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.ink);
    const vH = doc.heightOfString(v, { width: valueW - rowPad });
    const rowH = Math.max(kH, vH) + rowPad * 1.2;

    ensureSpace(doc, rowH + 4);
    const y = doc.y;
    // Row divider
    doc.strokeColor(COLORS.line).lineWidth(0.3).moveTo(56, y).lineTo(56 + width, y).stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor(COLORS.inkMuted)
      .text(k, 56 + 2, y + rowPad * 0.6, { width: labelW - rowPad });
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor(COLORS.ink)
      .text(v, 56 + labelW, y + rowPad * 0.6, { width: valueW - rowPad });
    doc.y = y + rowH;
    doc.x = 56;
  }
  // Bottom border on last row
  doc.strokeColor(COLORS.line).lineWidth(0.3).moveTo(56, doc.y).lineTo(56 + width, doc.y).stroke();
  doc.moveDown(0.5);
}

function renderTable(
  doc: PDFKit.PDFDocument,
  headers: string[],
  rows: string[][],
  width: number,
  colFractions?: number[],
) {
  const fractions =
    colFractions && colFractions.length === headers.length
      ? colFractions
      : headers.map(() => 1 / headers.length);
  const colWidths = fractions.map((f) => Math.round(width * f));
  const rowPad = 5;

  const drawRow = (cells: string[], bold: boolean) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 9 : 9).fillColor(bold ? COLORS.inkMuted : COLORS.ink);
    const heights = cells.map((c, i) =>
      doc.heightOfString(c ?? '—', { width: colWidths[i] - rowPad }),
    );
    const rowH = Math.max(...heights) + rowPad * 1.4;
    ensureSpace(doc, rowH + 4);
    const y = doc.y;
    // top divider
    doc.strokeColor(COLORS.line).lineWidth(0.3).moveTo(56, y).lineTo(56 + width, y).stroke();
    let x = 56;
    for (let i = 0; i < cells.length; i++) {
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(9)
        .fillColor(bold ? COLORS.inkMuted : COLORS.ink)
        .text(cells[i] ?? '—', x + 2, y + rowPad * 0.7, {
          width: colWidths[i] - rowPad,
        });
      x += colWidths[i];
    }
    doc.y = y + rowH;
    doc.x = 56;
  };

  drawRow(headers, true);
  for (const row of rows) drawRow(row, false);
  doc.strokeColor(COLORS.line).lineWidth(0.3).moveTo(56, doc.y).lineTo(56 + width, doc.y).stroke();
  doc.moveDown(0.5);
}

function renderConfidenceTable(
  doc: PDFKit.PDFDocument,
  rows: Array<{ topic: string; grade: string; note: string }>,
  width: number,
) {
  const colWidths = [Math.round(width * 0.32), Math.round(width * 0.14), 0];
  colWidths[2] = width - colWidths[0] - colWidths[1];
  const rowPad = 6;

  // header
  ensureSpace(doc, 30);
  let y = doc.y;
  doc.strokeColor(COLORS.line).lineWidth(0.3).moveTo(56, y).lineTo(56 + width, y).stroke();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.inkMuted);
  doc.text('Topic', 56 + 2, y + rowPad * 0.7, { width: colWidths[0] - rowPad });
  doc.text('Grade', 56 + colWidths[0] + 2, y + rowPad * 0.7, { width: colWidths[1] - rowPad });
  doc.text('Note', 56 + colWidths[0] + colWidths[1] + 2, y + rowPad * 0.7, {
    width: colWidths[2] - rowPad,
  });
  doc.y = y + 20;
  doc.x = 56;

  for (const r of rows) {
    const topicH = doc.font('Helvetica').fontSize(9).heightOfString(r.topic, {
      width: colWidths[0] - rowPad,
    });
    const noteH = doc.heightOfString(r.note, { width: colWidths[2] - rowPad });
    const rowH = Math.max(topicH, noteH, 14) + rowPad * 1.4;

    ensureSpace(doc, rowH + 4);
    y = doc.y;
    doc.strokeColor(COLORS.line).lineWidth(0.3).moveTo(56, y).lineTo(56 + width, y).stroke();

    doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink)
      .text(r.topic, 56 + 2, y + rowPad * 0.7, { width: colWidths[0] - rowPad });

    const { label, color } = gradeLabel(r.grade);
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(color)
      .text(label, 56 + colWidths[0] + 2, y + rowPad * 0.7, {
        width: colWidths[1] - rowPad,
        characterSpacing: 1,
      });

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(COLORS.ink)
      .text(r.note, 56 + colWidths[0] + colWidths[1] + 2, y + rowPad * 0.7, {
        width: colWidths[2] - rowPad,
      });

    doc.y = y + rowH;
    doc.x = 56;
  }
  doc.strokeColor(COLORS.line).lineWidth(0.3).moveTo(56, doc.y).lineTo(56 + width, doc.y).stroke();
  doc.moveDown(0.5);
}

function renderBulletList(doc: PDFKit.PDFDocument, items: string[], width: number) {
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.ink);
  for (const it of items) {
    ensureSpace(doc, 30);
    const y = doc.y;
    doc.text('·  ', 56, y, { continued: true }).text(it, { width: width - 14 });
    doc.moveDown(0.2);
  }
  doc.moveDown(0.4);
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) {
    doc.addPage();
  }
}
