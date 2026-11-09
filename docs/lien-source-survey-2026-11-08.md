# Which Florida governments publish lien-search data, and which do not

Surveyed 2026-11-08. This exists so nobody repeats the search, and so a later
pass can re-check the "no" answers rather than rediscovering them.

The question each source was judged against is narrow: **can a parcel number be
turned into a current, status-bearing list of cases or permits?** A layer is
only useful to a lien search if all four hold.

1. It is queryable by parcel, folio or parcel id.
2. It carries a status that separates open from closed.
3. It is current, not a frozen snapshot.
4. It answers without a bot wall or a token.

A source failing any of these is worse than no source, because an empty answer
reads as "clear".

## What was checked

- All 67 counties, via their ArcGIS Online organisations.
- About 35 county-run ArcGIS Servers (the counties that run their own).
- 23 Broward city GIS servers.
- About 40 big-city GIS servers statewide.
- 33 city ArcGIS Online organisations.

## Usable: wired up

| Government | What | Why it passes |
|---|---|---|
| Miami-Dade County | Code liens, code cases, building violations, DERM, county permits | The only Florida county publishing parcel-keyed code cases AND the liens recorded on them |
| City of Fort Lauderdale | Open code cases, building permits | Own ArcGIS Server; `CASESTATUS` and `PERMITSTAT` are real |
| City of Hollywood | Open and expired permits | Accela layer, folio-keyed, 99.8% of rows carry a folio |
| City of Miami | Building permits since 2014 | 237k rows, folio-keyed, status is Active/Expired/Final/Hold/Revoked |

## Not usable: checked and rejected

| Government | What exists | Why it fails |
|---|---|---|
| Broward County | 734 ArcGIS services | Not one code, lien or permit case layer. broward.org, Official Records and the Tax Collector are all behind a bot wall |
| Hillsborough County | 181,559 issued permits, parcel-keyed | `STATUS_1` is a copy of the permit number on roughly 43,000 rows, so open cannot be told from closed |
| Pinellas County | Two permit layers | No status field at all: description, value and year only |
| City of St Petersburg | `PermitsExternal`, six layers | Frozen 2019-2021 snapshot. A stale list reads as "no open permits" for anything newer |
| City of Tampa | `CodeEnforcement` folder | Empty, no services |
| Bay County | 309 unsafe-structure and 138 blighted parcels, parcel-keyed | Every row's status field is null, and there is no date. A case resolved in 2018 is indistinguishable from an open one |
| Delray Beach, Winter Park | EnerGov feature services | Geometry history only: a case number with no status and no parcel key |
| Palm Beach Gardens, Palm Bay, Lauderhill, Oakland Park, Cooper City | "Code enforcement" layers | Zones, sectors and office boundaries, not cases |
| Clearwater, Largo, Sanford, Ocala, St Augustine, Coconut Creek, Tamarac | Live GIS servers | Nothing case-shaped |
| Miami Beach, Hialeah, Coral Gables, Homestead, Doral, Miami Gardens, Aventura, Cutler Bay, Palmetto Bay, Sunny Isles Beach | — | No public case or permit layer found |
| Pompano Beach, Coral Springs, Miramar, Davie, Plantation, Sunrise, Deerfield Beach, Weston, Margate, Dania Beach, Hallandale Beach, Parkland, Pembroke Pines | — | No public case or permit layer found |
| Orlando, Jacksonville, West Palm Beach, Boca Raton, Cape Coral, Port St Lucie, Gainesville, Tallahassee, Pensacola, Naples, Fort Myers, Lakeland, Sarasota, Bradenton, Melbourne, Daytona Beach | — | No public case or permit layer found |

## The shape of the answer

Miami-Dade is an outlier, not a norm that other counties fall short of. Almost
every other Florida government runs its code and permit cases through a vendor
portal (Accela Citizen Access, Tyler EnerGov CSS, OpenGov) that has no public
API, and publishes only basemap and boundary layers to GIS.

So the product's shape follows the data, not the other way round: four
governments are pulled live, and everywhere else the search confirms the parcel
and the municipality live, then names the office a person has to read. That is
what `coverage.level` on every search means, and why `'records'` is a real
answer rather than a shortfall.

## Re-checking

The rejections worth re-testing first, because they are closest to passing:

1. **Hillsborough** needs only a clean status column. The layer is otherwise right.
2. **Bay County** needs a status and a date on its unsafe-structure rows.
3. **St Petersburg** needs its permit layers refreshed past 2021.
4. **Broward County** would change the most if it ever published code cases.
