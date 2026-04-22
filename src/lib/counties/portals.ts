// Static directory of Florida county-level portal URLs.
//
// The goal is statewide coverage: even when we don't scrape a given county,
// we can always point the realtor to the right county Property Appraiser + the
// right building / permit / code-enforcement portal.
//
// For counties where the building department is largely city-level (the norm
// in FL), we point to the COUNTY building department portal where one exists;
// otherwise we leave it null and the UI says "check the city's portal."
//
// URLs were gathered from each county's official site. Where a county uses a
// search landing page, we prefer that over the root domain.

import type { CountyPortalLinks, CountyTier } from '../types';

export interface CountyDirectoryEntry extends CountyPortalLinks {
  slug: string;
  name: string;
  tier: CountyTier;
}

// Helper to keep each row terse
function row(
  slug: string,
  name: string,
  pa: string | null,
  bd: string | null,
  ce: string | null = null,
  ha: string | null = null,
  tier: CountyTier = 'B',
): CountyDirectoryEntry {
  return {
    slug,
    name,
    tier,
    propertyAppraiser: pa,
    buildingDept: bd,
    codeEnforcement: ce,
    historicalAerial: ha,
  };
}

// NOTE — this list is authoritative for the app. 67 counties. Slugs are
// lowercase-hyphenated to match what the Google Geocoder returns for
// administrative_area_level_2 minus the " County" suffix.
export const FL_COUNTY_DIRECTORY: Record<string, CountyDirectoryEntry> = {
  'alachua': row(
    'fl-alachua', 'Alachua County',
    'https://www.acpafl.org/',
    'https://growth-management.alachuacounty.us/building',
  ),
  'baker': row(
    'fl-baker', 'Baker County',
    'https://www.bakerpa.com/',
    'https://www.bakercountyfl.org/building',
  ),
  'bay': row(
    'fl-bay', 'Bay County',
    'https://www.baypa.net/',
    'https://www.baycountyfl.gov/260/Building-Services',
  ),
  'bradford': row(
    'fl-bradford', 'Bradford County',
    'https://www.bradfordappraiser.com/',
    'https://www.bradfordcountyfl.gov/building-department/',
  ),
  'brevard': row(
    'fl-brevard', 'Brevard County',
    'https://www.bcpao.us/',
    'https://www.brevardfl.gov/BuildingDepartment',
    null, null,
    'A',
  ),
  'broward': row(
    'fl-broward', 'Broward County',
    'https://www.bcpa.net/',
    'https://www.broward.org/building',
    'https://www.broward.org/CodeEnforcement',
    null,
    'A',
  ),
  'calhoun': row(
    'fl-calhoun', 'Calhoun County',
    'https://calhounpa.net/',
    'https://www.calhouncountygov.com/building-and-zoning/',
  ),
  'charlotte': row(
    'fl-charlotte', 'Charlotte County',
    'https://www.ccappraiser.com/',
    'https://www.charlottecountyfl.gov/departments/communitydevelopment/building/',
  ),
  'citrus': row(
    'fl-citrus', 'Citrus County',
    'https://www.citruspa.org/',
    'https://www.bocc.citrus.fl.us/building/',
  ),
  'clay': row(
    'fl-clay', 'Clay County',
    'https://www.ccpao.com/',
    'https://www.claycountygov.com/departments/building',
  ),
  'collier': row(
    'fl-collier', 'Collier County',
    'https://www.collierappraiser.com/',
    'https://www.colliercountyfl.gov/your-government/divisions-f-r/operations-regulatory-management/building-review-and-permitting',
    null, null,
    'A',
  ),
  'columbia': row(
    'fl-columbia', 'Columbia County',
    'https://www.columbiapa.com/',
    'https://columbiacountyfla.com/Building.aspx',
  ),
  'desoto': row(
    'fl-desoto', 'DeSoto County',
    'https://www.desotopa.com/',
    'https://www.desotobocc.com/page/building-zoning',
  ),
  'dixie': row(
    'fl-dixie', 'Dixie County',
    'https://www.dixiepa.com/',
    'https://www.dixie.fl.gov/building-department',
  ),
  'duval': row(
    'fl-duval', 'Duval County',
    'https://paopropertysearch.coj.net/Basic/Search.aspx',
    'https://www.coj.net/departments/planning-and-development/building-inspection-division',
    null, null,
    'A',
  ),
  'escambia': row(
    'fl-escambia', 'Escambia County',
    'https://www.escpa.org/',
    'https://myescambia.com/our-services/development-services/building-services',
  ),
  'flagler': row(
    'fl-flagler', 'Flagler County',
    'https://flaglerpa.com/',
    'https://www.flaglercounty.gov/government/county-departments/general-services/building-department',
  ),
  'franklin': row(
    'fl-franklin', 'Franklin County',
    'https://franklincountypa.net/',
    'https://franklincountyflorida.com/planning-and-building/',
  ),
  'gadsden': row(
    'fl-gadsden', 'Gadsden County',
    'https://qpublic.schneidercorp.com/Application.aspx?AppID=907',
    'https://www.gadsdengov.net/departments/building-and-code-enforcement',
  ),
  'gilchrist': row(
    'fl-gilchrist', 'Gilchrist County',
    'https://www.gilchristpa.com/',
    'https://www.gilchrist.fl.us/departments/building-zoning',
  ),
  'glades': row(
    'fl-glades', 'Glades County',
    'https://gladespa.com/',
    'https://www.myglades.com/departments/building-zoning',
  ),
  'gulf': row(
    'fl-gulf', 'Gulf County',
    'https://www.gulfpa.com/',
    'https://gulfcounty-fl.gov/building-department/',
  ),
  'hamilton': row(
    'fl-hamilton', 'Hamilton County',
    'https://www.hamiltonpa.com/',
    'https://www.hamiltoncountyflorida.com/Development.asp',
  ),
  'hardee': row(
    'fl-hardee', 'Hardee County',
    'https://hardeepa.com/',
    'https://www.hardeecounty.net/our-departments/building-development',
  ),
  'hendry': row(
    'fl-hendry', 'Hendry County',
    'https://www.hendryprop.com/',
    'https://www.hendryfla.net/231/Building-Permits',
  ),
  'hernando': row(
    'fl-hernando', 'Hernando County',
    'https://www.hernandopa-fl.us/',
    'https://www.hernandocounty.us/departments/departments-a-e/building-division',
  ),
  'highlands': row(
    'fl-highlands', 'Highlands County',
    'https://www.appraiser.co.highlands.fl.us/',
    'https://www.hcbcc.net/departments/development-services/building',
  ),
  'hillsborough': row(
    'fl-hillsborough', 'Hillsborough County',
    'https://www.hcpafl.org/',
    'https://www.hillsboroughcounty.org/en/residents/property-owners-and-renters/building-construction',
    null, null,
    'A',
  ),
  'holmes': row(
    'fl-holmes', 'Holmes County',
    'https://www.holmespa.com/',
    'https://www.holmescountyonline.com/building-department.html',
  ),
  'indian-river': row(
    'fl-indian-river', 'Indian River County',
    'https://www.ircpa.org/',
    'https://www.ircgov.com/building',
  ),
  'jackson': row(
    'fl-jackson', 'Jackson County',
    'https://www.jacksoncountypa.com/',
    'https://www.jacksoncountyfl.gov/departments/planning-and-zoning',
  ),
  'jefferson': row(
    'fl-jefferson', 'Jefferson County',
    'https://www.jeffersonpa.net/',
    'https://www.jeffersoncountyfl.gov/home/departments/building_and_zoning/index.php',
  ),
  'lafayette': row(
    'fl-lafayette', 'Lafayette County',
    'https://www.lafayettepa.com/',
    'https://www.lafayettecountyflorida.com/',
  ),
  'lake': row(
    'fl-lake', 'Lake County',
    'https://www.lakecopropappr.com/',
    'https://www.lakecountyfl.gov/departments/planning-and-zoning',
  ),
  'lee': row(
    'fl-lee', 'Lee County',
    'https://www.leepa.org/',
    'https://www.leegov.com/dcd/permitting',
    null, null,
    'A',
  ),
  'leon': row(
    'fl-leon', 'Leon County',
    'https://www.leonpa.gov/',
    'https://cms.leoncountyfl.gov/des/',
  ),
  'levy': row(
    'fl-levy', 'Levy County',
    'https://www.levypa.com/',
    'https://www.levycounty.org/building.aspx',
  ),
  'liberty': row(
    'fl-liberty', 'Liberty County',
    'https://www.libertypa.org/',
    'https://libertycountyflorida.com/',
  ),
  'madison': row(
    'fl-madison', 'Madison County',
    'https://madisonpa.com/',
    'https://www.madisoncountyfl.com/department-building-zoning',
  ),
  'manatee': row(
    'fl-manatee', 'Manatee County',
    'https://www.manateepao.gov/',
    'https://www.mymanatee.org/departments/building___development_services',
  ),
  'marion': row(
    'fl-marion', 'Marion County',
    'https://www.pa.marion.fl.us/',
    'https://www.marionfl.org/agencies-departments/departments-offices/building-safety',
  ),
  'martin': row(
    'fl-martin', 'Martin County',
    'https://www.pa.martin.fl.us/',
    'https://www.martin.fl.us/building',
  ),
  'miami-dade': row(
    'fl-miami-dade', 'Miami-Dade County',
    'https://www.miamidade.gov/pa/property_search.asp',
    'https://www.miamidade.gov/permits/',
    'https://www.miamidade.gov/global/service.page?Mduid_service=ser1468521624577396',
    'https://gisweb.miamidade.gov/PropertySearch/',
    'A',
  ),
  'monroe': row(
    'fl-monroe', 'Monroe County',
    'https://www.mcpafl.org/',
    'https://www.monroecounty-fl.gov/164/Building-Department',
    null, null,
    'A',
  ),
  'nassau': row(
    'fl-nassau', 'Nassau County',
    'https://www.nassauflpa.com/',
    'https://www.nassaucountyfl.com/1027/Building',
  ),
  'okaloosa': row(
    'fl-okaloosa', 'Okaloosa County',
    'https://www.okaloosapa.com/',
    'https://myokaloosa.com/gm/building-inspections',
  ),
  'okeechobee': row(
    'fl-okeechobee', 'Okeechobee County',
    'https://www.okeechobeepa.com/',
    'https://www.co.okeechobee.fl.us/building-general-services',
  ),
  'orange': row(
    'fl-orange', 'Orange County',
    'https://www.ocpafl.org/',
    'https://www.orangecountyfl.net/PermitsLicenses.aspx',
    null, null,
    'A',
  ),
  'osceola': row(
    'fl-osceola', 'Osceola County',
    'https://www.property-appraiser.org/',
    'https://www.osceola.org/agencies-departments/community-development/building-department/',
  ),
  'palm-beach': row(
    'fl-palm-beach', 'Palm Beach County',
    'https://www.pbcpao.gov/',
    'https://discover.pbcgov.org/pzb/building/',
    'https://discover.pbcgov.org/pzb/Pages/CE.aspx',
    null,
    'A',
  ),
  'pasco': row(
    'fl-pasco', 'Pasco County',
    'https://www.pascopa.com/',
    'https://www.pascocountyfl.net/185/Building-Construction-Services',
  ),
  'pinellas': row(
    'fl-pinellas', 'Pinellas County',
    'https://www.pcpao.gov/',
    'https://www.pinellas.gov/buildingpermits/',
    null, null,
    'A',
  ),
  'polk': row(
    'fl-polk', 'Polk County',
    'https://www.polkpa.org/',
    'https://www.polk-county.net/building',
  ),
  'putnam': row(
    'fl-putnam', 'Putnam County',
    'https://www.putnam-fl.com/pa/',
    'https://www.putnam-fl.com/bz/',
  ),
  'st-johns': row(
    'fl-st-johns', 'St. Johns County',
    'https://www.sjcpa.us/',
    'https://www.sjcfl.us/department/building-services/',
  ),
  'st-lucie': row(
    'fl-st-lucie', 'St. Lucie County',
    'https://www.paslc.gov/',
    'https://www.stlucieco.gov/departments-services/building-code-regulation',
  ),
  'santa-rosa': row(
    'fl-santa-rosa', 'Santa Rosa County',
    'https://www.srcpa.gov/',
    'https://www.santarosa.fl.gov/187/Building-Inspections',
  ),
  'sarasota': row(
    'fl-sarasota', 'Sarasota County',
    'https://www.sc-pa.com/',
    'https://www.scgov.net/government/planning-and-development-services/building',
    null, null,
    'A',
  ),
  'seminole': row(
    'fl-seminole', 'Seminole County',
    'https://scpafl.org/',
    'https://www.seminolecountyfl.gov/departments-services/development-services/building/',
  ),
  'sumter': row(
    'fl-sumter', 'Sumter County',
    'https://www.sumterpa.com/',
    'https://www.sumtercountyfl.gov/229/Building-Services',
  ),
  'suwannee': row(
    'fl-suwannee', 'Suwannee County',
    'https://suwanneepa.com/',
    'https://www.suwcounty.org/bozi',
  ),
  'taylor': row(
    'fl-taylor', 'Taylor County',
    'https://taylorpa.com/',
    'https://www.taylorcountygov.com/building-department',
  ),
  'union': row(
    'fl-union', 'Union County',
    'https://unioncountypa.com/',
    'https://www.unioncountyfl.com/',
  ),
  'volusia': row(
    'fl-volusia', 'Volusia County',
    'https://vcpa.vcgov.org/',
    'https://www.volusia.org/services/growth-and-resource-management/building-and-zoning/',
  ),
  'wakulla': row(
    'fl-wakulla', 'Wakulla County',
    'https://www.mywakullapa.com/',
    'https://www.mywakulla.com/departments/planning_community_development/',
  ),
  'walton': row(
    'fl-walton', 'Walton County',
    'https://www.waltonpa.com/',
    'https://www.co.walton.fl.us/167/Building-Department',
  ),
  'washington': row(
    'fl-washington', 'Washington County',
    'https://www.washingtonflpa.com/',
    'https://www.washingtonfl.com/departments/building_department/index.php',
  ),
};

// Normalize a county string from any source (geocoder, user input) into a key
// for the directory. Accepts "Miami-Dade", "Miami-Dade County", "Saint Johns",
// "St. Johns", etc.
export function normalizeCountyKey(input: string): string | null {
  if (!input) return null;
  const s = input
    .toLowerCase()
    .replace(/\bcounty\b/g, '')
    .replace(/\bsaint\b/g, 'st')
    .replace(/\./g, '')
    .replace(/[^a-z0-9-\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (FL_COUNTY_DIRECTORY[s]) return s;
  // Loose prefix match (e.g. "st johns" → "st-johns")
  const compact = s.replace(/-/g, '');
  for (const k of Object.keys(FL_COUNTY_DIRECTORY)) {
    if (k.replace(/-/g, '') === compact) return k;
  }
  return null;
}

export function getCountyDirectoryEntry(key: string): CountyDirectoryEntry | null {
  return FL_COUNTY_DIRECTORY[key] ?? null;
}
