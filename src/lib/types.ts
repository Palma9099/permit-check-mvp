// Domain types shared between the API route, the lib, and the UI.

export type Confidence = 'high' | 'medium' | 'low' | 'not_observed';

export type FlagSeverity = 'strong' | 'medium' | 'weak' | 'ok';

export interface Flag {
  severity: FlagSeverity;
  title: string;
  detail: string;
}

export interface Sale {
  date: string | null;
  price: number | null;
  qualificationDescription: string | null;
}

export interface ExtraFeature {
  description: string;
  units: number | null;
  actualYearBuilt: number | null;
}

export interface CodeCase {
  caseNumber: string;
  caseDate: string | null;
  status: string;
  problemDescription: string;
  lastAction: string;
  lien: string;
}

export interface Permit {
  permitNumber: string | null;
  processNumber: string | null;
  appType: string | null;
  issueDate: string | null;
  status: string | null;
  estValue: number | null;
  contractor: string | null;
  scope: string | null;
}

export interface ConfidenceRow {
  topic: string;
  grade: Confidence;
  note: string;
}

export interface ChecklistItem {
  // What to look at when flipping to Street View / satellite / historical aerials
  item: string;
  whatPermitRecordSays: string;
  whatToLookFor: string;
  ifMismatchMeans: string;
}

export type VisionSeverity = 'flag' | 'note' | 'match' | 'uncertain';

export interface VisionObservation {
  area: string;              // e.g. "Roof", "Rear footprint", "Fence", "Shed"
  whatWeSaw: string;         // plain-English description of what the imagery shows
  vsPermitRecord: string;    // how that lines up with permits on file
  severity: VisionSeverity;
}

export interface VisualComparison {
  performed: boolean;             // did the vision model actually run?
  modelUsed: string | null;
  summary: string;                // one-line takeaway
  observations: VisionObservation[];
  failureReason: string | null;   // e.g. "ANTHROPIC_API_KEY not set" — UI can show a graceful fallback
  // When Then-vs-Now ran, these capture the actual dates the model compared.
  // Both null means the comparison was current-only (no historical NAIP).
  thenCaptureDate: string | null;
  nowCaptureDate: string | null;
}

// Historical aerial imagery pair from Planetary Computer NAIP. Null when
// NAIP coverage for the point is too sparse to give us a Then-vs-Now pair.
export interface HistoricalAerialFrame {
  captureDate: string;    // ISO 8601
  captureYear: number;
  itemId: string;
  imageUrl: string;       // PNG URL clipped to parcel bbox
}

export interface HistoricalAerialPair {
  then: HistoricalAerialFrame | null;
  now: HistoricalAerialFrame | null;
  allFrames: HistoricalAerialFrame[];   // every NAIP capture we found, earliest → latest
  source: string;                        // e.g. "Microsoft Planetary Computer / NAIP"
  failureReason: string | null;
}

// Historical Street View pair from Mapillary. When the API returns no usable
// THEN frame we still emit the result with then=null and a failureReason —
// the report should render "no historical Street View available" instead of
// silently dropping the section.
export interface HistoricalStreetViewFrameType {
  captureDate: string;
  captureYear: number;
  imageUrl: string;
  heading: number;
  label: string;
}

export interface HistoricalStreetViewPair {
  then: HistoricalStreetViewFrameType | null;
  now: HistoricalStreetViewFrameType | null;
  allFrames: HistoricalStreetViewFrameType[];
  source: string | null;
  failureReason: string | null;
}

export interface StreetViewImage {
  heading: number;                // 0 = north, 90 = east, 180 = south, 270 = west
  label: string;                  // human-readable, e.g. "Front (facing N)"
  imageUrl: string | null;        // signed Google Street View Static URL (null if no pano)
}

// A parcel polygon, as an ordered ring of [lat, lng] pairs. First and last point
// may be equal (GeoJSON style) or not — renderers should not assume.
export type ParcelRing = Array<[number, number]>;

