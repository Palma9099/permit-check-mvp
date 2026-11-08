// The shape of a Palma lien search, and the few helpers every county provider
// shares. Split out of lien-search.ts so a county provider can build a search
// without importing another county's data pulls.
//
// The product rule lives here, in section(): a source that did not answer is
// reported as "could not be checked", never as clear.

export type LienTone = 'red' | 'amber' | 'green';

export interface LienLine {
  title: string;
  detail: string;
  tone: LienTone;
}

// 'liens' and 'code' exist in every county. The rest appear only where the
// county publishes that data.
export type LienSectionKey = 'liens' | 'code' | 'building' | 'permits' | 'environment';

export interface LienSection {
  key: LienSectionKey;
  title: string;
  state: 'clear' | 'found' | 'failed';
  summary: string;
  lines: LienLine[];
  source: string;
}

// 'taxes', 'records' and 'utilities' are behind a captcha or bot wall in every
// Florida county, so they are always staff steps. 'city' is added for a parcel
// inside a municipality, whose code cases county records do not cover.
// 'countyCode' and 'countyPermits' are added only where the county itself
// publishes no machine-readable case data, so a person has to look.
export type StaffStepKey = 'taxes' | 'records' | 'utilities' | 'city' | 'countyCode' | 'countyPermits';

export interface StaffStep {
  key: StaffStepKey;
  title: string;
  how: string;
  /**
   * Where the person goes to answer this step. Set by the county provider,
   * which is the only place that knows the county's own offices, so the staff
   * page needs no county table of its own. Omitted when the step has no single
   * page (a city letter is usually a phone call or an email).
   */
  url?: string;
}

// What is pulled live for this county versus what a person completes. Printed
// on the search so the reader never has to guess which half they are holding.
export interface LienCoverage {
  // 'cases'   county publishes code/lien/permit cases by parcel: pulled live.
  // 'records' county publishes parcel and tax-roll records only: the cases are
  //           a staff step, and the search says so.
  level: 'cases' | 'records';
  automated: string[];
  byHand: string[];
}

export interface LienSearch {
  county: string;      // county key, e.g. 'broward'
  countyName: string;  // 'Broward County'
  parcelLabel: string; // what this county calls the number: 'Folio', 'Parcel ID'
  coverage: LienCoverage;
  folio: string;
  prettyFolio: string;
  address: string | null;
  owner: string | null;
  legal: string | null;
  municipality: string | null;
  unincorporated: boolean;
  searchedAt: string;
  sections: LienSection[];
  staffSteps: StaffStep[];
  found: number;  // lines that need action (red or amber)
  failed: number; // sections that could not be checked
}

export const dt = (s: string | null) =>
  s
    ? new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : 'date not shown';

// Some county layers write recording dates as MM/DD/YYYY.
export const mdy = (s: string) => {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? dt(`${m[3]}-${m[1]}-${m[2]}`) : s || 'date not shown';
};

export const cap = (s: string) => s.toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

export function section(
  key: LienSectionKey,
  title: string,
  source: string,
  result: PromiseSettledResult<LienLine[]>,
  clearText: string,
): LienSection {
  if (result.status === 'rejected') {
    return {
      key,
      title,
      source,
      state: 'failed',
      lines: [],
      summary: 'The county source did not answer. Palma staff check this by hand before delivery.',
    };
  }
  // Satisfied liens matter only for checking releases: one line with their
  // Official Records references instead of a line each.
  const sat = result.value.filter((l) => l.tone === 'green');
  const lines =
    sat.length > 2
      ? [
          ...result.value.filter((l) => l.tone !== 'green'),
          {
            title: `${sat.length} older liens shown as satisfied`,
            detail: `Official Records Book/Page: ${sat
              .map((l) => l.detail.match(/Book (\S+) Page (\S+?)\./)?.slice(1, 3).join('/'))
              .filter(Boolean)
              .join(', ')}. Confirm each release is recorded.`,
            tone: 'green' as const,
          },
        ]
      : result.value;
  const problems = lines.filter((l) => l.tone !== 'green').length;
  const released = sat.length;
  const old = released
    ? ` ${released} older lien${released > 1 ? 's show' : ' shows'} as satisfied; confirm the release${released > 1 ? 's are' : ' is'} recorded.`
    : '';
  return {
    key,
    title,
    source,
    // Problems first, satisfied liens after.
    lines: [...lines].sort((a, b) => Number(a.tone === 'green') - Number(b.tone === 'green')),
    state: problems ? 'found' : 'clear',
    summary: (problems ? `${problems} item${problems > 1 ? 's' : ''} to resolve before closing.` : clearText) + old,
  };
}

export const countTotals = (sections: LienSection[]) => ({
  found: sections.reduce((n, s) => n + s.lines.filter((l) => l.tone !== 'green').length, 0),
  failed: sections.filter((s) => s.state === 'failed').length,
});
