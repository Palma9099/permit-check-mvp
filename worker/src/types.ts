// Shared types for the deep-scan worker.

export interface ScanJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  email: string;
  address: string | null;
  folio: string | null;
  county: string | null;
  /** Municipality from the property appraiser, when the queue supplies one.
   *  A city often governs code where the county does not. */
  municipality?: string | null;
  lat: number | null;
  lng: number | null;
  attempts: number;
  max_attempts: number;
}

export interface ScrapedPermit {
  permitNumber: string | null;
  type: string | null;
  status: string | null;
  issuedDate: string | null;
  finaledDate: string | null;
  description: string | null;
  value: string | null;
  contractor: string | null;
  /** Outstanding balance as the portal prints it, e.g. "$0.00". Palm Beach publishes this. */
  balance?: string | null;
}

export interface ScrapedViolation {
  caseNumber: string | null;
  status: string | null;
  openedDate: string | null;
  closedDate: string | null;
  description: string | null;
  lastAction: string | null;
  /** Code sections cited, verbatim, e.g. "PBCAFBC20-105.1: PBC Amendments to FBC 7th Edition (2020)". */
  codes?: string[];
  /** The inspector's narrative, which names the specific structure or condition cited. */
  details?: string | null;
  /**
   * The address THIS record is filed against, when the source gives one.
   *
   * Required whenever a search was broader than one parcel. An Accela street
   * search returns the whole street, and the adapter told the reader to
   * "check the address on each row" while dropping the address from every
   * row - an instruction the data made impossible to follow. A caveat the
   * reader cannot act on is not a caveat.
   */
  recordAddress?: string | null;
}

export interface PortalLink {
  label: string;
  url: string;
}

export interface ScrapeResult {
  ok: boolean;                 // did we successfully read records (even if zero)?
  county: string;
  matchedAddress: string | null;
  folio: string | null;
  permits: ScrapedPermit[];
  violations: ScrapedViolation[];
  notes: string[];             // human-readable caveats / what we did
  portalLinks: PortalLink[];   // always provided so the email is useful even on failure
  source: string;              // which portal(s) were read
  /**
   * Did we actually search each axis on this run? Absent means "same as `ok`".
   *
   * `ok` is one flag for a result with two independent halves, and an adapter
   * that searches only one of them was reporting the other as empty. The
   * EnerGov adapter searches code cases only (module 5), so its successful
   * runs were printing "No permits found" for a permit history nobody looked
   * at. An empty list is only ever publishable as "none" when the matching
   * flag here is true.
   */
  permitsChecked?: boolean;
  violationsChecked?: boolean;
}
