// Google Maps API key for BROWSER-RENDERED image URLs (Street View Static +
// Static Maps satellite). These URLs are embedded in the report and loaded by
// the visitor's browser, so the key is visible in page source.
//
// This key should be locked down in Google Cloud to:
//   • HTTP-referrer restriction = the app's own domains, and
//   • API restriction = only "Street View Static API" + "Maps Static API".
// That makes it safe to expose: a scraped copy only works from your domains and
// only for image tiles.
//
// Server-side calls (Geocoding, Places Autocomplete, Street View metadata) keep
// using GOOGLE_MAPS_API_KEY, which must NOT be referrer-restricted (server
// requests send no referer) and should be kept secret + API-restricted.
//
// Falls back to GOOGLE_MAPS_API_KEY so images keep rendering until the separate
// browser key is created and set — deploy the code first, add the env var after.
export function browserMapsKey(): string | undefined {
  return process.env.GOOGLE_MAPS_BROWSER_KEY || process.env.GOOGLE_MAPS_API_KEY;
}

// Server-side fetches of Google image URLs (PDF export, AI image comparison)
// send no Referer, so a referrer-restricted browser key would reject them.
// Send the site's own address, which the key's referrer allow-list includes.
export function googleImageFetchHeaders(url: string): Record<string, string> {
  return /^https:\/\/maps\.googleapis\.com\//.test(url)
    ? { Referer: 'https://permit-check-mvp.vercel.app/' }
    : {};
}
