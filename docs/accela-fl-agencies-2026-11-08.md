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

## Confirmed Florida Accela agencies (28)

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
| SEMINOLECO | Seminole County | county | 470,856 | county OneStop page links aca-prod/SEMINOLECO directly |

**28 agencies, 8,812,628 residents, 40.9% of Florida.**

One more Florida Accela agency exists but is not a building AHJ: `LWDD`, the Lake
Worth Drainage District in Palm Beach County (561 area code), which permits
drainage and right-of-way work only.

### Self-hosted Accela (1 confirmed)

Not every Accela agency is on `aca-prod`. Some self-host, and no amount of probing
`aca-prod` will ever find them.

| Host | Jurisdiction | 2020 pop | Evidence |
|---|---|---|---|
| `aca.plantation.org/CitizenAccess` | City of Plantation (Broward) | 91,750 | title "Plantation E-Permit Online Portal" + Florida |

With Plantation: **41.3% of Florida**. There is no uniform hostname pattern for
self-hosted instances (`aca.<domain>/CitizenAccess` was tried against nine other
Florida governments and resolved for none), so this tier has to be found per city.

## Not confirmed, deliberately excluded from the totals

| Code | Shows | Why not counted |
|---|---|---|
| BCC | nothing | No name, domain, phone or branding on the page |

### SEMINOLECO resolved: confirmed

Seminole County's own OneStop page links directly to
`https://aca-prod.accela.com/SEMINOLECO/Login.aspx`, which is authoritative. The
portal went live 2026-10-19 after migrating 30+ years of records, and it covers
permitting, planning **and code enforcement**. Counted: 470,856.

### LAKECO resolved: retired, and this is the trap worth remembering

`LAKECO` returns HTTP 200, but the page is a migration notice: Lake County
Community Development moved Building Safety permitting, Code Enforcement
complaints and Planning to **OpenGov**, with the old portal frozen after 2025-02-27.
It is a live-looking URL serving a dead system.

**A 200 can be a retired portal.** After finding this, all 27 other confirmed
agencies were re-checked for migration and retirement language. Only LAKECO is
retired. (Osceola flagged on "no longer accept cash payments", a payment notice,
not a migration.) Lake County now belongs in the OpenGov column, and its 383,956
residents are **not** counted as Accela coverage.

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
| SCCGOV | Santa Clara County, **California** (`santaclaracounty.gov`, 408) |
| INDY | City of Indianapolis / Marion County, **Indiana** |
| HAINES, HAMILTONCOUNTY, LACO, PGCO, SDCO | all return "City of Metropolis", Accela's **demo tenant** |

### One claim that was asserted and is false

A commercial permit-data site states that Palm Beach County publishes its permit
search at `https://aca-prod.accela.com/PBCGOV/Default.aspx` "running on Accela
Citizen Access". It does not. `PBCGOV`, `PBC`, `PALMBEACH` and `PBCFL` all return
HTTP 404 "The resource cannot be found." Palm Beach County runs its own **ePZB**
system. Aggregator coverage pages are marketing, not sources.


## citizenserve: a second centrally enumerable platform (17 Florida agencies)

Chasing Alachua County turned up a platform that matters as much as Accela,
because it has the one thing Accela refuses to give: **a central tenant registry
enumerable by integer.**

`https://www4.citizenserve.com/Portal/PortalController?Action=showHomePage&ctzPagePrefix=Portal_&installationID=<N>`

A disabled tenant returns the literal string `PORTAL NOT ENABLED`, so live tenants
enumerate cleanly. Sampling put the live range at roughly 100-600; IDs 100-650 were
swept and 38 matched Florida. The `, FL` match was validated as real signal, not
template boilerplate, by confirming that id 400 (City of Foley, Alabama) and id 200
(City of Hiawatha) do not match it.

### Confirmed Florida county agencies on citizenserve

| ID | Jurisdiction | 2020 pop | How confirmed |
|---|---|---|---|
| 318 | Alachua County | 278,468 | name appears 3x; official county page links installationID 318 |
| 445 | Sumter County | 129,752 | "Sumter County offers residents the convenience of accessing" |
| 245 | Walton County | 75,305 | "WELCOME TO THE WALTON COUNTY CITIZENSERVE PORTAL" |
| 175 | Wakulla County | 33,764 | "Wakulla County Building Department and Planning" |
| 197 | Gulf County | 14,192 | "Welcome to Gulf County Florida" |
| 389 | Franklin County | 12,451 | county named + `, FL`; **probable, not proven** |

