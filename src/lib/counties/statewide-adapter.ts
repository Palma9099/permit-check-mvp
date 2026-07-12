// Statewide Tier-A adapter factory.
//
// Produces a CountyAdapter that pulls REAL property/appraiser data + recent
// qualified sales for the parcel at the geocoded lat/lng from the FL DOR
// certified tax roll (see ./statewide-cadastral.ts). This is what promotes a
// county from "portal links only" to Tier A for PROPERTY data.
//
// Honest scope, stated plainly in the report's sources/notes:
//   • Property, ownership, year built, area, values, homestead, and the two
//     most recent qualified sales are LIVE from the state certified roll.
//   • Permits and code-enforcement cases are NOT auto-pulled for these counties
//     (no uniform public API exists). The adapter surfaces the county building
//     and code portals for manual confirmation and never fabricates permit
//     findings. Because we don't have an itemized extra-features list here
//     either, the orchestrator's "addition with no permit" flag simply won't
//     fire for these counties - by design, so we can't produce a false positive.
//
// Miami-Dade keeps its richer bespoke adapter (itemized features + live permits
// + code cases); this factory covers the rest of the top-tier counties.

import type { CountyAdapter, AdapterResult, PropertyBasics } from './types';
import { emptyResult } from './types';
import type { CountyDirectoryEntry } from './portals';
import { parcelByPoint } from './statewide-cadastral';
import { fetchCountyProperty } from './county-property';

export function buildStatewideAdapter(
  dir: CountyDirectoryEntry,
  guidance: string[] = [],
): CountyAdapter {
  const portalLines: string[] = [];
  if (dir.propertyAppraiser) portalLines.push(`Property Appraiser: ${dir.propertyAppraiser}`);
  if (dir.buildingDept) portalLines.push(`Building Dept (permits): ${dir.buildingDept}`);
  if (dir.codeEnforcement) portalLines.push(`Code Enforcement: ${dir.codeEnforcement}`);

  return {
    slug: dir.slug,
    name: dir.name,
    tier: 'A',
    async run({ lat, lng }): Promise<AdapterResult> {
      // Try the county's own fast hosted parcel layer first; fall back to the
      // slow/flaky FDOR statewide layer only when a county has no fast source.
      let parcel = await fetchCountyProperty(dir.slug, lat, lng);
      if (!parcel || !parcel.parcelId) {
        parcel = await parcelByPoint(lat, lng);
      }

      const permitNote =
        `${dir.name}: permits and code-enforcement cases are not auto-pulled for this county yet - confirm them through the county portals below. Property, ownership, and sales figures above are from the state certified roll and are reliable as of that assessment year.`;

      if (!parcel || !parcel.parcelId) {
        return emptyResult(
          [
            `FL DOR statewide certified tax roll (NAL) - queried by parcel location; no parcel resolved at this point.`,
            ...portalLines,
          ],
          [
            `Could not resolve a ${dir.name} parcel at the mapped location. The address may sit on a right-of-way, a very new plat not yet in the state roll, or just outside the county line. Confirm via the Property Appraiser link below.`,
            ...guidance,
          ],
        );
      }

      const asOf = parcel.assessmentYear ? ` (${parcel.assessmentYear} assessment year)` : '';

      const propertyBasics: PropertyBasics = {
        folio: parcel.parcelId,
        prettyFolio: parcel.parcelId,
        siteAddress: parcel.siteAddress,
        mailingAddress: parcel.mailingAddress,
        mailingMatchesSite: parcel.mailingMatchesSite,
        owner: parcel.owner,
        subdivision: parcel.legal,
        yearBuilt: parcel.yearBuilt ?? parcel.effectiveYearBuilt,
        heatedArea: parcel.livingArea,
        totalArea: parcel.livingArea,
        lotSize: parcel.landSqft,
        bedrooms: null, // not carried on the state NAL roll
        bathrooms: null, // not carried on the state NAL roll
        dorDescription: parcel.dorUseDescription,
        zoning: null, // NAL carries DOR use, not municipal zoning
        homesteadBaseYear: null,
        homesteadPercent: null,
        homesteadStatusText: parcel.homesteadStatusText,
        paRecordUrl: parcel.paRecordUrl ?? null,
      };

      const sources = [
        `FL DOR statewide certified tax roll (NAL)${asOf}: owner, situs address, year built, living area, land size, just/assessed/taxable value, homestead, and two most recent qualified sales - pulled live by parcel location.`,
        ...portalLines,
      ];

      const notes = [
        permitNote,
        `Values and characteristics reflect the county's certified submission to the FL Department of Revenue${asOf}. This is an annual certified roll, not a same-day feed; the county Property Appraiser site is authoritative for the very latest changes.`,
        ...guidance,
      ];

      return {
        found: true,
        propertyBasics,
        sales: parcel.sales,
        extraFeatures: [], // itemized features not on the state roll for these counties
        permits: [],
        inspectionCount: 0,
        neighborPermitTotal: 0,
        neighborByAddress: [],
        codeCasesOpen: [],
        codeCasesClosedPast5: [],
        sourcesTried: sources,
        notes,
        candidates: [],
      };
    },
  };
}
