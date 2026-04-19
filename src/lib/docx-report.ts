// Build a Word .docx from a DiagnosticReport.
//
// Uses docx@8 — the rendering library that lets us emit a real .docx
// from the server side. Style is the realtor-grade "calm, tabular"
// look from the manual reports we wrote for 6704 SW 134 PL and
// 4202 SW 84 CT — same headings, same tables, same callouts, but
// generated from the structured DiagnosticReport so the formatting
// stays identical from one property to the next.

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  WidthType,
  ShadingType,
  Header,
  Footer,
  PageNumber,
} from 'docx';
import type {
  DiagnosticReport,
  Flag,
  Permit,
  ExtraFeature,
  Sale,
  CodeCase,
  ConfidenceRow,
} from './types';

// ----------------------------------------------------------------------------
// Style helpers
// ----------------------------------------------------------------------------

const COLOR_INK = '1A1A1A';
const COLOR_SOFT = '3A3A3A';
const COLOR_MUTED = '6A6A6A';
const COLOR_HEADER_BG = '1F3864';
const COLOR_HEADER_FG = 'FFFFFF';
const COLOR_STRIPE = 'FAFAF7';
const COLOR_RED = '991B1B';
const COLOR_RED_BG = 'FEE2E2';
const COLOR_AMBER = '92400E';
const COLOR_AMBER_BG = 'FEF3C7';
const COLOR_GREY = '374151';
const COLOR_GREY_BG = 'E5E7EB';

const FONT_BODY = 'Calibri';
const FONT_HEAD = 'Cambria';

function P(text: string, opts: { bold?: boolean; italic?: boolean; size?: number; color?: string } = {}): Paragraph {
  return new Paragraph({
    spacing: { after: 100 },
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        italics: opts.italic,
        size: opts.size ?? 22,
        color: opts.color ?? COLOR_SOFT,
        font: FONT_BODY,
      }),
    ],
  });
}

function PM(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 60 },
    children: [
      new TextRun({ text, size: 20, color: COLOR_MUTED, italics: true, font: FONT_BODY }),
    ],
  });
}

function H1(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 120 },
    heading: HeadingLevel.HEADING_1,
    children: [
      new TextRun({ text, size: 36, color: COLOR_INK, bold: true, font: FONT_HEAD }),
    ],
  });
}

function H2(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 100 },
    heading: HeadingLevel.HEADING_2,
    children: [
      new TextRun({ text, size: 28, color: COLOR_INK, bold: true, font: FONT_HEAD }),
    ],
  });
}

function H3(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 180, after: 60 },
    children: [
      new TextRun({ text, size: 24, color: COLOR_INK, bold: true, font: FONT_BODY }),
    ],
  });
}

function bulletP(text: string): Paragraph {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, size: 22, color: COLOR_SOFT, font: FONT_BODY })],
  });
}

function spacer(): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 80 } });
}

function thinBorders() {
  return {
    top: { style: BorderStyle.SINGLE, size: 4, color: 'EEEEEE' },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'EEEEEE' },
    left: { style: BorderStyle.SINGLE, size: 4, color: 'EEEEEE' },
    right: { style: BorderStyle.SINGLE, size: 4, color: 'EEEEEE' },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'EEEEEE' },
    insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'EEEEEE' },
  };
}

function headerCell(label: string): TableCell {
  return new TableCell({
    shading: { fill: COLOR_HEADER_BG, type: ShadingType.CLEAR, color: 'auto' },
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: label, bold: true, size: 20, color: COLOR_HEADER_FG, font: FONT_BODY }),
        ],
      }),
    ],
  });
}

function bodyCell(text: string, opts: { bold?: boolean; bg?: string } = {}): TableCell {
  return new TableCell({
    shading: opts.bg
      ? { fill: opts.bg, type: ShadingType.CLEAR, color: 'auto' }
      : undefined,
    children: [
      new Paragraph({
        children: [
          new TextRun({ text, bold: opts.bold, size: 20, color: COLOR_SOFT, font: FONT_BODY }),
        ],
      }),
    ],
  });
}

function kvTable(rows: Array<[string, string]>): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: thinBorders(),
    rows: rows.map(
      ([k, v], i) =>
        new TableRow({
          children: [
            bodyCell(k, { bold: true, bg: i % 2 ? COLOR_STRIPE : undefined }),
            bodyCell(v, { bg: i % 2 ? COLOR_STRIPE : undefined }),
          ],
        }),
    ),
  });
}

function dataTable(headers: string[], rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: thinBorders(),
    rows: [
      new TableRow({ children: headers.map(headerCell) }),
      ...rows.map(
        (r, i) =>
          new TableRow({
            children: r.map((c) =>
              bodyCell(c, { bg: i % 2 ? COLOR_STRIPE : undefined }),
            ),
          }),
      ),
    ],
  });
}

