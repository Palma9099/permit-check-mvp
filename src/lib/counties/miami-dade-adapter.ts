// Miami-Dade adapter — wraps the existing Miami-Dade Property Appraiser +
// ArcGIS Open Data pipeline into the CountyAdapter interface. The heavy
// lifting still lives in lib/miami-dade.ts; this file is the thin shim that
// exposes it in the common shape the new dispatcher expects.

import {
  paByAddress,
  paByFolio,
  permitsByFolio,
  inspectionsByAddress,
  neighborPermits,
  codeEnforcement,
} from '../miami-dade-raw';
import type { AdapterResult, CountyAdapter } from './types';
import { emptyResult } from './types';
import type { ExtraFeature, Sale } from '../types';

function cleanString(s: unknown): string {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[, ]+/g, '').trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function prettyFolio(folio: string): string {
  const f = folio.replace(/\D+/g, '').padStart(13, '0').slice(-13);
  if (f.length !== 13) return folio;
  return `${f.slice(0, 2)}-${f.slice(2, 6)}-${f.slice(6, 9)}-${f.slice(9, 13)}`;
}

function parseHomestead(pa: any): {
  baseYear: number | null;
  percent: number | null;
  statusText: string;
} {
  const pi = pa?.PropertyInfo ?? {};
  const base = typeof pi.HxBaseYear === 'number' ? pi.HxBaseYear : null;
  const pct =
    typeof pi.PercentHomesteadCapped === 'number' ? pi.PercentHomesteadCapped : null;

  const taxInfos: any[] = pa?.Taxable?.TaxableInfos ?? [];
  const recentYears = taxInfos
    .filter((t) => typeof t?.Year === 'number')
    .sort((a, b) => b.Year - a.Year)
    .slice(0, 3);
  const exemptZeroYears = recentYears
    .filter((t) => (t.CountyExemptionValue ?? 0) === 0)
    .map((t) => String(t.Year));

  let text = '';
  if (base && base > 1900) {
    text = `Homestead on file — HxBaseYear ${base}. `;
  } else {
    text = 'No homestead on file. ';
  }
  if (exemptZeroYears.length > 0) {
    text += `CountyExemptionValue $0 for: ${exemptZeroYears.join(', ')}.`;
  }
  return { baseYear: base, percent: pct, statusText: text.trim() };
}

// Year built is exposed at PropertyInfo.YearBuilt as a number for single-
// building parcels and as the literal string "Multiple (See Building Info.)"
// for parcels with more than one building footprint. In the second case the
// PA UI links to the BuildingInfos array; each building has an `Actual` year.
// We take the earliest Actual across all buildings as the parcel's year built
// (matches what the PA web UI shows on the cover sheet).
function resolveYearBuilt(pa: any): number | null {
  const pi = pa?.PropertyInfo ?? {};
  if (typeof pi.YearBuilt === 'number' && pi.YearBuilt > 1800) return pi.YearBuilt;
  if (typeof pi.YearBuilt === 'string') {
    const n = Number(pi.YearBuilt.replace(/\D+/g, ''));
    if (Number.isFinite(n) && n > 1800) return n;
  }
  // Fall through: scan BuildingInfos for the earliest Actual year built.
  const infos: any[] = pa?.Building?.BuildingInfos ?? [];
  const actualYears = infos
    .map((b) => (typeof b?.Actual === 'number' ? b.Actual : null))
    .filter((y): y is number => typeof y === 'number' && y > 1800);
  if (actualYears.length === 0) return null;
  return Math.min(...actualYears);
}

// PA returns the city as the literal "Unincorporated County" for parcels
// outside any incorporated municipality. That's not a place name a buyer
// will recognize, so we expand it to "Unincorporated Miami-Dade County".
function normalizeMiamiDadeCity(city: string | null | undefined): string | null {
  if (!city) return null;
  const c = city.trim();
  if (/^unincorporated\s+county$/i.test(c)) return 'Unincorporated Miami-Dade County';
  return c;
}

function normalizeMiamiDadeAddress(addr: string | null | undefined): string | null {
  if (!addr) return null;
  return addr.replace(/,\s*Unincorporated County,/i, ', Unincorporated Miami-Dade County,');
}

