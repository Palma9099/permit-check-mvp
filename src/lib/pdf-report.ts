// Build a clean, realtor-grade PDF from a DiagnosticReport using pdfkit.
//
// Uses only the built-in AFM fonts (Helvetica + Times-Roman) so we don't
// need any font files on disk in the Vercel serverless environment. The
// Esri satellite image is fetched server-side and embedded inline so the
// PDF is self-contained — no missing-image icons when viewed offline.

import PDFDocument from 'pdfkit';
import type { DiagnosticReport, Flag, VisionObservation } from './types';

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

function obsBg(severity: VisionObservation['severity']): string {
  if (severity === 'flag') return COLORS.strongBg;
  if (severity === 'note') return COLORS.mediumBg;
  if (severity === 'match') return COLORS.okBg;
  return COLORS.weakBg;
}
function obsLabel(severity: VisionObservation['severity']): { label: string; color: string } {
  if (severity === 'flag') return { label: 'FLAG', color: COLORS.strong };
  if (severity === 'note') return { label: 'NOTE', color: COLORS.medium };
  if (severity === 'match') return { label: 'MATCH', color: COLORS.ok };
  return { label: 'UNCERTAIN', color: COLORS.weak };
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
  // Pre-fetch satellite + Street View + historical aerial imagery in parallel
  const closeBufPromise = report.thenVsNow?.satelliteImageUrl
    ? fetchImageBuffer(report.thenVsNow.satelliteImageUrl)
    : Promise.resolve(null);
  const contextBufPromise = report.thenVsNow?.contextSatelliteImageUrl
    ? fetchImageBuffer(report.thenVsNow.contextSatelliteImageUrl)
    : Promise.resolve(null);
  const svBufPromises = (report.thenVsNow?.streetViewImages ?? []).map((sv) =>
    sv.imageUrl ? fetchImageBuffer(sv.imageUrl) : Promise.resolve(null),
  );
  const thenAerialBufPromise = report.thenVsNow?.historicalAerials?.then?.imageUrl
    ? fetchImageBuffer(report.thenVsNow.historicalAerials.then.imageUrl)
    : Promise.resolve(null);
  const nowAerialBufPromise = report.thenVsNow?.historicalAerials?.now?.imageUrl
    ? fetchImageBuffer(report.thenVsNow.historicalAerials.now.imageUrl)
    : Promise.resolve(null);

  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 56, bottom: 64, left: 56, right: 56 },
    bufferPages: true,
    info: {
      Title: `Permit History — ${report.property.siteAddress ?? report.query.address}`,
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
  const contentWidth = pageWidth - 112;
  const coverHeight = 160;
  doc.rect(0, 0, pageWidth, coverHeight).fill(COLORS.cover);
  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('PALMA PROPERTY INTELLIGENCE  ·  PERMIT HISTORY CHECK', 56, 28, {
      characterSpacing: 2,
    });
  doc
    .font('Times-Bold')
    .fontSize(20)
    .fillColor('#ffffff')
    .text(report.property.siteAddress ?? report.query.address, 56, 50, {
      width: contentWidth,
    });
  const countyName = report.county?.name ?? report.ahj?.name ?? 'Florida';
  const tierSuffix = report.county?.tier ? ` (Tier ${report.county.tier})` : '';
  const folioPrefix = report.property.folio ? `Folio ${report.property.folio}  ·  ` : '';
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#c7d2fe')
    .text(
      `${folioPrefix}${countyName}${tierSuffix}  ·  ${new Date(report.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
      56,
      doc.y + 6,
      { width: contentWidth },
    );

  doc.y = coverHeight + 22;
  doc.x = 56;
  doc.fillColor(COLORS.ink);

  // ==========================================================================
  // Bottom line callout
  // ==========================================================================
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.inkMuted)
    .text('BOTTOM LINE', 56, doc.y, { characterSpacing: 1 });
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.ink);
  for (const line of report.bottomLine) {
    const y = doc.y;
    doc.text('·  ', 56, y, { continued: true }).text(line, { width: contentWidth - 8 });
    doc.moveDown(0.15);
  }
  doc.moveDown(0.5);
  const ruleY = doc.y;
  doc.strokeColor(COLORS.line).lineWidth(0.5).moveTo(56, ruleY).lineTo(pageWidth - 56, ruleY).stroke();
  doc.moveDown(0.6);

  // ==========================================================================
  // Top flags (strong + medium only)
  // ==========================================================================
  const allFlags = [...report.flags.strong, ...report.flags.medium];
  if (allFlags.length > 0) {
    sectionHeading(doc, 'Top flags');
    for (const f of allFlags) {
      renderFlagCard(doc, f, contentWidth);
    }
  }

  // ==========================================================================
  // Visual review
  // ==========================================================================
  if (report.thenVsNow && report.thenVsNow.coordinates) {
    sectionHeading(doc, 'Visual review');
    const vc = report.thenVsNow.visualComparison;

    if (vc?.performed) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(10)
        .fillColor(COLORS.inkSoft)
        .text(vc.summary, 56, doc.y, { width: contentWidth });
      doc.moveDown(0.4);
    } else {
      paragraph(
        doc,
        "Records tell half the story. Compare the satellite views below — subject vs. neighbors — and look for anything the permit record doesn't explain.",
        contentWidth,
      );
    }

    // Then-vs-Now historical aerial pair (NAIP) — rendered first so it reads
    // as the hero of the visual review.
    const thenAerialBuf = await thenAerialBufPromise;
    const nowAerialBuf = await nowAerialBufPromise;
    const thenFrame = report.thenVsNow.historicalAerials?.then ?? null;
    const nowFrame = report.thenVsNow.historicalAerials?.now ?? null;
    if (thenAerialBuf && nowAerialBuf && thenFrame && nowFrame) {
      ensureSpace(doc, 260);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.inkMuted)
        .text('THEN vs NOW — HISTORICAL AERIAL (USDA NAIP, 1M)', 56, doc.y, { characterSpacing: 1 });
      doc.moveDown(0.3);
      const pairGap = 12;
      const pairW = Math.floor((contentWidth - pairGap) / 2);
      const pairY = doc.y;
      let pairMaxH = pairY;
      try {
        doc.image(thenAerialBuf, 56, pairY, { width: pairW });
        pairMaxH = Math.max(pairMaxH, doc.y);
      } catch { /* ignore */ }
      try {
        doc.image(nowAerialBuf, 56 + pairW + pairGap, pairY, { width: pairW });
        pairMaxH = Math.max(pairMaxH, doc.y);
      } catch { /* ignore */ }
      doc.y = pairMaxH;
      doc.moveDown(0.2);
      doc
        .font('Helvetica-Oblique')
        .fontSize(8.5)
        .fillColor(COLORS.inkMuted)
        .text(
          `Left: ${thenFrame.captureDate.slice(0, 10)} (${thenFrame.captureYear}).  Right: ${nowFrame.captureDate.slice(0, 10)} (${nowFrame.captureYear}).  Imagery: Microsoft Planetary Computer / USDA NAIP.`,
          56,
          doc.y,
          { width: contentWidth },
        );
      doc.moveDown(0.5);
    } else if (report.thenVsNow.historicalAerials?.failureReason) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(8.5)
        .fillColor(COLORS.inkMuted)
        .text(
          `Historical aerial unavailable: ${report.thenVsNow.historicalAerials.failureReason}`,
          56,
          doc.y,
          { width: contentWidth },
        );
      doc.moveDown(0.4);
    }

    // Side-by-side images: subject (tight) and block context
    const closeBuf = await closeBufPromise;
    const contextBuf = await contextBufPromise;
    const imgGap = 12;
    const imgWidth = Math.floor((contentWidth - imgGap) / 2);
    const startY = doc.y;

    if (closeBuf || contextBuf) {
      let nextY = startY;
      if (closeBuf) {
        try {
          doc.image(closeBuf, 56, startY, { width: imgWidth });
          nextY = Math.max(nextY, doc.y);
        } catch { /* ignore */ }
      }
      if (contextBuf) {
        try {
          doc.image(contextBuf, 56 + imgWidth + imgGap, startY, { width: imgWidth });
          nextY = Math.max(nextY, doc.y);
        } catch { /* ignore */ }
      } else if (closeBuf) {
        // No context image — already drew close; doc.y is current
      }
      doc.y = nextY;
      doc.moveDown(0.3);
      const parcelSrc = report.thenVsNow?.parcelPolygonSource
        ? `  Parcel boundary: ${report.thenVsNow.parcelPolygonSource}.`
        : '';
      doc
        .font('Helvetica-Oblique')
        .fontSize(8.5)
        .fillColor(COLORS.inkMuted)
        .text(
          (contextBuf
            ? 'Left: subject parcel (red outline).  Right: block context.  Imagery: Google satellite.'
            : 'Subject parcel (red outline) — Google satellite.') + parcelSrc,
          56,
          doc.y,
          { width: contentWidth },
        );
      doc.moveDown(0.5);
    }

    // Street View strip — up to 4 thumbnails across the page
    const svBufs = await Promise.all(svBufPromises);
    const svImages = (report.thenVsNow?.streetViewImages ?? []).map((sv, i) => ({
      label: sv.label,
      buf: svBufs[i],
    })).filter((x) => x.buf);
    if (svImages.length > 0) {
      ensureSpace(doc, 180);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.inkMuted)
        .text('STREET VIEW — FOUR HEADINGS', 56, doc.y, { characterSpacing: 1 });
      doc.moveDown(0.3);
      const perRow = Math.min(4, svImages.length);
      const svGap = 8;
      const svWidth = Math.floor((contentWidth - svGap * (perRow - 1)) / perRow);
      const svY = doc.y;
      let maxH = svY;
      for (let i = 0; i < svImages.length; i++) {
        const col = i % perRow;
        const x = 56 + col * (svWidth + svGap);
        try {
          doc.image(svImages[i].buf as Buffer, x, svY, { width: svWidth });
          maxH = Math.max(maxH, doc.y);
        } catch { /* ignore */ }
      }
      doc.y = maxH;
      doc.moveDown(0.2);
      doc
        .font('Helvetica-Oblique')
        .fontSize(8)
        .fillColor(COLORS.inkMuted)
        .text(
          svImages.map((x) => x.label).join('  ·  ') + '  ·  Imagery: Google Street View.',
          56,
          doc.y,
          { width: contentWidth },
        );
      doc.moveDown(0.5);
    }

    // Vision observations — the actual analysis
    if (vc?.performed && vc.observations.length > 0) {
      for (const o of vc.observations) {
        renderObservationCard(doc, o, contentWidth);
      }
    } else {
      // Fallback — only the top 3 checklist items, condensed
      if (report.thenVsNow.visualChecklist.length > 0) {
        doc
          .font('Helvetica-Oblique')
          .fontSize(9)
          .fillColor(COLORS.inkMuted)
          .text(
            vc?.failureReason
              ? `Automated comparison did not run (${vc.failureReason}). Eyeball these manually:`
              : 'Eyeball these areas manually:',
            56,
            doc.y,
            { width: contentWidth },
          );
        doc.moveDown(0.3);
        for (const c of report.thenVsNow.visualChecklist.slice(0, 4)) {
          renderCompactChecklist(doc, c.item, c.whatToLookFor, contentWidth);
        }
      }
    }

    // Compact link line
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.ink);
    linkLine(doc, 'Open Street View (with timeline)', report.thenVsNow.streetViewTimelineUrl, contentWidth);
    if (report.thenVsNow.historicalAerialUrl) {
      linkLine(
        doc,
        `${report.county?.name ?? 'County'} historical aerials`,
        report.thenVsNow.historicalAerialUrl,
        contentWidth,
      );
    }
    if (report.county?.portals?.propertyAppraiser) {
      linkLine(
        doc,
        `${report.county.name} Property Appraiser`,
        report.county.portals.propertyAppraiser,
        contentWidth,
      );
    }
    if (report.county?.portals?.buildingDept) {
      linkLine(
        doc,
        `${report.county.name} Building Department`,
        report.county.portals.buildingDept,
        contentWidth,
      );
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
    `${report.permitHistory.totalSubjectPermits} permit(s) on file for this folio. ${report.permitHistory.neighborPermitCount} permit(s) on neighboring parcels in the same block.`,
    contentWidth,
  );
  if (report.permitHistory.subjectPermits.length > 0) {
    renderTable(
      doc,
      ['Process #', 'Type', 'Issued', 'Status', 'Scope'],
      report.permitHistory.subjectPermits.map((p) => [
        p.processNumber ?? '-',
        p.appType ?? '-',
        p.issueDate ?? '-',
        p.status ?? '-',
        p.scope ?? '-',
      ]),
      contentWidth,
      [0.16, 0.14, 0.13, 0.15, 0.42],
    );
  } else {
    doc.moveDown(0.2);
    const noPermitLine =
      report.county?.tier === 'A'
        ? `No permits returned by the ${report.county.name} public permit endpoint.`
        : report.county?.scraperNote ??
          'No permit data was pulled automatically for this county. Use the portal links above for manual records review.';
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(COLORS.inkMuted)
      .text(noPermitLine, 56, doc.y, { width: contentWidth });
    doc.moveDown(0.4);
  }

  // ==========================================================================
  // Extra features
  // ==========================================================================
  if (report.extraFeatures.length > 0) {
    sectionHeading(doc, 'Property Appraiser extra features');
    renderTable(
      doc,
      ['Description', 'Units', 'Year built'],
      report.extraFeatures.map((f) => [
        f.description,
        fmtNum(f.units),
        fmtYear(f.actualYearBuilt),
      ]),
      contentWidth,
      [0.6, 0.18, 0.22],
    );
  }

  // ==========================================================================
  // Code enforcement (only if there's something)
  // ==========================================================================
  if (report.codeEnforcement.openCases.length > 0 || report.codeEnforcement.closedCases.length > 0) {
    sectionHeading(doc, 'Code enforcement');
    paragraph(
      doc,
      `${report.codeEnforcement.openCount} open, ${report.codeEnforcement.closedPast5yCount} closed (past 5y).`,
      contentWidth,
    );
    if (report.codeEnforcement.openCases.length > 0) {
      subHeading(doc, 'Open cases');
      renderTable(
        doc,
        ['Case #', 'Date', 'Problem'],
        report.codeEnforcement.openCases.map((c) => [
          c.caseNumber,
          c.caseDate ?? '-',
          c.problemDescription,
        ]),
        contentWidth,
        [0.18, 0.18, 0.64],
      );
    }
    if (report.codeEnforcement.closedCases.length > 0) {
      subHeading(doc, 'Closed cases (past 5y)');
      renderTable(
        doc,
        ['Case #', 'Date', 'Problem'],
        report.codeEnforcement.closedCases.map((c) => [
          c.caseNumber,
          c.caseDate ?? '-',
          c.problemDescription,
        ]),
        contentWidth,
        [0.18, 0.18, 0.64],
      );
    }
  }

  // ==========================================================================
  // Sales (only if any)
  // ==========================================================================
  if (report.sales.length > 0) {
    sectionHeading(doc, 'Sales history');
    renderTable(
      doc,
      ['Date', 'Price', 'Qualification'],
      report.sales.map((s) => [
        s.date ?? '-',
        fmtMoney(s.price),
        s.qualificationDescription ?? '-',
      ]),
      contentWidth,
      [0.22, 0.22, 0.56],
    );
  }

  // ==========================================================================
  // Next steps
  // ==========================================================================
  sectionHeading(doc, 'Next steps');
  renderBulletList(doc, report.nextSteps, contentWidth);

  // Disclaimer
  doc.moveDown(0.2);
  doc
    .font('Helvetica-Oblique')
    .fontSize(8.5)
    .fillColor(COLORS.inkMuted)
    .text(
      'Records-level triage only — not legal advice, not a final compliance determination. Always verify with the AHJ before acting.',
      56,
      doc.y,
      { width: contentWidth },
    );

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
      .text('Palma Property Intelligence  ·  Permit History Check', 56, fy, {
        width: contentWidth,
        align: 'left',
      });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, 56, fy, {
      width: contentWidth,
      align: 'right',
    });
  }

  doc.end();
  return done;
}

// ============================================================================
// Layout primitives
// ============================================================================

function sectionHeading(doc: PDFKit.PDFDocument, text: string) {
  ensureSpace(doc, 50);
  doc.moveDown(0.4);
  doc
    .font('Times-Bold')
    .fontSize(15)
    .fillColor(COLORS.inkDark)
    .text(text, 56, doc.y, { width: doc.page.width - 112 });
  doc.moveDown(0.25);
}

function subHeading(doc: PDFKit.PDFDocument, text: string) {
  ensureSpace(doc, 30);
  doc.moveDown(0.15);
  doc
    .font('Helvetica-Bold')
    .fontSize(10.5)
    .fillColor(COLORS.inkDark)
    .text(text, 56, doc.y, { width: doc.page.width - 112 });
  doc.moveDown(0.15);
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
  ensureSpace(doc, 14);
  const y = doc.y;
  doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.ink);
  doc.text('* ', 56, y, { continued: true });
  doc.fillColor('#1d4ed8')
    .text(label, { link: url, underline: true, continued: false, width: width - 20 });
  doc.fillColor(COLORS.ink);
  doc.moveDown(0.1);
}

function renderFlagCard(doc: PDFKit.PDFDocument, flag: Flag, width: number) {
  const padding = 10;
  const { label, color } = severityLabel(flag.severity);
  const title = flag.title;
  const detail = flag.detail;

  doc.font('Helvetica-Bold').fontSize(10.5);
  const titleHeight = doc.heightOfString(title, { width: width - padding * 2 - 60 });
  doc.font('Helvetica').fontSize(9.5);
  const detailHeight = doc.heightOfString(detail, { width: width - padding * 2 });
  const boxHeight = titleHeight + detailHeight + padding * 2 + 6;

  ensureSpace(doc, boxHeight + 6);
  const y = doc.y;
  doc.rect(56, y, width, boxHeight).fillOpacity(1).fill(severityBg(flag.severity));
  doc.strokeColor(color).lineWidth(0.5).rect(56, y, width, boxHeight).stroke();

  doc
    .font('Helvetica-Bold')
    .fontSize(10.5)
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

  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(COLORS.ink)
    .text(detail, 56 + padding, y + padding + titleHeight + 4, {
      width: width - padding * 2,
    });

  doc.y = y + boxHeight + 6;
  doc.x = 56;
}

function renderObservationCard(doc: PDFKit.PDFDocument, o: VisionObservation, width: number) {
  const padding = 10;
  const { label, color } = obsLabel(o.severity);
  const bodyW = width - padding * 2;

  doc.font('Helvetica-Bold').fontSize(10.5);
  const titleH = doc.heightOfString(o.area, { width: bodyW - 60 });
  doc.font('Helvetica').fontSize(9.5);
  const sawH = doc.heightOfString('What we see: ' + o.whatWeSaw, { width: bodyW });
  const vsH = doc.heightOfString('Vs. permit record: ' + o.vsPermitRecord, { width: bodyW });
  const boxHeight = titleH + sawH + vsH + padding * 2 + 6;

  ensureSpace(doc, boxHeight + 6);
  const y = doc.y;
  doc.rect(56, y, width, boxHeight).fillOpacity(1).fill(obsBg(o.severity));
  doc.strokeColor(color).lineWidth(0.5).rect(56, y, width, boxHeight).stroke();

  doc
    .font('Helvetica-Bold')
    .fontSize(10.5)
    .fillColor(COLORS.inkDark)
    .text(o.area, 56 + padding, y + padding, { width: bodyW - 60 });
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(color)
    .text(label, 56 + width - padding - 55, y + padding + 2, {
      width: 55,
      align: 'right',
      characterSpacing: 1,
    });

  let cy = y + padding + titleH + 4;
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.inkDark)
    .text('What we see:', 56 + padding, cy, { continued: true });
  doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.ink)
    .text(' ' + o.whatWeSaw, { width: bodyW });
  cy = doc.y;

  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.inkDark)
    .text('Vs. permit record:', 56 + padding, cy, { continued: true });
  doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.ink)
    .text(' ' + o.vsPermitRecord, { width: bodyW });

  doc.y = y + boxHeight + 6;
  doc.x = 56;
}

function renderCompactChecklist(doc: PDFKit.PDFDocument, item: string, body: string, width: number) {
  const padding = 8;
  const bodyW = width - padding * 2;
  doc.font('Helvetica-Bold').fontSize(10);
  const titleH = doc.heightOfString(item, { width: bodyW });
  doc.font('Helvetica').fontSize(9.5);
  const bodyH = doc.heightOfString(body, { width: bodyW });
  const boxHeight = titleH + bodyH + padding * 2 + 4;

  ensureSpace(doc, boxHeight + 4);
  const y = doc.y;
  doc.rect(56, y, width, boxHeight).strokeColor(COLORS.line).lineWidth(0.5).stroke();
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(COLORS.inkDark)
    .text(item, 56 + padding, y + padding, { width: bodyW });
  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(COLORS.inkSoft)
    .text(body, 56 + padding, y + padding + titleH + 2, { width: bodyW });
  doc.y = y + boxHeight + 4;
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
  doc.strokeColor(COLORS.line).lineWidth(0.3).moveTo(56, doc.y).lineTo(56 + width, doc.y).stroke();
  doc.moveDown(0.4);
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
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(bold ? COLORS.inkMuted : COLORS.ink);
    const heights = cells.map((c, i) =>
      doc.heightOfString(c ?? '-', { width: colWidths[i] - rowPad }),
    );
    const rowH = Math.max(...heights) + rowPad * 1.4;
    ensureSpace(doc, rowH + 4);
    const y = doc.y;
    doc.strokeColor(COLORS.line).lineWidth(0.3).moveTo(56, y).lineTo(56 + width, y).stroke();
    let x = 56;
    for (let i = 0; i < cells.length; i++) {
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(9)
        .fillColor(bold ? COLORS.inkMuted : COLORS.ink)
        .text(cells[i] ?? '-', x + 2, y + rowPad * 0.7, {
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
  doc.moveDown(0.4);
}

function renderBulletList(doc: PDFKit.PDFDocument, items: string[], width: number) {
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.ink);
  for (const it of items) {
    ensureSpace(doc, 24);
    const y = doc.y;
    doc.text('·  ', 56, y, { continued: true }).text(it, { width: width - 14 });
    doc.moveDown(0.2);
  }
  doc.moveDown(0.3);
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) {
    doc.addPage();
  }
}
