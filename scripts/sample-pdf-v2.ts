// Build the v2 PDF from a saved DiagnosticReport JSON.
// Usage: npx tsx scripts/sample-pdf-v2.ts <report.json> <out.pdf>
import { readFileSync, writeFileSync } from 'node:fs';
import { buildPdfV2 } from '../src/lib/pdf-report-v2';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: sample-pdf-v2.ts <report.json> <out.pdf>');
  process.exit(2);
}
const report = JSON.parse(readFileSync(inPath, 'utf8'));
buildPdfV2(report).then((buf) => {
  writeFileSync(outPath, buf);
  console.log(`wrote ${outPath} (${buf.length} bytes)`);
});