function callout(title: string, lines: string[], severity: 'red' | 'amber' | 'grey' | 'navy'): Table {
  let bg = '#1F3864';
  let fg = COLOR_HEADER_FG;
  if (severity === 'red') {
    bg = COLOR_RED_BG;
    fg = COLOR_RED;
  } else if (severity === 'amber') {
    bg = COLOR_AMBER_BG;
    fg = COLOR_AMBER;
  } else if (severity === 'grey') {
    bg = COLOR_GREY_BG;
    fg = COLOR_GREY;
  } else {
    bg = COLOR_HEADER_BG;
    fg = COLOR_HEADER_FG;
  }

  const titleP = new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: title, bold: true, size: 22, color: fg, font: FONT_BODY })],
  });
  const linePs = lines.map(
    (l) =>
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: '· ' + l, size: 20, color: fg, font: FONT_BODY })],
      }),
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: thinBorders(),
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { fill: bg.replace('#', ''), type: ShadingType.CLEAR, color: 'auto' },
            children: [titleP, ...linePs],
          }),
        ],
      }),
    ],
  });
}

// ----------------------------------------------------------------------------
// Section builders
// ----------------------------------------------------------------------------

function flagSection(title: string, flags: Flag[], severity: 'red' | 'amber' | 'grey'): any[] {
  if (flags.length === 0) return [];
  const out: any[] = [H3(title)];
  for (const f of flags) {
    out.push(callout(f.title, [f.detail], severity));
    out.push(spacer());
  }
  return out;
}

function permitsTable(permits: Permit[]): Table | Paragraph {
  if (permits.length === 0) {
    return P('No permits returned by the Miami-Dade BuildingPermit_gdb endpoint for this folio.', { italic: true });
  }
  return dataTable(
    ['Process #', 'Type', 'Issued', 'Status', 'Scope'],
    permits.map((p) => [
      p.processNumber ?? '—',
      p.appType ?? '—',
      p.issueDate ?? '—',
      p.status ?? '—',
      p.scope ?? '—',
    ]),
  );
}

function extraFeaturesTable(features: ExtraFeature[]): Table | Paragraph {
  if (features.length === 0) {
    return P('No extra features on file.', { italic: true });
  }
  return dataTable(
    ['Description', 'Units', 'Year built'],
    features.map((f) => [
      f.description,
      f.units == null ? '—' : f.units.toLocaleString('en-US'),
      f.actualYearBuilt == null ? '—' : String(f.actualYearBuilt),
    ]),
  );
}

function salesTable(sales: Sale[]): Table | Paragraph {
  if (sales.length === 0) {
    return P('No sales history.', { italic: true });
  }
  return dataTable(
    ['Date', 'Price', 'Qualification'],
    sales.map((s) => [
      s.date ?? '—',
      typeof s.price === 'number' ? '$' + s.price.toLocaleString('en-US') : '—',
      s.qualificationDescription ?? '—',
    ]),
  );
}

function caseTable(cases: CodeCase[]): Table | Paragraph {
  if (cases.length === 0) {
    return P('No cases.', { italic: true });
  }
  return dataTable(
    ['Case #', 'Date', 'Status', 'Problem', 'Last action', 'Lien'],
    cases.map((c) => [
      c.caseNumber || '—',
      c.caseDate ?? '—',
      c.status || '—',
      c.problemDescription || '—',
      c.lastAction || '—',
      c.lien || '—',
    ]),
  );
}

function neighborTable(byAddr: Array<{ address: string; count: number }>): Table | Paragraph {
  if (byAddr.length === 0) {
    return P('No neighbor permits found.', { italic: true });
  }
  return dataTable(
    ['Address', 'Permits'],
    byAddr.map((n) => [n.address, String(n.count)]),
  );
}

function confidenceTable(rows: ConfidenceRow[]): Table {
  return dataTable(
    ['Topic', 'Grade', 'Note'],
    rows.map((c) => [c.topic, c.grade.toUpperCase(), c.note]),
  );
}

function fmtNum(n: number | null): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US');
}

// ----------------------------------------------------------------------------
// Main builder
// ----------------------------------------------------------------------------

