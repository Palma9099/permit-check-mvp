# Florida permit-platform map, enumerated 2026-11-08, extended 2026-11-09

## Why this exists

The statewide lien survey (`lien-source-survey-2026-11-08.md`) found that almost no
Florida government publishes code-enforcement or permit data to GIS. It lives in
vendor permitting platforms. Accela is the largest, and its API states it supports
anonymous public access:

> `GET https://apis.accela.com/v4/agencies` with no credentials returns:
> "App ID or access token is required... Please set App ID to request HTTP header
> `x-accela-appid` for anonymous access"

So one adapter plus one registered App ID could reach every Accela agency that
enables public search, instead of one scraper per city. This document sizes that,
and maps what the non-Accela jurisdictions run instead.

## Confirmed Florida Accela agencies (27)

`https://aca-prod.accela.com/<CODE>/Default.aspx`. County agencies cover the whole
county; city agencies cover only that city. Population is 2020 Census (POP100).

| Code | Jurisdiction | Level | 2020 pop | How identity was confirmed |
|---|---|---|---|---|
| HCFL | Hillsborough County | county | 1,459,762 | body text "Hillsborough" + "Florida"; county guide links HCFL |
| PINELLAS | Pinellas County | county | 959,107 | `pinellas.gov` + 727 area code |
| LEECO | Lee County | county | 760,822 | `fl-leecounty.civicplus.com` + 239 |
| POLKCO | Polk County | county | 725,046 | page title "Polk County Citizen Access" |
| BREVARD | Brevard County | county | 606,612 | `sites.brevardcounty.us` + 321 |
| PASCO | Pasco County | county | 561,891 | page title "Pasco County" |
| SARASOTACO | Sarasota County | county | 434,006 | 941 + `scgov.net` links the portal |
| MANATEE | Manatee County | county | 399,710 | body text + Accela press release (Manatee Co FL) |
| OSCEOLA | Osceola County | county | 388,656 | 407 |
| TAMPA | City of Tampa | city | 384,959 | "City of Tampa Production ACA" |
| LEONCO | Leon County | county | 292,198 | title "Leon County Permits Online"; `leoncountyfl.gov` form |
| BOCC | Charlotte County | county | 186,847 | `charlottecountyfl.gov` |
| FTL | Fort Lauderdale | city | 182,760 | "Fort Lauderdale Portal"; branded LauderBuild |
| MARTINCO | Martin County | county | 158,431 | "Florida" in body |
| CITRUS | Citrus County | county | 153,843 | body text + Accela press release (Citrus Co FL) |
| HOLLYWOOD | City of Hollywood | city | 153,067 | "City of Hollywood" |
| CLEARWATER | City of Clearwater | city | 117,292 | "City of Clearwater ePermitting System" |
| NASSAU | Nassau County | county | 90,352 | 904 |
| NORTHPORT | City of North Port | city | 74,793 | "City of North Port" + FL 34286 |
| WESTON | City of Weston | city | 68,107 | "City of Weston" |
| BRADENTON | Bradenton | city | 55,698 | 941 + city site confirms Accela |
| DELAND | DeLand | city | 37,351 | 386 |
| COOPER | Cooper City | city | 34,401 | `broward.org` |
| WINTER | Winter Park | city | 29,795 | `wpgov.com` |
| KEYBISCAYNE | Village of Key Biscayne | city | 14,809 | "Village of Key Biscayne" + Florida |
| LONGBOAT | Town of Longboat Key | city | 7,505 | "Town of Longboat Key Citizen Portal" |
| MULBERRY | Mulberry | city | 3,952 | 863 |

**27 agencies, 8,341,772 residents, 38.7% of Florida.**

### Self-hosted Accela (1 confirmed)

Not every Accela agency is on `aca-prod`. Some self-host, and no amount of probing
`aca-prod` will ever find them.

| Host | Jurisdiction | 2020 pop | Evidence |
|---|---|---|---|
| `aca.plantation.org/CitizenAccess` | City of Plantation (Broward) | 91,750 | title "Plantation E-Permit Online Portal" + Florida |

With Plantation: **39.2% of Florida**. There is no uniform hostname pattern for
self-hosted instances (`aca.<domain>/CitizenAccess` was tried against nine other
Florida governments and resolved for none), so this tier has to be found per city.

## Not confirmed, deliberately excluded from the totals

| Code | Shows | Why not counted |
|---|---|---|
| LAKECO | "Lake County CommunityDevelopment" | Lake County exists in ~12 states; no FL domain, area code or zip on the page |
| SEMINOLECO | "SEMINOLE" | Seminole County exists in FL, OK and GA. A news report says Seminole County FL launched an Accela portal 2026-10-19, which is suggestive, not proof this code is it |
| BCC | nothing | No name, domain, phone or branding on the page |

If LAKECO and SEMINOLECO confirm, coverage reaches **43.1%**.

## Rejected, with reasons

`aca-prod.accela.com` is Accela's **national** multi-tenant host. A 200 proves an
agency exists, not that it is in Florida. Florida place names collide heavily.