export interface ThenVsNow {
  coordinates: { lat: number; lng: number } | null;
  // Current satellite image (property-tight) with parcel polygon drawn in red
  satelliteImageUrl: string | null;
  // Wider block context with parcel polygon drawn in red; neighbors visible as control
  contextSatelliteImageUrl: string | null;
  // Google Street View static images at multiple headings, already signed
  streetViewImages: StreetViewImage[];
  // Deep-link URLs for the realtor to click through and eyeball
  streetViewUrl: string | null;          // Current Google Street View pano
  streetViewTimelineUrl: string | null;  // Google Maps with Street View + clock icon for historical panos
  historicalAerialUrl: string | null;    // county-specific historical aerial viewer when available
  satelliteUrl: string | null;           // Google Maps satellite at high zoom
  // Parcel polygon in lat/lng — used to bound the vision model's analysis
  parcelPolygon: ParcelRing | null;
  parcelPolygonSource: string | null;    // e.g. "FL DOR Statewide Parcels" or "Miami-Dade PA"
  // Computed checklist — shown only as a fallback when vision comparison didn't run
  visualChecklist: ChecklistItem[];
  // Actual AI-powered visual comparison against permit record
  visualComparison: VisualComparison;
  // Historical aerial pair (Planetary Computer NAIP). Used by the AI call
  // for Then-vs-Now and rendered in the report as a side-by-side comparison.
  historicalAerials: HistoricalAerialPair;
  // Historical Street View pair (Mapillary). Used by the AI for facade-level
  // change detection (paint, doors, gates, windows) that aerials miss.
  historicalStreetView: HistoricalStreetViewPair;
}

export type CountyTier = 'A' | 'B';

export interface CountyPortalLinks {
  propertyAppraiser: string | null;     // e.g. https://www.bcpa.net
  buildingDept: string | null;          // e.g. city or county building dept portal
  codeEnforcement: string | null;       // e.g. https://... or null
  historicalAerial: string | null;      // county-specific aerial viewer when known
}

export interface CountyInfo {
  slug: string;                          // e.g. "fl-miami-dade", "fl-broward"
  name: string;                          // "Miami-Dade County", "Broward County"
  tier: CountyTier;                      // A = scraped; B = links only
  portals: CountyPortalLinks;
  scraperNote: string;                   // what we actually pulled live vs what needs manual follow-up
}

export interface DiagnosticReport {
  generatedAt: string;
  query: {
    address: string;
    zip: string | null;
  };

  property: {
    folio: string | null;
    siteAddress: string | null;
    mailingAddress: string | null;
    mailingMatchesSite: boolean | null;
    owner: string | null;
    subdivision: string | null;
    yearBuilt: number | null;
    heatedArea: number | null;
    totalArea: number | null;
    lotSize: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    dorDescription: string | null;
    zoning: string | null;
    homesteadBaseYear: number | null;
    homesteadPercent: number | null;
    homesteadStatusText: string;
  };

  sales: Sale[];

  extraFeatures: ExtraFeature[];

  permitHistory: {
    totalSubjectPermits: number;
    subjectPermits: Permit[];
    totalInspections: number;
    neighborPermitCount: number;
    neighborByAddress: { address: string; count: number }[];
  };

  codeEnforcement: {
    openCount: number;
    closedPast5yCount: number;
    openCases: CodeCase[];
    closedCases: CodeCase[];
  };

  flags: {
    strong: Flag[];
    medium: Flag[];
    weak: Flag[];
  };

  confidenceAssessment: ConfidenceRow[];

  nextSteps: string[];

  dataSources: string[];

  dataLimitations: string[];

  ahj: {
    slug: string;
    name: string;
    note: string;
  };

  // Statewide-aware county block. AHJ is retained for back-compat.
  county: CountyInfo;

  // "Then vs Now" visual-review block — imagery + realtor checklist
  thenVsNow: ThenVsNow;

  // Hint used by the cover callout
  bottomLine: string[];
}
