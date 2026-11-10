// GENERATED FILE - DO NOT EDIT BY HAND.
//
// Source: worker/src/scrapers/jurisdictions.ts (CITY_JURISDICTIONS)
// Regenerate: npm run gen:coverage
//
// Every city the deep scan can read, flattened so the Next.js build does not
// have to resolve worker modules (it cannot - see scripts/gen-city-code-coverage.ts).
//
// tests/city-adapters-reachable.test.ts rebuilds this from the registry and
// fails if the two have drifted, so editing this file by hand or forgetting to
// regenerate it breaks CI rather than quietly misinforming a reader.

export interface CityCoverageRow {
  /** "${county key}:${MUNICIPALITY}", as the registry keys it. */
  key: string;
  name: string;
  platform: string;
  portalUrl: string | null;
}

export const CITY_CODE_COVERAGE: CityCoverageRow[] = [
  {
    "key": "broward:COOPER CITY",
    "name": "Cooper City",
    "platform": "accela",
    "portalUrl": "https://aca-prod.accela.com/COOPER/Cap/CapHome.aspx?module=Enforcement&TabName=Enforcement"
  },
  {
    "key": "broward:FORT LAUDERDALE",
    "name": "City of Fort Lauderdale",
    "platform": "accela",
    "portalUrl": "https://aca-prod.accela.com/FTL/Cap/CapHome.aspx?module=Enforcement&TabName=Enforcement"
  },
  {
    "key": "broward:HOLLYWOOD",
    "name": "City of Hollywood",
    "platform": "accela",
    "portalUrl": "https://aca-prod.accela.com/HOLLYWOOD/Cap/CapHome.aspx?module=Enforcement&TabName=Enforcement"
  },
  {
    "key": "broward:MIRAMAR",
    "name": "City of Miramar",
    "platform": "energov",
    "portalUrl": "https://miramarfl-energovweb.tylerhost.net/apps/SelfService#/search"
  },
  {
    "key": "broward:OAKLAND PARK",
    "name": "City of Oakland Park",
    "platform": "energov",
    "portalUrl": "https://oaklandparkfl-energovweb.tylerhost.net/apps/SelfService#/search"
  },
  {
    "key": "broward:PEMBROKE PINES",
    "name": "City of Pembroke Pines",
    "platform": "energov",
    "portalUrl": "https://pembrokepinesfl-energovweb.tylerhost.net/apps/SelfService#/search"
  },
  {
    "key": "broward:WEST PARK",
    "name": "City of West Park",
    "platform": "citizenserve",
    "portalUrl": "https://www.citizenserve.com/Portal/PortalController?Action=showSearchPage&ctzPagePrefix=Portal_&installationID=261"
  },
  {
    "key": "hillsborough:TAMPA",
    "name": "City of Tampa",
    "platform": "accela",
    "portalUrl": "https://aca-prod.accela.com/TAMPA/Cap/CapHome.aspx?module=Enforcement&TabName=Enforcement"
  },
  {
    "key": "lake:MONTVERDE",
    "name": "City of Montverde",
    "platform": "citizenserve",
    "portalUrl": "https://www.citizenserve.com/Portal/PortalController?Action=showSearchPage&ctzPagePrefix=Portal_&installationID=401"
  },
  {
    "key": "manatee:BRADENTON",
    "name": "City of Bradenton",
    "platform": "accela",
    "portalUrl": "https://aca-prod.accela.com/BRADENTON/Cap/CapHome.aspx?module=Enforcement&TabName=Enforcement"
  },
  {
    "key": "manatee:BRADENTON BEACH",
    "name": "City of Bradenton Beach",
    "platform": "citizenserve",
    "portalUrl": "https://www.citizenserve.com/Portal/PortalController?Action=showSearchPage&ctzPagePrefix=Portal_&installationID=237"
  },
  {
    "key": "manatee:LONGBOAT KEY",
    "name": "Town of Longboat Key",
    "platform": "accela",
    "portalUrl": "https://aca-prod.accela.com/LONGBOAT/Cap/CapHome.aspx?module=Enforcement&TabName=Enforcement"
  },
  {
    "key": "miami-dade:CORAL GABLES",
    "name": "City of Coral Gables",
    "platform": "energov",
    "portalUrl": "https://coralgablesfl-energovpub.tylerhost.net/apps/selfservice#/search"
  },
  {
    "key": "miami-dade:DORAL",
    "name": "City of Doral",
    "platform": "energov",
    "portalUrl": "https://doralfl-energovweb.tylerhost.net/apps/selfservice#/search"
  },
  {
    "key": "miami-dade:HIALEAH",
    "name": "City of Hialeah",
    "platform": "energov",
    "portalUrl": "https://hialeahfl-energovpub.tylerhost.net/apps/selfservice#/search"
  },
  {
    "key": "miami-dade:MIAMI BEACH",
    "name": "City of Miami Beach",
    "platform": "energov",
    "portalUrl": "https://energovcss.miamibeachfl.gov/energovprod/selfservice#/search"
  },
  {
    "key": "miami-dade:MIAMI GARDENS",
    "name": "City of Miami Gardens",
    "platform": "energov",
    "portalUrl": "https://miamigardensfl-energovpub.tylerhost.net/apps/selfservice#/search"
  },
  {
    "key": "miami-dade:NORTH BAY VILLAGE",
    "name": "City of North Bay Village",
    "platform": "energov",
    "portalUrl": "https://northbayvillagefl-energovpub.tylerhost.net/apps/selfservice#/search"
  },
  {
    "key": "miami-dade:SURFSIDE",
    "name": "City of Surfside",
    "platform": "energov",
    "portalUrl": "https://surfsidefl-energovpub.tylerhost.net/apps/selfservice#/search"
  },
  {
    "key": "monroe:KEY COLONY BEACH",
    "name": "City of Key Colony Beach",
    "platform": "citizenserve",
    "portalUrl": "https://www.citizenserve.com/Portal/PortalController?Action=showSearchPage&ctzPagePrefix=Portal_&installationID=326"
  },
  {
    "key": "palm-beach:BOCA RATON",
    "name": "City of Boca Raton",
    "platform": "energov",
    "portalUrl": "https://bocaratonfl-energovpub.tylerhost.net/apps/selfservice#/search"
  },
  {
    "key": "palm-beach:PALM BEACH GARDENS",
    "name": "City of Palm Beach Gardens",
    "platform": "energov",
    "portalUrl": "https://palmbeachgardensfl-energovweb.tylerhost.net/apps/SelfService#/search"
  },
  {
    "key": "palm-beach:RIVIERA BEACH",
    "name": "City of Riviera Beach",
    "platform": "energov",
    "portalUrl": "https://rivierabeachfl-energovweb.tylerhost.net/apps/SelfService#/search"
  },
  {
    "key": "palm-beach:WELLINGTON",
    "name": "City of Wellington",
    "platform": "energov",
    "portalUrl": "https://wellingtonfl-energovweb.tylerhost.net/apps/SelfService#/search"
  },
  {
    "key": "palm-beach:WEST PALM BEACH",
    "name": "City of West Palm Beach",
    "platform": "energov",
    "portalUrl": "https://westpalmbeachfl-energovpub.tylerhost.net/apps/selfservice#/search"
  },
  {
    "key": "pasco:ZEPHYRHILLS",
    "name": "City of Zephyrhills",
    "platform": "energov",
    "portalUrl": "https://zephyrhillsfl-energovweb.tylerhost.net/apps/SelfService#/search"
  },
  {
    "key": "pinellas:SEMINOLE",
    "name": "City of Seminole",
    "platform": "citizenserve",
    "portalUrl": "https://www.citizenserve.com/Portal/PortalController?Action=showSearchPage&ctzPagePrefix=Portal_&installationID=441"
  },
  {
    "key": "pinellas:SOUTH PASADENA",
    "name": "City of South Pasadena",
    "platform": "energov",
    "portalUrl": "https://southpasadenafl-energovweb.tylerhost.net/apps/SelfService#/search"
  },
  {
    "key": "polk:MULBERRY",
    "name": "City of Mulberry",
    "platform": "accela",
    "portalUrl": "https://aca-prod.accela.com/MULBERRY/Cap/CapHome.aspx?module=Enforcement&TabName=Enforcement"
  },
  {
    "key": "sarasota:LONGBOAT KEY",
    "name": "Town of Longboat Key",
    "platform": "accela",
    "portalUrl": "https://aca-prod.accela.com/LONGBOAT/Cap/CapHome.aspx?module=Enforcement&TabName=Enforcement"
  },
  {
    "key": "sarasota:NORTH PORT",
    "name": "City of North Port",
    "platform": "accela",
    "portalUrl": "https://aca-prod.accela.com/NORTHPORT/Cap/CapHome.aspx?module=Code&TabName=Code"
  },
  {
    "key": "seminole:CASSELBERRY",
    "name": "City of Casselberry",
    "platform": "citizenserve",
    "portalUrl": "https://www.citizenserve.com/Portal/PortalController?Action=showSearchPage&ctzPagePrefix=Portal_&installationID=221"
  },
  {
    "key": "st-lucie:FORT PIERCE",
    "name": "City of Fort Pierce",
    "platform": "energov",
    "portalUrl": "https://fortpiercefl-energovweb.tylerhost.net/apps/SelfService#/search"
  },
  {
    "key": "volusia:DELTONA",
    "name": "City of Deltona",
    "platform": "energov",
    "portalUrl": "https://deltonafl-energovweb.tylerhost.net/apps/SelfService#/search"
  },
  {
    "key": "volusia:NEW SMYRNA BEACH",
    "name": "City of New Smyrna Beach",
    "platform": "energov",
    "portalUrl": "https://newsmyrnabeachfl-energovweb.tylerhost.net/apps/SelfService#/search"
  },
  {
    "key": "volusia:ORMOND BEACH",
    "name": "City of Ormond Beach",
    "platform": "energov",
    "portalUrl": "https://ormondbeachfl-energovweb.tylerhost.net/apps/SelfService#/search"
  }
];