Alachua's portal covers permitting, planning, licensing and code enforcement, and
it offers "Request a Lien Search" directly. That is this product's data.

### Confirmed Florida city agencies on citizenserve

| ID | Jurisdiction | 2020 pop |
|---|---|---|
| 403 | Titusville | 48,789 |
| 221 | Casselberry | 28,794 |
| 441 | City of Seminole | 19,364 |
| 331 | City of Cocoa | 19,041 |
| 261 | West Park | 15,130 |
| 117 | Southwest Ranches | 7,607 |
| 391 | Eatonville | 2,349 |
| 401 | Montverde | 1,655 |
| 171 | Anna Maria | 968 |
| 237 | Bradenton Beach | 908 |
| 326 | Key Colony Beach | 790 |

### Excluded, and why it mattered

Name extraction on this platform is unreliable in **both** directions, and trusting
it would have produced a large false claim.

| ID | Extracted as | Actually | Would have wrongly added |
|---|---|---|---|
| 443 | "Duval County" | **Duval County Public Schools** - code enforcement and permits for school buildings only | 995,567 |
| 458 | "Clay County" | **Clay County District Schools** | 218,245 |
| 349 | - | UCF Building Department, a university, not a municipal AHJ | - |
| 120, 231, 476, 490 | "Town of Buena Vista" | citizenserve demo installs; pages literally say "BANNER TROUBLESHOOTING" | - |
| 355 | "Putnam County" | no supporting context on the page | 73,321 |

A bare "X County" string on a page is not an agency. Two of the three largest
citizenserve "county" hits were school districts. Every tenant needs its identity
read, not inferred.

Fourteen more tenants matched Florida but carry a generic "Welcome to Our online
portal" with no extractable agency name. They are real Florida tenants and are
**not** counted: IDs 113, 125, 132, 159, 164, 180, 185, 209, 228, 233, 308, 383,
386, plus any beyond ID 650 that were never swept.

## Coverage rollup

| Platform | Agencies | Residents | Share of Florida |
|---|---|---|---|
| Accela (`aca-prod`) | 28 | 8,812,628 | 40.9% |
| Accela self-hosted | 1 (Plantation) | 91,750 | +0.4% |
| citizenserve | 17 | 689,327 | +3.2% |
| **total confirmed** | **46** | **9,593,705** | **44.5%** |

Against 14.1% live today.

## What the other jurisdictions run

The "about five vendors" estimate was too tidy. The real picture includes several
homegrown systems at the largest jurisdictions, which no vendor adapter will reach.

| Jurisdiction | 2020 pop | Platform | Note |
|---|---|---|---|
| Miami-Dade County | 2,701,767 | county-run | already integrated live |
| Palm Beach County | 1,492,191 | **ePZB** (homegrown) | TESTED 2026-11-09, see its own section below. The *certified* Fine/Lien search is a paid manual service and not a data source. But two **free guest searches** expose full code cases and full permit history by PCN, for unincorporated PBC (649,776). |
| Orange County | 1,429,908 | **Fast Track** (`fasttrack.ocfl.net`) | public, no account needed, **but search forms carry a CAPTCHA**, which is a hard stop: bypassing bot checks is out of scope, so this needs an official data request |
| Duval / Jacksonville | 995,567 | **JAXEPICS** (`jaxepics.coj.net`) | TESTED 2026-11-09, see its own section below. The search page renders for anonymous visitors but **does nothing** - no API call fires at all. Code case records are **public-records-request only**. |
| Collier County | 375,752 | **CityView** (`cvportal.collier.gov`) | TESTED 2026-11-09, see its own section below. Loads fine in a browser (the 406 was a bot wall), but the property search is **CAPTCHA-gated** and the code lien search is **$25** with an account. 90.6% unincorporated. |
| Jupiter, Wellington, Riviera Beach, Lake Park | — | Tyler EnerGov Self Service | unverified, from a third-party guide |
| Royal Palm Beach | — | Click2Gov | unverified |
| City of Orlando | 307,573 | OpenGov or BS&A | sources conflict; unverified |
| Pompano Beach | 112,046 | Click2Gov (`c2g.pompanobeachfl.gov`) | unverified |
| Miami Beach | 82,890 | Civic Access / CSS | unverified |
| Lake County | 383,956 | **OpenGov** | migrated off Accela 2025-03; see the LAKECO correction above |
| Volusia County | 553,284 | **Connect Live** (`growthmgt.vcgov.org/citizenportal/app/`, `connectlivepermits.org`) | both reachable (200); public search, no registration; county covers unincorporated only |
| Marion County | 375,908 | **Tyler EnerGov** (`selfservice.marionfl.org/energov_prod/selfservice`) | live 2025-11-12; supports case and lien search requests |
| St Lucie County | 329,226 | **Tyler EnerGov** Customer Self Service | TESTED 2026-11-09, see its own section below. The Code Lien Search Request is a $20 paid request and code cases are **not** online at all. Permits are free and parcel-keyed, for unincorporated St Lucie (76,465). |
| Okaloosa County | 211,668 | Tyler EnerGov Self Service | from a third-party directory, unverified |
| Escambia County | 321,905 | unnamed online permitting | directory says it covers permits, planning, code enforcement cases and contractor licenses; host not yet found |
| City of Stuart | 17,422 | **OpenGov** | migrated off Accela |
| City of Apopka | 54,873 | OpenGov (`apopkafl.portal.opengov.com`) | third-party guide only. The 200 proves nothing: see the OpenGov dead end below |


