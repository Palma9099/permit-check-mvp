// Enhanced records-link adapter — a step up from the generic Tier-B fallback
// for priority counties (Broward, Palm Beach) where we don't yet run a
// VERIFIED live data scraper.
//
// Why not a live scraper here? Their public property/permit endpoints could
// not be verified end-to-end from the build environment, and shipping an
// unverified parser risks emitting *false* "unpermitted" findings — the exact
// harm we work to avoid. So these counties run the full satellite + Street View
// imagery comparison (handled by the orchestrator regardless of adapter) and
// receive accurate, county-specific guidance + portal links for manual records
// confirmation. A real live adapter can replace this once endpoints are
// verified with proper access — see TIER_A_ADAPTERS in ./index.ts.

import type { CountyAdapter, AdapterResult } from './types';
import { emptyResult } from './types';
import type { CountyDirectoryEntry } from './portals';

export function buildEnhancedLinksAdapter(
  dir: CountyDirectoryEntry,
  guidance: string[],
): CountyAdapter {
  const portalLines: string[] = [];
  if (dir.propertyAppraiser) portalLines.push(`Property Appraiser: ${dir.propertyAppraiser}`);
  if (dir.buildingDept) portalLines.push(`Building Dept: ${dir.buildingDept}`);
  if (dir.codeEnforcement) portalLines.push(`Code Enforcement: ${dir.codeEnforcement}`);

  return {
    slug: dir.slug,
    name: dir.name,
    tier: 'B',
    async run(): Promise<AdapterResult> {
      const sources = [
        `${dir.name} — full satellite + Street View imagery comparison performed; permit/appraiser data via county portals (links below).`,
        ...portalLines,
      ];
      const notes = [
        `${dir.name} is a priority county on the records-link tier. This diagnostic ran the imagery comparison, but unlike Miami-Dade we do not yet auto-pull permit and property-appraiser records here — confirm those through the county portals below before drawing conclusions.`,
        ...guidance,
      ];
      return emptyResult(sources, notes);
    },
  };
}
