// Does the evidence actually support the registry?
//
// The rule, after Codex stopped a round on Maitland: a city is routed only if
// the attached verification transcript shows the production adapter reading
// it. Maitland broke that rule while I defended it with runs nobody could
// check, so the rule is now enforced by a program rather than by my memory of
// which transcripts said what.
//
//   npx tsx src/check-energov-evidence.ts <tenant-verification.txt>
//
// Exits non-zero when any routed city is absent from the transcript or shown
// as refused. Run it before bundling a review, so a registry that has drifted
// ahead of its evidence fails here instead of in front of a reviewer.
import { readFileSync } from 'node:fs';
import { CITY_JURISDICTIONS, ENERGOV_EXPANSION_POPULATION, type EnergovJurisdiction } from './scrapers/jurisdictions.js';
import { evidenceFor, evidenceSupportsRouting } from './scrapers/energov-parse.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: check-energov-evidence.ts <tenant-verification.txt>');
  process.exit(2);
}
const transcript = readFileSync(file, 'utf8');

// Only the tenants this expansion added. Hialeah, Coral Gables, Doral and
// Miami Beach were wired and evidenced earlier, under their own review.
const PRE_EXISTING = new Set(['HIALEAH', 'CORAL GABLES', 'DORAL', 'MIAMI BEACH']);

const routed = Object.entries(CITY_JURISDICTIONS)
  .filter(([, j]) => j.platform === 'energov')
  .map(([key, j]) => ({ key, muni: key.split(':')[1], name: (j as EnergovJurisdiction).tenant.name }))
  .filter((r) => !PRE_EXISTING.has(r.muni));

let bad = 0;
for (const r of routed) {
  const v = evidenceFor(transcript, r.name);
  if (evidenceSupportsRouting(v)) continue;
  bad++;
  const why =
    v === 'contradictory'
      ? 'BOTH usable and refused in the same transcript - unstable, not usable'
      : v === 'refused'
        ? 'REFUSED in the transcript'
        : 'absent from the transcript';
  console.log(`FAIL  ${r.name.replace(/^(City|Town|Village) of /, '').padEnd(22)} ${why}`);
}

const transcriptTotal = (transcript.match(/^USABLE\s/gim) ?? []).length;
console.log(`\nrouted expansion cities: ${routed.length}`);
console.log(`claimed population:      ${ENERGOV_EXPANSION_POPULATION.toLocaleString()}`);
console.log(`USABLE lines in file:    ${transcriptTotal}`);
console.log(bad === 0
  ? '\nOK: every routed city is shown reading in this transcript.'
  : `\n${bad} routed city/cities are not supported by this transcript. Remove them or supply a run that reads them.`);
process.exit(bad === 0 ? 0 : 1);