| Code | Actually |
|---|---|
| CHARLOTTE | Charlotte, **North Carolina** (`charlottenc.gov`). Charlotte County FL is `BOCC` |
| CAPECO | Cape May County, **New Jersey** (`CapeMayCountyNJ.gov`, 609) — not Cape Coral |
| OAKLANDCO | Oakland County, **Michigan** (248) |
| COF | City of Fremont, **California** |
| COR | City of Roseville, **California** |
| BOCO | Boulder County, **Colorado** |
| SBCO | Santa Barbara County, **California** (`countyofsb.org`) |
| COSPRINGS | Colorado Springs, CO |
| HILLSBORO | Hillsboro, Oregon |
| MADISON | City of Madison, Wisconsin |
| GOLDEN | City of Golden, Colorado |
| FRANKLIN | Village of Franklin Park, Illinois |
| DAYTON | Dayton, Ohio |
| POL | State of Montana |
| OAKLAND | "Oakland Online Portal", state unresolved |
| HAINES, HAMILTONCOUNTY, LACO, PGCO, SDCO | all return "City of Metropolis", Accela's **demo tenant** |

### One claim that was asserted and is false

A commercial permit-data site states that Palm Beach County publishes its permit
search at `https://aca-prod.accela.com/PBCGOV/Default.aspx` "running on Accela
Citizen Access". It does not. `PBCGOV`, `PBC`, `PALMBEACH` and `PBCFL` all return
HTTP 404 "The resource cannot be found." Palm Beach County runs its own **ePZB**
system. Aggregator coverage pages are marketing, not sources.

## What the non-Accela jurisdictions run

The "about five vendors" estimate was too tidy. The real picture includes several
homegrown systems at the largest jurisdictions, which no vendor adapter will reach.

| Jurisdiction | 2020 pop | Platform | Note |
|---|---|---|---|
| Miami-Dade County | 2,701,767 | county-run | already integrated live |
| Palm Beach County | 1,492,191 | **ePZB** (homegrown) | publishes a *certified* Fine/Lien, Open Permit and Code Compliance Open Violation search, public, by address or property control number, for unincorporated PBC. Highest-value single target found in this sweep. |
| Orange County | 1,429,908 | **Fast Track** (`fasttrack.ocfl.net`) | public, no account needed, **but search forms carry a CAPTCHA**, which is a hard stop: bypassing bot checks is out of scope, so this needs an official data request |
| Duval / Jacksonville | 995,567 | **JaxEPICS** (`jaxepics.coj.net`) | public search covers permits, property, citations **and violations** |
| Collier County | 375,752 | **CityView** (`cvportal.collier.gov`) | returned HTTP 406 to a plain request; county warns much permit data is not current |
| Jupiter, Wellington, Riviera Beach, Lake Park | — | Tyler EnerGov Self Service | unverified, from a third-party guide |
| Royal Palm Beach | — | Click2Gov | unverified |
| City of Orlando | 307,573 | OpenGov or BS&A | sources conflict; unverified |
| Pompano Beach | 112,046 | Click2Gov (`c2g.pompanobeachfl.gov`) | unverified |
| Miami Beach | 82,890 | Civic Access / CSS | unverified |

## Method, and what limits it

Two instruments were used, and one clearly beat the other.

**Brute-force probing.** 2,009 candidate codes in round one from the 411 Census
incorporated places plus 67 counties; 5,880 more in round two after the search
sweep revealed two new code patterns (`BOCC` = Board of County Commissioners, and
county-initials + `FL` = `HCFL`). The discriminator is clean and was validated
first: `FTL` 200/14,908 bytes, `HOLLYWOOD` 200/64,529, `MIAMIDADE` 404/1,933,
`ZZQQXNOTREAL` 404/1,936.

**Round two found zero new Florida agencies.** Its only Florida hits, `BOCC` and
`HCFL`, were already known from the search sweep, and its other eleven hits were
all out of state or demo tenants. Name-pattern brute force is saturated.

**Search-engine sweep.** Found `BOCC` and `HCFL`, which round one could not guess,
and resolved five of the six previously-unconfirmed identities. This is now the
better instrument, and the remaining unfound agencies are most likely ones whose
code has no relationship to the jurisdiction name.

Accela offers no index to enumerate against: `/v4/agencies` needs a real App ID (a
fabricated one returns HTTP 500), and the host has no `robots.txt`, no `sitemap.xml`
and no root listing.

### Limits, stated plainly

1. **27 is a floor, not a census.** Round one never generated `FTL`, a known-good
   agency. Codes unrelated to jurisdiction names are invisible to pattern probing,
   and `BOCC` proves such codes exist.
2. **A live portal does not prove usable data.** HTTP 200 proves the agency runs
   Citizen Access. Public search access varies per agency and must be checked one
   by one: Clearwater states "You do NOT have to be a registered user to perform
   searches", and Brevard states non-registered users can search "building,
   development, and **enforcement** records" — but Sarasota County states an
   account is required to search at all.
3. The same reject rule as the GIS survey still applies to every agency: a stale or
   blank status field reads as "nothing open", which is the one answer this product
   must never get wrong.

## What this changes

Three jurisdictions rejected in the GIS survey are reachable here. **Tampa** was
rejected for an empty GIS folder, **Pinellas County** for a permit layer with no
status field, and **Hillsborough County** for a status column that copies the permit
number on 43k rows. All three run Accela. The data existed the whole time; it just
was not in GIS.

## Next, in order

1. Register the Accela developer App ID (account creation, Adrian's action).
2. Prove one agency end to end: confirm anonymous Accela search returns **open code
   cases** with a trustworthy status for a known parcel. Use Hillsborough County
   (HCFL, 1.46M) or Pinellas (959k).
3. Write the Accela adapter once, against the 27 confirmed agencies.
4. Investigate Palm Beach County's ePZB certified lien and open-violation search
   separately. It is one jurisdiction, 1.49M people, and it publishes exactly this
   product's data officially.
5. Only then chase the long tail: self-hosted Accela instances, and the remaining
   unconfirmed counties (Volusia, Marion, St Lucie, Escambia, Alachua).
