// Shared types for the deep-scan worker.

export interface ScanJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  email: string;
  address: string | null;
  folio: string | null;
  county: string | null;
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
}

export interface ScrapedViolation {
  caseNumber: string | null;
  status: string | null;
  openedDate: string | null;
  closedDate: string | null;
  description: string | null;
  lastAction: string | null;
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
}