## Correction to the original GIS survey: Broward County does publish code cases

`lien-source-survey-2026-11-08.md` recorded "Broward County: 734 services, no case
layer". That was a conclusion about Broward's **GIS**, and it is wrong about the
county. Broward County runs a public Code Compliance and Code Enforcement case
search on a **Posse** (Computronix) platform:

`https://dpepp.broward.org/BCS/Default.aspx?PossePresentation=SearchForEnforcement`

Verified reachable (HTTP 200, 57,346 bytes). The page offers Code Compliance and
Code Enforcement case search, Enforcement Case Number, Enforcement Type,
Enforcement Unsafe Structure, **Search by Folio or Parcel**, plus contractor
licence and elevator certificate searches. Folio-keyed county code enforcement is
exactly what this product consumes.

### Tested end to end, 2026-11-09. It works, and it is far smaller than it looks.

A real folio was run through it. Folio **0113-11-1610** (1455 SW 49 TER, Broadview
Park) returned the parcel's complete case history, ten cases from 2010 to 2024,
including one `Lien Recorded` and one open `Violation`. Opening case 24-0071 gave
the full record:

```
Status:              Lien Recorded
Enforcement Type:    Code Compliance      Case Type: ZONING
Complaint/Violation: BULK ON SWALE MORE THAN 24 HOURS BEFORE SCHEDULED PICKUP.
Date Established:    01/18/2024           Correction Deadline: 01/18/2024
Inspector:           Nicholas Rousseau    (954) 357-9790
Folio Number:        0113-11-1610         Jurisdiction: Unincorporated
Legal Description:   BROADVIEW PARK 36-33 B LOT 18 BLK 13
Owner:               MCFARLAND,BRIAN
--- Activities tab ---
NOV Issued:          01/18/2024
Section:             CITATION: 39-275(6)b
Lien Recording:      CR Number 119572537   Recording Date 05/14/2024
```

That is a recorded-lien instrument number, cross-referenceable against Broward
Official Records. It is the single richest per-property record found anywhere in
this survey. No dollar amount is published, which is the one gap.

**But the population credit is 16,888, not 1.94M.** Two full-year sweeps settle it:

| Year | Cases | Unincorporated | Everything else |
|---|---|---|---|
| 2024 | 1,421 | 1,312 (92.3%) | 57 North Lauderdale, rest strays |
| 2026 YTD | 1,848 | 1,752 (94.8%) | 35 Fort Lauderdale, 12 North Lauderdale |

Every case record carries its own `Jurisdiction:` field, and it reads
`Unincorporated` on the county's own caseload. Unincorporated Broward is
**16,888 residents** (2020 Census: county 1,944,375 minus all 31 municipalities,
1,927,487). That is 0.08% of Florida, a rounding error on the coverage map.

The municipal cases that do appear are **Unsafe Structure** only, the county's
Unsafe Structures Board acting for cities under interlocal agreement. Verified:
case 26-1484, 1906 SW 87 AVE, `Jurisdiction: North Lauderdale`, Unsafe Structure,
FBC 116.2.1.2.3, "partially destroyed due to fire outbreak". That is a partial
case type, not coverage, so no population is credited for it.

For a structural engineering practice this is worth more than its population
suggests: an open unsafe-structure case is exactly the fact you want before
quoting work, and the county publishes them for cities it does not otherwise
cover. As *coverage*, it is 16,888 people.

