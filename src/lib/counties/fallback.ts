// Tier B fallback adapter — used for every county where we don't have a
// working live scraper. Returns empty data with an explanatory note. The
// diagnostic still runs, just leaning entirely on satellite + Street View
// vision comparison and on the portal links we surface in the UI.

import type { CountyAdapter, AdapterResult } from './types';
import { emptyResult } from './types';
import type { CountyDirectoryEntry } from './portals';

export function buildFallbackAdapter(dir: CountyDirectoryEntry): CountyAdapter {
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
        `${dir.name} portals surfaced as links (no direct data pull configured for this county yet).`,
        ...portalLines,
      ];
      const notes = [
        `${dir.name} is on the links-only tier. We couldn't automatically retrieve permit or property-appraiser data; the diagnostic leans on satellite + Street View visual comparison and on the portal links above for manual verification.`,
        'If the realtor/investor needs the full property-appraiser + permit pull for this county, that adapter can be added. Contact the developer with the property to prioritize.',
      ];
      return emptyResult(sources, notes);
    },
  };
}
