// Best clickable Property Appraiser link for a county.
//
// The goal: for EVERY Florida county - especially the ones we don't pull live
// property data for - the report should hand the user a link that drops them
// straight into that county's PA property lookup, not just the PA homepage.
//
// Three tiers, best first:
//   1. paRecordUrl  - a deep link straight to THIS parcel's record. Only the
//                     counties whose PA serves a stable, folio-keyed URL set
//                     this (built in county-property.ts from the raw fields).
//   2. PA_SEARCH_URL - the county PA's property-SEARCH page (one field to type
//                     the address into). Curated + link-checked below.
//   3. homepage     - the directory's PA URL, as a never-broken fallback.
//
// Only verified property-search pages go in PA_SEARCH_URL. A wrong/404 link is
// worse than the working homepage, so anything unconfirmed is intentionally
// left out and falls through to the homepage.

// County keys are the bare directory keys (e.g. "pasco"), matching
// FL_COUNTY_DIRECTORY. Values are link-checked property-search entry pages.
export const PA_SEARCH_URL: Record<string, string> = {
  // Verified in a real browser (loads a working property-search form).
  duval: 'https://paopropertysearch.coj.net/Basic/Search.aspx',
  orange: 'https://ocpaweb.ocpafl.org/parcelsearch',
  pinellas: 'https://www.pcpao.gov/search',
  brevard: 'https://www.bcpao.us/PropertySearch/',
  seminole: 'https://parceldetails.scpafl.org/',
  pasco: 'https://search.pascopa.com/',
  sarasota: 'https://www.sc-pa.com/propertysearch/',
  manatee: 'https://www.manateepao.gov/search/',
  marion: 'https://www.pa.marion.fl.us/PropertySearch.aspx',
  citrus: 'https://www.citruspa.org/_web/search/commonsearch.aspx?mode=realprop',
  leon: 'https://www.leonpa.gov/pt/search/commonsearch.aspx?mode=realprop',
  // Connected counties whose PA is a JS SPA with no stable folio-in-URL deep
  // link - we already show their full property data in-report, so the button
  // just drops the user on the county's property-search app.
  broward: 'https://web.bcpa.net/BcpaClient/#/Record-Search',
  hillsborough: 'https://gis.hcpafl.org/propertysearch/',
};

// Return the best PA link we have for this county, in priority order.
export function bestPropertyAppraiserLink(
  countyKey: string | null,
  paRecordUrl: string | null | undefined,
  directoryHomepage: string | null,
): string | null {
  if (paRecordUrl) return paRecordUrl;
  const key = (countyKey ?? '').replace(/^fl-/, '');
  if (key && PA_SEARCH_URL[key]) return PA_SEARCH_URL[key];
  return directoryHomepage;
}