### Adapter notes (measured, not assumed)

- The result pages are **plain GET, no session, no cookie, no viewstate**:
  `Default.aspx?PossePresentation=ParcelEnforcementList&PosseObjectId=<n>` and
  `...=ViewEnforcementCase&PosseObjectId=<n>` both return 200 to bare `curl`.
- `PosseObjectId` for parcels is **sequential by lot**: 406547 = 1437 SW 49 TER,
  406548 = 1455 SW 49 TER, adjacent lots on the same block. The whole
  unincorporated dataset is enumerable without using the search form at all.
- Clean negative: a valid parcel with no cases returns the literal string
  `No Enforcement Cases were found for this parcel.` A bad id returns `BCS - Error`.
  Both are parseable; neither is a silent empty page.
- Only the folio-to-PosseObjectId entry step needs the ASP.NET POST.
- Data hygiene is poor and an adapter must not trust the city column: observed
  `NINCORPORATED`, `Unicorporated`, `FT LAUDERDALE, FL 22211`, and
  `THROUGH HIS GRACE 4 LLC` sitting in the city field. Trust the record's
  `Jurisdiction:` field instead.
- The enforcement search's **Enforcement Type dropdown does not filter**; the date
  fields do. A type filter has to be applied after the fetch.
- A `%` wildcard in Street Address returns enough rows to hang a browser tab. Bound
  every query by date.

It also means the GIS survey's rejections should each be re-read as "not in GIS",
never as "the government does not publish it". Tampa, Pinellas, Hillsborough and
now Broward County have all turned out that way.

## Palm Beach County ePZB, tested 2026-11-09

The earlier note called PBC's "certified Fine/Lien search" the highest-value single
target in the sweep. That was half wrong and half an understatement.

### The certified lien search is a competitor, not a source

Read from the county's own page, `discover.pbc.gov/pzb/administration/Pages/Lien-Permit-Searches.aspx`:

| Search | Price | Turnaround |
|---|---|---|
| Fine/Lien | $65, rush $97 | 7 to 10 business days, rush 3 |
| Open building permit (certified) | $65, rush $97 | same |
| Open code compliance violation | $50, rush $75 | same |

It is a manual service performed by PZB staff, paid by card through a registered
portal account or by cheque to the Board of County Commissioners. It is not an API,
not a feed, and not scrapeable. It is the product this project sells, priced by the
county at $65 with a ten-day turnaround.

Scope, quoted: "All search results represent unincorporated Palm Beach County" and
"Searches do not include properties located in municipalities except those annexed
from the county by a municipality."

### The free guest searches are the actual prize

ePZB exposes two public, no-sign-in searches, each reached through an iframe inside
the portal shell:

- Code compliance: `pbc.gov/iPZB.CodeCompliance.Service/search`
- Building permits: `pbc.gov/iPZB.Building/guest/searchpermits`

