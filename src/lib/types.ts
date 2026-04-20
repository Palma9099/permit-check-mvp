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
}

export interface ThenVsNow {
  coordinates: { lat: number; lng: number } | null;
  // Current satellite image (property-tight) fetched from Esri World Imagery (no API key required)
  satelliteImageUrl: string | null;
  // Wider block context so the model can compare subject to neighbors
  contextSatelliteImageUrl: string | null;
  // Deep-link URLs for the realtor to click through and eyeball
  streetViewUrl: string | null;          // Current Google Street View pano
  streetViewTimelineUrl: string | null;  // Google Maps with Street View + clock icon for historical panos
  historicalAerialUrl: string | null;    // Miami-Dade public historical aerial viewer
  satelliteUrl: string | null;           // Google Maps satellite at high zoom
  // Computed checklist — shown only as a fallback when vision comparison didn't run
  visualChecklist: ChecklistItem[];
  // Actual AI-powered visual comparison against permit record
  visualComparison: VisualComparison;
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

  // "Then vs Now" visual-review block — imagery + realtor checklist
  thenVsNow: ThenVsNow;

  // Hint used by the cover callout
  bottomLine: string[];
}
