// Writes src/lib/city-code-coverage.generated.ts from the worker's adapter
// registry.
//
//   npm run gen:coverage
//
// Why a generated file instead of importing the registry directly: the worker
// is written for Node's ESM resolution and imports its own modules with a
// ".js" suffix on ".ts" files. Vitest resolves that; the Next.js webpack build
// does not, so `src/lib` importing worker modules fails the web build outright
// (confirmed: "Can't resolve './citizenserve-parse.js'"). The alternative was
// an `extensionAlias` rule in next.config bending the web build's resolution
// around the worker's conventions, which is a bigger change with a wider blast
// radius than one generated data file.
//
// The thing this must not become is the file it replaced. `code-authority.ts`
// used to carry a hand-written list of city portals, and it sat at one entry
// while the registry grew to 36 cities, because nothing compared them. The
// difference here is not that this copy is prettier - it is that
// tests/city-adapters-reachable.test.ts rebuilds this data from the registry
// and fails when the two disagree. A copy nothing checks goes stale; a copy CI
// checks is a cache.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CITY_JURISDICTIONS } from '../worker/src/scrapers/jurisdictions.js';

/** One city's coverage, flattened to data the web app can read. */
export interface GeneratedCityCoverage {
  key: string;
  name: string;
  platform: string;
  portalUrl: string | null;
}

/**
 * Flatten the registry. Exported so the test can rebuild it from the registry
 * and compare, rather than trusting the committed file.
 */
export function buildCoverage(): GeneratedCityCoverage[] {
  const out: GeneratedCityCoverage[] = [];
  for (const key of Object.keys(CITY_JURISDICTIONS).sort()) {
    const jur = CITY_JURISDICTIONS[key];
    // A 'generic' entry drives guessed selectors and degrades to "use the
    // link". That is not a city we can promise to read, so it is left out
    // entirely rather than advertised as covered.
    if (jur.platform === 'generic') continue;
    const search = jur.portalLinks.find((l) => /search|code|case|enforce/i.test(l.label));
    out.push({
      key,
      name: jur.name,
      platform: jur.platform,
      portalUrl: search?.url ?? jur.portalLinks[0]?.url ?? null,
    });
  }
  return out;
}

const HEADER = `// GENERATED FILE - DO NOT EDIT BY HAND.
//
// Source: worker/src/scrapers/jurisdictions.ts (CITY_JURISDICTIONS)
// Regenerate: npm run gen:coverage
//
// Every city the deep scan can read, flattened so the Next.js build does not
// have to resolve worker modules (it cannot - see scripts/gen-city-code-coverage.ts).
//
// tests/city-adapters-reachable.test.ts rebuilds this from the registry and
// fails if the two have drifted, so editing this file by hand or forgetting to
// regenerate it breaks CI rather than quietly misinforming a reader.
`;

function main() {
  const rows = buildCoverage();
  const body = `${HEADER}
export interface CityCoverageRow {
  /** "\${county key}:\${MUNICIPALITY}", as the registry keys it. */
  key: string;
  name: string;
  platform: string;
  portalUrl: string | null;
}

export const CITY_CODE_COVERAGE: CityCoverageRow[] = ${JSON.stringify(rows, null, 2)};
`;
  const target = resolve(import.meta.dirname ?? __dirname, '../src/lib/city-code-coverage.generated.ts');
  writeFileSync(target, body);
  console.log(`wrote ${rows.length} cities to ${target}`);
}

// Only write when run as a command, never on import.
//
// The drift test imports `buildCoverage` from this file, and while `main()` ran
// at module load that import REWROTE the committed file as a side effect of
// running the test suite. The test still failed on tampered data (the
// comparison reads the already-imported module), but a suite that silently
// repairs the file it is checking is a trap: drift would vanish on the next
// `npm test` instead of being reported, and the only thing standing between
// that and a false pass was module evaluation order.
const invokedDirectly = (() => {
  const entry = process.argv[1] ?? '';
  return /gen-city-code-coverage\.(ts|js)$/.test(entry);
})();

if (invokedDirectly) main();
