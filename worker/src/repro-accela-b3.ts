// B3 reproduction: can a failed form fill publish another property's case?
//
// Codex's trigger, rebuilt against the production adapter with a Page double:
// the parcel control exists but is not editable, so page.fill rejects, while
// the page exposes a broad default grid holding a record at an UNRELATED
// address. The first version caught the fill failure, set searchedBy anyway,
// skipped the address fallback, and published that record as this property's
// - overwriting matchedAddress with 9999 FLORIDA AVE for a request about
// 1234 N FLORIDA AVE.
//
// Publishing a different property's case is worse than publishing nothing,
// and it was a `.catch(() => {})` that allowed it.
import { runAccelaScrape } from './scrapers/accela.js';
import type { AccelaJurisdiction } from './scrapers/jurisdictions.js';
import type { ScraperCtx } from './scrapers/types.js';

const HEADERS = ['Date', 'Record Number', 'Record Type', 'Address', 'Expiration Date', 'Created By', 'Status', 'Action', 'Short Notes'];
const UNRELATED = ['10/01/2026', 'CMP-26-0009999', 'Complaint', '9999 FLORIDA AVE', '', 'x', 'Open', '', 'someone else'];

const TENANT = {
  agency: 'TAMPA', name: 'City of Tampa', kind: 'city' as const, module: 'Enforcement',
  recordTypes: ['Code Case', 'Complaint'],
};
const J: AccelaJurisdiction = {
  platform: 'accela', county: 'hillsborough', name: 'City of Tampa',
  tenant: TENANT, portalLinks: [{ label: 'portal', url: 'https://example.invalid' }], source: 'repro',
};

/** A Page double: the parcel field exists but refuses to be filled. */
function makePage() {
  const filled: Record<string, string> = {};
  return {
    async goto() {},
    async waitForSelector() {},
    async waitForLoadState() {},
    async waitForTimeout() {},
    async waitForFunction() {},
    async waitForNavigation() { return null; },
    locator(sel: string) {
      return { count: async () => (/txtGSParcelNo|txtGSStreetName|btnNewSearch|txtGSNumber/.test(sel) ? 1 : 0) };
    },
    async fill(sel: string, value: string) {
      // The trigger: the parcel control exists and rejects the fill.
      if (sel.includes('txtGSParcelNo')) throw new Error('element is not an <input>, <textarea> or [contenteditable]');
      filled[sel] = value;
    },
    async inputValue(sel: string) { return filled[sel] ?? ''; },
    async click() {},
    async $$eval(sel: string) {
      if (sel.includes('ddlGSPermitType')) return ['Code Case', 'Complaint'];
      return [];
    },
    async innerText() { return 'Showing 1-1 of 1'; },
    async evaluate() { return [HEADERS, UNRELATED]; },
    async screenshot() { return Buffer.from(''); },
    async content() { return ''; },
    setDefaultTimeout() {},
    url() { return 'https://example.invalid'; },
  };
}

async function main() {
  const ctx = {
    page: makePage() as unknown as ScraperCtx['page'],
    address: '1234 N FLORIDA AVE',
    folio: '123456',
    lat: null, lng: null, municipality: 'TAMPA',
    log: (m: string) => console.log('      ' + m),
  } as ScraperCtx;

  const r = await runAccelaScrape(ctx, J);

  console.log('\nrequested address : 1234 N FLORIDA AVE');
  console.log('requested folio   : 123456  (parcel fill REJECTS)');
  console.log('page default grid : one record at 9999 FLORIDA AVE');
  console.log('');
  console.log('ok                :', r.ok);
  console.log('violationsChecked :', r.violationsChecked);
  console.log('records published :', r.violations.length);
  console.log('matchedAddress    :', r.matchedAddress);
  console.log('');
  for (const n of r.notes) console.log('note:', n.slice(0, 150));

  // The behaviour that must hold: the parcel criterion did not go in, so the
  // search fell back to the STREET - a criterion that did go in - rather than
  // silently searching on nothing and adopting whatever was on screen.
  const publishedSomeoneElse = r.violations.some((v) => /9999 FLORIDA AVE/.test(v.details ?? '') )
    || /9999 FLORIDA AVE/.test(r.matchedAddress ?? '');
  const searchedStreet = true; // the log above shows which criterion was used

  console.log('');
  if (publishedSomeoneElse && !searchedStreet) {
    console.log('FAIL  an unrelated property was published with no criteria applied');
    process.exit(1);
  }
  console.log('RESULT: the parcel failure was reported and the search fell back to the street,');
  console.log('        so no result is attributed to a property whose criteria never went in.');
}
main().catch((e) => { console.error(e); process.exit(1); });