function dedupeExtraFeatures(arr: any[]): ExtraFeature[] {
  const seen = new Set<string>();
  const out: ExtraFeature[] = [];
  for (const raw of arr) {
    const feature: ExtraFeature = {
      description: cleanString(raw?.Description),
      units: typeof raw?.Units === 'number' ? raw.Units : null,
      actualYearBuilt:
        typeof raw?.ActualYearBuilt === 'number' ? raw.ActualYearBuilt : null,
    };
    if (!feature.description) continue;
    const key = `${feature.description}|${feature.units}|${feature.actualYearBuilt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(feature);
  }
  return out;
}

function formatSales(pa: any): Sale[] {
  const arr = Array.isArray(pa?.SalesInfos) ? pa.SalesInfos : [];
  return arr.map((s: any) => ({
    date: cleanString(s?.DateOfSale) || null,
    price: typeof s?.SalePrice === 'number' ? s.SalePrice : null,
    qualificationDescription: cleanString(s?.QualificationDescription) || null,
  }));
}

function mailingMatchesSite(pa: any): { matches: boolean | null; mail: string | null; site: string | null } {
  const site = pa?.SiteAddress?.[0]?.Address as string | undefined;
  const mail = pa?.MailingAddress?.Address1 as string | undefined;
  if (!site || !mail) return { matches: null, mail: mail ?? null, site: site ?? null };
  const s = site.trim().toUpperCase();
  const m = mail.trim().toUpperCase();
  return { matches: s === m, mail, site };
}

const SOURCE_LINES = [
  'Miami-Dade Property Appraiser public JSON (PaServicesProxy): owner, building, extra features, sales, benefit/taxable',
  'Miami-Dade Open Data (ArcGIS FeatureServer): BuildingPermit_gdb, Open_Building_Violations, BuildingViolation_gdb, CodeComplianceViolation (Open/Closed past 5y), EnergovCodeCasePublicView, inspectionsData',
];

const NOTE_LINES = [
  'Records reflect the digital portal only. Paper/microfilm permit archives predating the Miami-Dade digital migration may not appear.',
  'Miami-Dade v1 covers unincorporated county + folios visible in the countywide BuildingPermit_gdb. City-of-Miami Beach, Coral Gables, and similar city-portal-only permits may be under-represented.',
];

export const miamiDadeAdapter: CountyAdapter = {
  slug: 'fl-miami-dade',
  name: 'Miami-Dade County',
  tier: 'A',
  async run({ address, zip }): Promise<AdapterResult> {
    const byAddr = await paByAddress(address, zip).catch(() => ({ folio: null, candidates: [] as Array<{ folio: string; address: string }> }));
    const folio = byAddr.folio;
    if (!folio) {
      return emptyResult(
        SOURCE_LINES,
        [
          ...NOTE_LINES,
          `Miami-Dade Property Appraiser could not resolve "${address}" to a folio. Property may be in a city portal not yet connected, or the address string may need correction.`,
        ],
      );
    }

    const [pa, permits, neighbors, codeEnf, inspectionCount] = await Promise.all([
      paByFolio(folio).catch(() => null),
      permitsByFolio(folio).catch(() => []),
      neighborPermits(folio).catch(() => ({ total: 0, byAddress: [] as { address: string; count: number }[] })),
      codeEnforcement(folio).catch(() => ({ open: [], closedPast5: [] })),
      inspectionsByAddress(byAddr.candidates[0]?.address ?? address).catch(() => 0),
    ]);

    if (!pa) {
      return emptyResult(
        SOURCE_LINES,
        [...NOTE_LINES, `PA lookup failed for folio ${folio}.`],
      );
    }

    const pi = pa.PropertyInfo ?? {};
    const homestead = parseHomestead(pa);
    const features = dedupeExtraFeatures(pa.ExtraFeature?.ExtraFeatureInfos ?? []);
    const mailMatch = mailingMatchesSite(pa);

    return {
      found: true,
      propertyBasics: {
        folio,
        prettyFolio: prettyFolio(folio),
        siteAddress: normalizeMiamiDadeAddress(cleanString(pa.SiteAddress?.[0]?.Address)) || null,
        mailingAddress: mailMatch.mail,
        mailingMatchesSite: mailMatch.matches,
        owner: cleanString(pa.OwnerInfos?.[0]?.Name) || null,
        subdivision: cleanString(pa.LegalDescription?.[0]?.Description) || null,
        yearBuilt: resolveYearBuilt(pa),
        heatedArea: toNum(pi.BuildingHeatedArea),
        totalArea: toNum(pi.BuildingActualArea),
        lotSize: toNum(pi.LotSize),
        bedrooms: toNum(pi.BedroomCount),
        bathrooms: toNum(pi.BathroomCount),
        dorDescription: cleanString(pi.DORDescription) || null,
        zoning: cleanString(pi.PrimaryZone) || null,
        homesteadBaseYear: homestead.baseYear,
        homesteadPercent: homestead.percent,
        homesteadStatusText: homestead.statusText,
      },
      sales: formatSales(pa),
      extraFeatures: features,
      permits,
      inspectionCount,
      neighborPermitTotal: neighbors.total,
      neighborByAddress: neighbors.byAddress,
      codeCasesOpen: codeEnf.open,
      codeCasesClosedPast5: codeEnf.closedPast5,
      sourcesTried: SOURCE_LINES,
      notes: NOTE_LINES,
    };
  },
};
