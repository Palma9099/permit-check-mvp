// County adapter dispatcher.
//
// Given a normalized county key (e.g. "miami-dade"), return the right
// adapter. Miami-Dade is the only Tier A adapter currently wired up with
// live scraping; every other county uses the fallback (portal-links-only)
// adapter. New Tier A adapters drop in here as they come online.

import type { CountyAdapter } from './types';
import type { CountyInfo } from '../types';
import { miamiDadeAdapter } from './miami-dade-adapter';
import { buildFallbackAdapter } from './fallback';
import { FL_COUNTY_DIRECTORY, getCountyDirectoryEntry } from './portals';

const TIER_A_ADAPTERS: Record<string, CountyAdapter> = {
  'miami-dade': miamiDadeAdapter,
  // Future: 'broward': browardAdapter, 'palm-beach': palmBeachAdapter, etc.
};

export function getCountyAdapter(countyKey: string | null): CountyAdapter | null {
  if (!countyKey) return null;
  const tierA = TIER_A_ADAPTERS[countyKey];
  if (tierA) return tierA;
  const dir = getCountyDirectoryEntry(countyKey);
  if (!dir) return null;
  return buildFallbackAdapter(dir);
}

export function toCountyInfo(countyKey: string | null): CountyInfo {
  if (countyKey) {
    const dir = FL_COUNTY_DIRECTORY[countyKey];
    if (dir) {
      const adapter = TIER_A_ADAPTERS[countyKey];
      return {
        slug: dir.slug,
        name: dir.name,
        tier: adapter ? 'A' : 'B',
        portals: {
          propertyAppraiser: dir.propertyAppraiser,
          buildingDept: dir.buildingDept,
          codeEnforcement: dir.codeEnforcement,
          historicalAerial: dir.historicalAerial,
        },
        scraperNote: adapter
          ? `Live scraping active for ${dir.name}.`
          : `${dir.name} is on the links-only tier — we surface portal URLs but don't currently pull permit/appraiser data automatically.`,
      };
    }
  }
  return {
    slug: 'fl-unknown',
    name: 'County not determined',
    tier: 'B',
    portals: {
      propertyAppraiser: null,
      buildingDept: null,
      codeEnforcement: null,
      historicalAerial: null,
    },
    scraperNote:
      'We could not determine which Florida county this address is in. Confirm the address spelling, ZIP, and that it is inside Florida.',
  };
}

export { TIER_A_ADAPTERS };