Both search by **PCN** (Palm Beach's parcel key), and both also take address, owner
and company. Code compliance adds respondent name and commission district; permits
add contractor and historical permit number.

**Code compliance, round-tripped.** A Loxahatchee street search returned 275 cases.
Opening one gave owner, PCN, zoning, respondents, and a per-violation timeline.
Feeding that PCN back into the PCN tab returned exactly that parcel's two cases, so
the parcel key round-trips. Status filter includes **Fine**. A Fine-status case,
C-2023-07120016 at 12571 Orange Grove Blvd:

```
PCN 00-41-43-10-00-000-4180   Owner Lazaro R Roque
Zoning Agricultural Residential District      Status Fine
Violation  Structure without Permits (2021-12-29)
Details    "...More specifically, metal framed canvas carport structure has been
            erected or installed without a valid building permit."
Codes      PBCAFBC20-105.1: PBC Amendments to FBC 7th Edition (2020)
Closed     2026-09-09  "The respondent has obtained the permit."
Violation  Expired Permit -- "permit #B2021-0174444-0000 ... has become inactive"
```

It names the unpermitted structure, cites the exact PBC-amended FBC section, and
gives the permit number. For an engineering practice chasing ATF work this is the
best per-property record found anywhere in this survey.

**No dollar figure and no lien recording appear anywhere in the free tier.** The
status reads `Fine`; the amount is what the $65 certified search sells. That is the
clean line between free and paid, and it is worth knowing exactly where it falls.

**Permits, same parcel, same key.** The guest permit search on PCN
00-41-43-10-00-000-4180 returned 14 permits with description, owner, contractor
company, status, balance and an inspections link:

```
B-2026-008236-0000  Accessory Bldg >= 36 Sq Ft Prefab      Complete    $0.00
PR-2026-008232-0000 Aluminum Structure - Carport           In Process  $0.00
PR-2022-033292-0000 Storage Building                       Void        $0.00
B-2021-017444-0000  Fence - Residential (+ rev 1, rev 2)   Complete    $0.00
B-2021-027416-0000  Window & Door Replacement Impact       Complete    $0.00
```

The two datasets cross-reference: the code case cited permit B2021-0174444-0000 and
the permit search shows `B-2021-017444-0000` with a renewal and a change of
contractor. The whole history of a property reconstructs from one PCN. Permit status
filter includes **Inactive**, which is the expired-permit signal, and a **Balance**
column, which is a money field the code side lacks.

### Coverage

Unincorporated Palm Beach County is **649,776** (county 1,492,191 minus all 39
municipalities at 842,415, 2020 Census). That is 3.0% of Florida from one
jurisdiction, with permits and code cases both, free, keyed by parcel. It is 38
times Broward's unincorporated population and it changes the ranking of what to
build next.

| | Agencies | Residents | % of FL |
|---|---|---|---|
| Accela + citizenserve (earlier) | 46 | 9,593,705 | 44.5% |
| + Palm Beach County unincorporated | 47 | 10,243,481 | **47.6%** |
| + Broward County unincorporated | 48 | 10,260,369 | 47.6% |

### Adapter notes

- Everything renders inside iframes in an AngularJS shell. The portal routes
  (`#/Container/Code_Compliance_Cases`, `#/Container/Permits_Inspections`) render a
  blank panel if you read the outer document; the content is the iframe `src`.
- Setting a field's `.value` by script does not bind. The form validates against
  its own model, so inputs must be driven as real typing and selects by keypress.
- The code compliance PCN field auto-formats bare digits; the permit PCN field does
  **not** and rejects them with "Please enter valid format for pcn". Send the dashed
  form `00-41-43-10-00-000-4180` to both.
- Partial PCN search is supported on both; the code side requires the first 4 parts
  and accepts `SUB` for subdivision.
- The case detail page is `/compliance` with no query string, so it is **not**
  deep-linkable the way Broward's is. Entry is through the search each time.
- The page's own traffic uses a clean JSON API: `POST api/search/search`,
  `GET api/search/getcasedetail?sequenceNo=N`, `GET api/search/GetLookups`, and the
  detail JSON carries a `Confidential` flag per situs address. **Calling those
  endpoints outside the portal UI was refused by this environment as website access
  circumvention, twice, and was not worked around.** Whether they answer without a
  browser session is therefore untested, and the adapter should be written against
  the UI unless someone establishes otherwise.
- Same data-hygiene warning as Broward: the city dropdown ships `Loxahatche`,
  `Loxatachee` and `Loxhatchee` alongside `Loxahatchee`. Do not key on city.

## St Lucie County EnerGov, tested 2026-11-09

Host: `stluciecountyfl-energovpub.tylerhost.net/Apps/SelfService`, reached from
`stlucieco.gov/CitizenSelfService`. Tyler EnerGov Citizen Self Service, no
account needed to search.

### Code cases and liens are not online. At all.

This is the sharpest version of the Palm Beach pattern. The county's "Code Lien
Search Request" is a **$20 per-address paid request**, needs a registered
account, and takes **3 to 10 business days**. It reports code violations, code
liens and citations, and explicitly does not report open permits, utility bills
or payoff figures - payoff is a second, separate request.

Four independent confirmations that the code data is simply absent from the free
portal, not merely unlabeled:

1. The portal's own home page says it: *"Search Public Records - NOTE: Code Case
   information is currently not available online."*
2. The search module dropdown skips a value. It offers All(1), Permit(2),
   Plan(3), Inspection(4), Request(6), License(10), Project(11). **5 is
   EnerGov's Code Case module**, and it is gone.
3. The results region is labelled "Search Results for various permits, plan,
   licenses, inspections".
4. A search across an entire major county road returned **3,815 records** - 868
   permits, 36 plans, 2,866 inspections, 28 licences, 17 projects - and the API
   reported `CodeCasesFound: 0`. Zero code cases on a whole road is not a
   property-level fact; it is a disabled module.

The data exists in the system. `api/energov/codecases/search/setup` answers with
16 configured case types, including Condemnation, Imminent Danger, Lot Clean Up,
Foreclosed Properties and Contractor Citation. The county holds it and sells
access to it for $20.

### Permits are free, and they cover what the paid search refuses to

The free half is genuinely useful, and it is the exact complement of the paid
half: the $20 lien search explicitly excludes open permits, and open permits are
precisely what the public portal does carry.

```
Permit Number   1210-0307
Applied Date    02/23/2013      Issued Date  02/01/2013
Type            Building Commercial - Cell Tower/Antenna
Expiration Date 04/11/2014      Status       Completed\Finaled
Finalized Date  10/11/2013
Main Parcel     320124400390008
Address         16800 OKEECHOBEE RD FORT PIERCE, FL 34945
Description     ADDRESS IS 16800 OKEECHOBEE RD. (ADDRESS ON BLD PLANS ...)
```

`Main Parcel` is the important field: the permit record is parcel-keyed, so an
adapter can join it to a parcel rather than to an address string.

### Coverage

Unincorporated St Lucie is **76,465** (county 329,226 minus Port St Lucie
204,851, Fort Pierce 47,297 and St Lucie Village 613). Port St Lucie runs its own
building department and its own lien portal at $80 a search; Fort Pierce runs its
own too. So this is 76,465 for permits and **zero for code and liens**, which is
what the product actually sells.

### Adapter notes

- The result rows do not render until a category filter is clicked; the
  unfiltered view shows only counts and pagination.
- The SPA ignores hash-route changes, so a search cannot be driven by URL - the
  form has to be filled and submitted.
- The counts come from `POST api/energov/search/search`, which returns
  `PermitsFound`, `CodeCasesFound` and friends with an empty `EntityResults`;
  rows arrive on a later paged call.
- Searching is public, but anything that would reach the code data requires an
  account and a payment, so there is nothing here to automate on the lien side.

## Duval / Jacksonville JAXEPICS, tested 2026-11-09

This was the biggest prize left in Florida and it is shut.

### Why Duval should have been the best target in the state

Duval is **100% incorporated**, and consolidated Jacksonville is 949,611 of the
county's 995,567 people. The other four municipalities - Jacksonville Beach
23,830, Atlantic Beach 13,513, Neptune Beach 7,217, Baldwin 1,396 - account for
the rest. Unincorporated Duval is **zero**.

That matters because the unincorporated-only trap that cuts Palm Beach to
649,776, St Lucie to 76,465 and Broward to 16,888 **does not apply here at all**.
One consolidated government is the code authority for 95% of a million-person
county. Nothing else in Florida except Miami-Dade offers that.

### The search renders, and does not work

`jaxepics.coj.net/Search/SearchResults` loads without a login and looks fully
functional. The **Search For** dropdown offers Permit, Inspection, Certificate of
Use, Sketch Plan, Civil Plans, Plat, Easement, Development Plan, Projects,
Property, Meeting, Deviations, Profile and **Case**. Choosing Case switches
**Search By** to Address, Case Number, Violation Number, Citation Number,
Individual, Business, CARE Number, and renders a results grid headed:

```
Case | Status | Required Permits | Address | DateEntered | Initial Comment | Inspector | Violations | Citations
```

That is exactly the shape this product consumes, down to a CSV download button.
It returns nothing, because **no request is ever made**. Verified by typing a
permit number matching the app's own `FullPermitNumberRegex`
(`^[A-Z]-\d{2}-\d+\.\d{3}$`), clicking the magnifier, and watching the network:
zero calls to `jaxepicsapi.coj.net`, the API base its own `assets/config.json`
declares. No auth token in storage either. The app is wired for Azure AD
(`login.microsoftonline.com`), and anonymously the submit is a silent no-op.

Worth being precise about the failure mode: the grid prints **"No data matching
applied search"** before any search has run. Read quickly, that looks like a
clean property. It is the empty initial state of a search that never executed.

### "Guest Sign In" no longer exists

The city's Building Inspection Division services page still instructs: *"Use the
'Guest Sign In' and 'Search for' (Top Left) Property by Address"*, pointing at
this exact URL, and says the search covers building code violations, COs and
permit details. There is no Guest Sign In anywhere in the current UI - the login
page offers only email/password, the City of Jacksonville (Azure AD) login,
forgot-password and Create an Account. The instruction is stale, and the same
page gives it away by referring to "the city's older computer system".

### Code cases are a public records request

From Municipal Code Compliance's own page, which is the authority here: there is
no public online case search. "Case details, case documents, and case status"
**require a PRR**, submitted at `records.coj.net`. The city asks that a request
include both the address and the **RE#** (Duval's parcel key), and points to
`paopropertysearch.coj.net` and `maps.coj.net/DuvalProperty/` to look that up.

So Duval is worse than St Lucie: St Lucie at least sells a defined $20 product
with a 3-10 day turnaround. Duval has no product, only a records request.

### What is public

- `paopropertysearch.coj.net` - Property Appraiser search, gives the RE#.
- `maps.coj.net/DuvalProperty/` - property map.
- `maps.coj.net/mappao/Default.cshtml?RE=<RE#>` - the parcel viewer JAXEPICS
  itself links to, keyed by RE number. Blank without an RE.
- A third party, `JaxStableHousing.org`, publishes a map and search built from
  three years of city code enforcement records. That it exists is the useful
  signal: the data is obtainable in bulk by request, even though it is not
  queryable online.

### Verdict

No adapter to build. The realistic path to 949,611 people is an official data
request or a recurring PRR, which is a relationship question rather than an
engineering one - the same conclusion as Orange County, for a different reason.

## Collier County CityView, tested 2026-11-09

The best-shaped county tested, and still shut.

### Shape

Collier is **90.6% unincorporated**: 340,525 of 375,752 people, with only Naples
(19,115), Marco Island (15,760) and Everglades City (352) incorporated. So unlike
Broward, Palm Beach or St Lucie, the county genuinely is the code authority for
almost everybody here. Nothing is lost to the unincorporated-only trap.

### The 406 was a bot wall, not a dead host

The earlier survey recorded `cvportal.collier.gov` as returning HTTP 406. It does
to `curl`, with or without an Accept header. In a browser it loads perfectly as
the GMCD Public Portal. A 406 to a scripted request is a reason to open the page,
not a reason to write the county off - the same mistake class as "not in GIS".

### The property search is CAPTCHA-gated

`/cityviewweb/Property` redirects straight to `/cityviewweb/Property/Locate`,
which is a CAPTCHA page: an image plus a `CVCaptchaCode` field. **Not attempted.**
Bypassing or solving bot checks is out of scope, so what sits behind that gate is
**unknown and this document does not guess at it.** What can be said is that the
county's own buyer guidance does not point at it: the "Thinking about Buying a
Home?" page tells prospective buyers to "Order a code lien search" and "Obtain
payoff information on outstanding code liens", both paid.

### The code lien search is $25, portal-only

Quoted from the county's Lien Search and Payoff Request page:

- "The cost for this service is **$25 per property address**"
- Reports "Code violations, Code enforcement liens, Citations"
- "will not report issues beyond the Code Enforcement Department's jurisdiction,
  such as **open permits and utility bills**, and **payoff information is not
  included**" - payoff is a separate $25
- "Effective Immediately, Lien Search and Payoffs are now only requested and paid
  through the Collier County Portal. Please note, an **account will need to be
  created** in order to submit requests"

That wording is near-identical to St Lucie's page, down to the sentence about
open permits and utility bills. These counties are copying each other, which is
why the same $20-$65 paid-lien-search product keeps appearing.

### GIS has districts, not cases

Collier GMD's ArcGIS org (`SlIq32SqARUHIhSx`, behind
`gis-colliercountygmd.hub.arcgis.com`) publishes **84 feature services**. Parcels,
address points, zoning, flood, elevation certificates, FBC wind load categories -
all there. The only code-related layer is `CodeInspectorUpdates_view`, whose single
layer is `CodeEnforcementDistricts` with fields `OBJECTID, INSPECTOR, ZONES,
SUP_ZONE, SUPERVISOR`. Inspector territories, not cases. Exactly the trap the
original survey named: "Zones, sectors and office boundaries, not cases."

