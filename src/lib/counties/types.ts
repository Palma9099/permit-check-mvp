// Interface every county adapter implements. Tier A adapters pull live data;
// Tier B adapters only return portal links so the realtor has somewhere to
// click. Every adapter must succeed (never throw) - missing data is expressed
// via nulls / empty arrays, never exceptions.

import type {
  CodeCase,
  ExtraFeature,
  Permit,
  Sale,
} from '../types';

export interface PropertyBasics {
  folio: string | null;              // county-specific identifier (folio, parcel #, PIN)
  prettyFolio: string | null;        // formatted for display
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
  // Direct, click-through URL to this exact parcel's record on the county
  // Property Appraiser site, when the county's PA supports a stable deep link.
  // Null when we only have a search page (handled downstream in pa-links).
  paRecordUrl?: string | null;
}

export interface AdapterResult {
  found: boolean;                     // did we find property data via a live source?
  propertyBasics: PropertyBasics;
  sales: Sale[];
  extraFeatures: ExtraFeature[];
  permits: Permit[];
  inspectionCount: number;            // permits' associated inspection count if available
  neighborPermitTotal: number;        // permits on neighboring parcels; 0 if unavailable
  neighborByAddress: { address: string; count: number }[];
  codeCasesOpen: CodeCase[];
  codeCasesClosedPast5: CodeCase[];
  sourcesTried: string[];             // human-readable lines for "Data Sources"
  notes: string[];                    // human-readable caveats for "Data Limitations"
  candidates?: { folio: string; address: string }[]; // other parcels the address search matched (for "did you mean")
}

export interface CountyAdapter {
  slug: string;
  name: string;
  tier: 'A' | 'B';
  /**
   * Run the full live lookup for this address.
   * Should NEVER throw - on unknown/not-found, return `found: false` with
   * sane empty values and a note explaining why.
   */
  run(input: {
    address: string;
    zip: string | null;
    lat: number;
    lng: number;
  }): Promise<AdapterResult>;
}

export function emptyResult(sourcesTried: string[] = [], notes: string[] = []): AdapterResult {
  return {
    found: false,
    propertyBasics: {
      folio: null,
      prettyFolio: null,
      siteAddress: null,
      mailingAddress: null,
      mailingMatchesSite: null,
      owner: null,
      subdivision: null,
      yearBuilt: null,
      heatedArea: null,
      totalArea: null,
      lotSize: null,
      bedrooms: null,
      bathrooms: null,
      dorDescription: null,
      zoning: null,
      homesteadBaseYear: null,
      homesteadPercent: null,
      homesteadStatusText: '',
      paRecordUrl: null,
    },
    sales: [],
    extraFeatures: [],
    permits: [],
    inspectionCount: 0,
    neighborPermitTotal: 0,
    neighborByAddress: [],
    codeCasesOpen: [],
    codeCasesClosedPast5: [],
    sourcesTried,
    notes,
    candidates: [],
  };
}