export async function buildDocx(report: DiagnosticReport): Promise<Buffer> {
  const r = report;
  const generated = new Date(r.generatedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const children: any[] = [];

  // Title block
  children.push(
    new Paragraph({
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: 'Permit History & Unpermitted Improvement Check',
          bold: true,
          size: 22,
          color: COLOR_MUTED,
          font: FONT_BODY,
        }),
      ],
    }),
  );
  children.push(
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: r.property.siteAddress ?? r.query.address ?? '',
          bold: true,
          size: 44,
          color: COLOR_INK,
          font: FONT_HEAD,
        }),
      ],
    }),
  );
  children.push(
    PM(
      `Folio ${r.property.folio ?? '—'} · ${r.ahj.name} · Generated ${generated}`,
    ),
  );
  children.push(spacer());

  // Cover bottom-line callout
  children.push(callout('Bottom line', r.bottomLine, 'navy'));
  children.push(spacer());

  // Top flags
  if (r.flags.strong.length > 0 || r.flags.medium.length > 0) {
    children.push(H1('Top flags'));
    children.push(...flagSection('Strong', r.flags.strong, 'red'));
    children.push(...flagSection('Medium', r.flags.medium, 'amber'));
  }
  if (r.flags.weak.length > 0) {
    children.push(H3('Weak / informational'));
    children.push(...flagSection('Weak', r.flags.weak, 'grey'));
  }

  // Property
  children.push(H1('Property'));
  children.push(
    kvTable([
      ['Owner', r.property.owner ?? '—'],
      ['Year built', fmtNum(r.property.yearBuilt)],
      ['Heated / total area', `${fmtNum(r.property.heatedArea)} / ${fmtNum(r.property.totalArea)} sq ft`],
      ['Lot size', `${fmtNum(r.property.lotSize)} sq ft`],
      ['Bedrooms / bathrooms', `${fmtNum(r.property.bedrooms)} / ${fmtNum(r.property.bathrooms)}`],
      ['DOR description', r.property.dorDescription ?? '—'],
      ['Zoning', r.property.zoning ?? '—'],
      [
        'Mailing matches site',
        r.property.mailingMatchesSite === null
          ? '—'
          : r.property.mailingMatchesSite
            ? 'Yes'
            : `No — mailing: ${r.property.mailingAddress ?? '?'}`,
      ],
      ['Homestead', r.property.homesteadStatusText],
    ]),
  );

  // Permit history
  children.push(H1('Permit history'));
  children.push(
    P(
      `${r.permitHistory.totalSubjectPermits} permit(s) on file for this folio. ` +
        `${r.permitHistory.totalInspections} inspection record(s) matched this address. ` +
        `${r.permitHistory.neighborPermitCount} permit(s) on neighboring parcels in the same block.`,
    ),
  );
  children.push(permitsTable(r.permitHistory.subjectPermits));
  if (r.permitHistory.neighborByAddress.length > 0) {
    children.push(H3('Neighbor permit counts (same block)'));
    children.push(neighborTable(r.permitHistory.neighborByAddress));
  }

  // Extra features
  if (r.extraFeatures.length > 0) {
    children.push(H1('Property Appraiser extra features'));
    children.push(
      P(
        'These are improvements the county itself dates and values. Compare the dates against the permit table above.',
      ),
    );
    children.push(extraFeaturesTable(r.extraFeatures));
  }

  // Code enforcement
  children.push(H1('Code enforcement'));
  children.push(
    P(
      `${r.codeEnforcement.openCount} open case(s), ${r.codeEnforcement.closedPast5yCount} closed case(s) in the past 5 years.`,
    ),
  );
  if (r.codeEnforcement.openCases.length > 0) {
    children.push(H3('Open cases'));
    children.push(caseTable(r.codeEnforcement.openCases));
  }
  if (r.codeEnforcement.closedCases.length > 0) {
    children.push(H3('Closed cases (past 5y)'));
    children.push(caseTable(r.codeEnforcement.closedCases));
  }

  // Sales
  if (r.sales.length > 0) {
    children.push(H1('Sales history'));
    children.push(salesTable(r.sales));
  }

  // Confidence
  children.push(H1('Confidence'));
  children.push(confidenceTable(r.confidenceAssessment));

  // Next steps
  children.push(H1('Recommended next steps'));
  for (const n of r.nextSteps) children.push(bulletP(n));

  // Limitations
  children.push(H1('Data limitations'));
  for (const l of r.dataLimitations) children.push(bulletP(l));

  // Sources
  children.push(H1('Sources'));
  for (const s of r.dataSources) children.push(bulletP(s));

  const doc = new Document({
    creator: 'Palma Property Intelligence',
    title: `Permit History — ${r.property.siteAddress ?? r.query.address}`,
    description: 'Records-level diagnostic, generated by Permit-Check MVP.',
    styles: {
      default: {
        document: { run: { font: FONT_BODY, size: 22 } },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `Permit History · ${r.property.siteAddress ?? r.query.address ?? ''}`,
                    size: 16,
                    color: COLOR_MUTED,
                    font: FONT_BODY,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
                    size: 16,
                    color: COLOR_MUTED,
                    font: FONT_BODY,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