### Verdict

No adapter to build. Two independent gates - a CAPTCHA on the free search and a
$25 account-only paywall on the lien search - and no case layer in GIS. 340,525
people under one authority, unreachable by code.

## The Florida vendor landscape, as actually observed

"About five vendors" was too tidy. Nine platforms, and the largest jurisdictions
mostly run their own software.

| Platform | Florida jurisdictions observed | Centrally enumerable? |
|---|---|---|
| **Accela** | 28 confirmed agencies | No. `/v4/agencies` needs a real App ID |
| **citizenserve** | 17 confirmed agencies | **Yes**, by integer `installationID` |
| **Posse** (Computronix) | Broward County (unincorporated only) | Yes, `PosseObjectId` is sequential |
| **Tyler EnerGov** | Marion, St Lucie, Okaloosa (partly), several Palm Beach cities | No central registry; per-host |
| **OpenGov** | Lake County, Stuart, (Apopka unverified) | **No**, proven below |
| **MyGovernmentOnline (MGO)** | Escambia, Okaloosa | not tested (`mygovernmentonline.org` is up) |
| **CityView** | Collier | not tested |
| **Click2Gov** | Pompano Beach, Royal Palm Beach | not tested |
| **Homegrown** | Miami-Dade, Palm Beach (ePZB), Orange (Fast Track), Duval (JaxEPICS), Volusia (Connect Live) | n/a, one-offs |

