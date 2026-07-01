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
import { buildEnhancedLinksAdapter } from './enhanced-links-adapter';
import { buildStatewideAdapter } from './statewide-adapter';
import { FL_COUNTY_DIRECTORY, getCountyDirectoryEntry } from './portals';

// Counties promoted to Tier A via the statewide FL DOR certified-roll adapter.
// These return REAL property/appraiser data + recent qualified sales pulled
// live by parcel location. Miami-Dade keeps its richer bespoke adapter
// (itemized extra features + live permits + code cases). Permits/code for the
// statewide set remain portal-link guidance (no uniform public API) — the
// adapter states this explicitly so we never imply a live permit pull.
//
// Top-10 FL counties by population + Monroe (the Keys — core to Palma's market).
const STATEWIDE_TIER_A: string[] = [
  'broward',       // FDOR 16
  'palm-beach',    // FDOR 60
  'hillsborough',  // FDOR 39
  'orange',        // FDOR 58
  'pinellas',      // FDOR 62
  'duval',         // FDOR 26
  'lee',           // FDOR 46
  'polk',          // FDOR 63
  'brevard',       // FDOR 15
  'monroe',        // FDOR 54
];

// Per-county records guidance folded into the report notes so the reader knows
// exactly where to confirm permits and code cases for that jurisdiction.
const STATEWIDE_GUIDANCE: Record<string, string[]> = {
  'broward': [
    'Permits: most Broward work is permitted by the CITY — check the municipality’s portal first; Broward County ePermits (broward.org/building) covers unincorporated areas.',
    'Code cases: broward.org/CodeEnforcement, plus the city code office for incorporated addresses.',
  ],
  'palm-beach': [
    'Permits: PBC ePZB (discover.pbcgov.org/pzb/building) for unincorporated areas; incorporated cities use their own permit portals.',
    'Code cases: discover.pbcgov.org/pzb (Code Enforcement).',
  ],
  'hillsborough': [
    'Permits: unincorporated work via Hillsborough County Accela Citizen Access; City of Tampa, Temple Terrace, and Plant City permit on their own portals.',
    'Code cases: HCFL.gov Code Enforcement for unincorporated; city code office otherwise.',
  ],
  'orange': [
    'Permits: Orange County Fast Track (fasttrack.ocfl.net) for unincorporated; City of Orlando permits via its own portal.',
    'Code cases: Orange County Code Enforcement; City of Orlando has a separate office.',
  ],
  'pinellas': [
    'Permits: unincorporated via the Pinellas County Access portal; St. Petersburg, Clearwater, and Largo permit on their own systems.',
    'Code cases: Pinellas County Code Enforcement; city code office for incorporated addresses.',
  ],
  'duval': [
    'Permits: Jacksonville is consolidated — use the City of Jacksonville permitting portal for the whole county.',
    'Code cases: City of Jacksonville Municipal Code Compliance.',
  ],
  'lee': [
    'Permits: Lee County (leegov.com) for unincorporated; Cape Coral, Fort Myers, Bonita Springs, and Estero permit on their own portals.',
    'Code cases: Lee County Code Enforcement; city code office for incorporated addresses.',
  ],
  'polk': [
    'Permits: Polk County Building Division for unincorporated; Lakeland, Winter Haven, and other cities permit separately.',
    'Code cases: Polk County Code Enforcement; city code office otherwise.',
  ],
  'brevard': [
    'Permits: Brevard County (brevardfl.gov) for unincorporated; Melbourne, Palm Bay, Titusville, and Cocoa permit on their own portals.',
    'Code cases: Brevard County Code Enforcement; city code office for incorporated addresses.',
  ],
  'monroe': [
    'Permits: Monroe County (monroecounty-fl.gov) covers the unincorporated Keys; Key West, Marathon, Islamorada, Layton, and Key Colony Beach each permit their own areas.',
    'Code cases: Monroe County Code Compliance; the city code office for incorporated Keys municipalities.',
    'Note: much of the Keys sits in a FEMA Special Flood Hazard Area and the countywide HVHZ wind zone — elevation and wind-load compliance are common permit triggers here.',
  ],
};

const TIER_A_ADAPTERS: Record<string, CountyAdapter> = {
  'miami-dade': miamiDadeAdapter,
};

// Register each statewide Tier-A county from the directory.
for (const key of STATEWIDE_TIER_A) {
  const dir = FL_COUNTY_DIRECTORY[key];
  if (dir) {
    TIER_A_ADAPTERS[key] = buildStatewideAdapter(dir, STATEWIDE_GUIDANCE[key] ?? []);
  }
}

// Remaining priority counties (none right now) can still get richer Tier-B
// guidance via the enhanced-links adapter. Kept for future counties that have
// good portal guidance but aren't yet on the statewide roll adapter.
const ENHANCED_B_GUIDANCE: Record<string, string[]> = {};

export function getCountyAdapter(countyKey: string | null): CountyAdapter | null {
  if (!countyKey) return null;
  const tierA = TIER_A_ADAPTERS[countyKey];
  if (tierA) return tierA;
  const dir = getCountyDirectoryEntry(countyKey);
  if (!dir) return null;
  const guidance = ENHANCED_B_GUIDANCE[countyKey];
  if (guidance) return buildEnhancedLinksAdapter(dir, guidance);
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
          ? countyKey === 'miami-dade'
            ? `Live data active for ${dir.name}: property/appraiser records, permits, and code cases.`
            : `Live property/appraiser records and recent sales active for ${dir.name} (FL DOR certified roll). Permits and code cases are surfaced as county portal links for manual confirmation.`
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
