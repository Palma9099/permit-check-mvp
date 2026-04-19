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

  // Hint used by the cover callout
  bottomLine: string[];
}