### citizenserve is now fully enumerated

IDs 1-1300 were swept. Outside the original 100-650 range, exactly one more Florida
tenant exists (id 97, generic "Welcome to Our online portal", unidentified). So the
Florida citizenserve population is **39 tenants, all between id 97 and id 650**,
of which 17 are confirmed agencies, 7 are excluded (2 school districts, 1
university, 4 demo installs), and 15 carry no extractable agency name.

### OpenGov cannot be enumerated, and a 200 from it means nothing

`<slug>.portal.opengov.com` is wildcard DNS in front of a single-page app. A real
tenant and a nonsense one are **byte-identical**:

| slug | HTTP | bytes | md5 |
|---|---|---|---|
| `apopkafl` | 200 | 12,792 | afad8c638efd27b67e1650e3e7dd82c5 |
| `lakecountyfl` | 200 | 12,792 | afad8c638efd27b67e1650e3e7dd82c5 |
| `zzqqnotrealcityfl` | 200 | 12,792 | afad8c638efd27b67e1650e3e7dd82c5 |

The slug is never echoed in the page; the tenant is resolved by a later client-side
call. Its real API base is `https://api-east.viewpointcloud.com/v2` (read from the
app's own embedded `store3/config/environment`), and the guessable public paths
(`/places`, `/communities`, `/community`, `/tenants`) all return a clean JSON 404.
Probing further into that private API was **refused by this environment as website
access circumvention, and was not worked around.** OpenGov tenants therefore have
to come from each city's own published page, which is how Lake County and Stuart
were found.

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
2. Prove one agency end to end: confirm anonymous search returns **open code cases**
   with a trustworthy status for a known parcel. Use Hillsborough County (HCFL,
   1.46M) or Pinellas (959k).
3. Write the Accela adapter once, against the 28 confirmed agencies.
4. Write the citizenserve adapter second. It needs no App ID, the tenant registry
   enumerates by integer, and Alachua already exposes a lien-search request flow.
5. DONE 2026-11-09. Broward's Posse search was tested end to end and works, but
   it covers 16,888 people, not 1.94M. Build the adapter only if unsafe-structure
   cases for contracting cities are worth it on their own; as coverage it is
   negligible. See the Broward section above for the measured record shape.
6. DONE 2026-11-09, both. Palm Beach's certified lien search is a $65 manual
   service, but its two free guest searches give code cases and permit history by
   PCN for 649,776 people - **built and merged.** St Lucie's Code Lien Search
   Request is a $20 manual request and its code cases are not online at all; only
   permits are public there, for 76,465 people, so there is no lien adapter to
   build for St Lucie.
7. Long tail: the 15 unnamed Florida citizenserve tenants, self-hosted Accela
   instances, and per-county vendor detail for Bay, Santa Rosa, St Johns, Hernando,
   Indian River, Flagler, Monroe, Putnam and Clay.

### Known dead ends

- **Orange County Fast Track** (1.43M): public and free, but the search forms carry
  a CAPTCHA. Bypassing bot checks is out of scope, so this needs an official data
  request, not engineering.
- **Accela `/v4/agencies`**: needs a real App ID; a fabricated one returns HTTP 500.
  No `robots.txt`, no `sitemap.xml`, no root listing on `aca-prod`.
- **Tyler EnerGov REST API**: the documented `/api/energov/...` paths returned 404
  at Marion's real host. The API base was not found this pass.
- **Name-pattern brute force on `aca-prod`**: saturated, see Method above.
- **OpenGov subdomain enumeration**: impossible, byte-identical responses. Its
  private API was off limits and not probed around.
- **`permits.myokaloosa.com`**: did not resolve from here.
- **`claycountygov.com`**: returns HTTP 403 to a plain request.
