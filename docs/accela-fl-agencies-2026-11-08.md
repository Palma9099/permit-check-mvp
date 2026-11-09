# Accela agencies in Florida, enumerated 2026-11-08

## Why this exists

The statewide lien survey (`lien-source-survey-2026-11-08.md`) found that Florida
permit and code-enforcement data is not published to GIS by almost any government.
It is held in about five vendor platforms. Accela is the largest in Florida.

Accela's own API says it supports anonymous public access:

> `GET https://apis.accela.com/v4/agencies` with no credentials returns:
> "App ID or access token is required... Please set App ID to request HTTP header
> `x-accela-appid` for anonymous access"

So one adapter plus one registered App ID could reach every Accela agency that
enables public record search, instead of one scraper per city. This document sizes
that prize before anyone registers or pays for anything.

## Method

The agency directory endpoint needs a real App ID (a fabricated one returns HTTP
500), so agencies were enumerated by probing `https://aca-prod.accela.com/<CODE>/Default.aspx`.
The discriminator is clean and was validated against knowns first:

| probe | result |
|---|---|
| `FTL` | 200, 14,908 bytes |
| `HOLLYWOOD` | 200, 64,529 bytes |
| `MIAMIDADE` | 404, 1,933 bytes |
| `ZZQQXNOTREAL` | 404, 1,936 bytes |

2,009 candidate codes were generated from the 411 Florida incorporated place names
in the Census TIGERweb places layer plus the 67 county names, with common code
variants (compact, `CITYOF`+name, first word, initials, `FT`/`ST`/directional
abbreviations, `COUNTY`/`CO` suffixes). 35 returned 200.

**`aca-prod.accela.com` is Accela's national multi-tenant host, not a Florida one.**
Florida place names collide with other states, so every hit was then identified by
agency name, linked `.gov` domain, and Florida area code before being counted.

## Confirmed Florida agencies (22)

County-level agencies cover the whole county. City agencies cover only that city.

| Code | Jurisdiction | Level | 2020 pop |
|---|---|---|---|
| PINELLAS | Pinellas County | county | 959,107 |
| LEECO | Lee County | county | 760,822 |
| POLKCO | Polk County | county | 725,046 |
| BREVARD | Brevard County | county | 606,612 |
| PASCO | Pasco County | county | 561,891 |
| SARASOTACO | Sarasota County | county | 434,006 |
| OSCEOLA | Osceola County | county | 388,656 |
| TAMPA | City of Tampa | city | 384,959 |
| FTL | Fort Lauderdale | city | 182,760 |
| MARTINCO | Martin County | county | 158,431 |
| HOLLYWOOD | City of Hollywood | city | 153,067 |
| CLEARWATER | City of Clearwater | city | 117,292 |
| NASSAU | Nassau County | county | 90,352 |
| NORTHPORT | City of North Port | city | 74,793 |
| WESTON | City of Weston | city | 68,107 |
| BRADENTON | Bradenton | city | 55,698 |
| DELAND | DeLand | city | 37,351 |
| COOPER | Cooper City | city | 34,401 |
| WINTER | Winter Park | city | 29,795 |
| KEYBISCAYNE | Village of Key Biscayne | city | 14,809 |
| LONGBOAT | Town of Longboat Key | city | 7,505 |
| MULBERRY | Mulberry | city | 3,952 |

Gross reach: **5,849,412 (27.2% of Florida)**.

## Likely Florida, identity not yet confirmed (5)

The portal shell carried no agency name, domain or phone to confirm the state.
All five are distinctly Florida names, but they are not counted above.

CITRUS (Citrus Co, 153,843) · LAKECO (Lake Co, 383,956) · LEONCO (Leon Co, 292,198)
· MANATEE (Manatee Co, 399,710) · SEMINOLECO (Seminole Co, 470,856)

If all five confirm, reach rises to **7,549,975 (35.1%)**.

## Rejected hits, with reasons

| Code | Actually |
|---|---|
| CHARLOTTE | Charlotte, **North Carolina** (`charlottenc.gov`), not Charlotte County FL |
| COSPRINGS | Colorado Springs, CO |
| HILLSBORO | Hillsboro, Oregon |
| MADISON | City of Madison licenses, Wisconsin |
| GOLDEN | City of Golden, Colorado |
| FRANKLIN | Village of Franklin Park, Illinois |
| HAINES | "City of Metropolis", Accela's demo tenant |
| HAMILTONCOUNTY | "City of Metropolis", Accela's demo tenant |
| OAKLAND | "Oakland Online Portal", state unresolved (Oakland CA vs Oakland Park FL) |

## Limits of this enumeration, stated plainly

1. **Recall is unknown and the count is a floor, not a census.** The generator did
   not produce `FTL`, a known-good agency; it was only in the results because it
   was added by hand. Codes that do not follow a place-name pattern were missed.
   A search-engine sweep for indexed `aca-prod.accela.com/<CODE>` URLs would raise
   recall and should be done before treating 22 as the number.
2. **A live portal does not prove usable data.** HTTP 200 proves the agency runs
   Accela Citizen Access. It does not yet prove that public record search is
   enabled, that code-enforcement cases (not just permits) are exposed, or that a
   status field is trustworthy. Each agency still has to clear the same four
   criteria as the GIS survey, and the same reject rule applies: a stale or blank
   status reads as "nothing open", which is the one answer this product must never
   get wrong.
3. Population is 2020 Census (`tigerWMS_Census2020`, POP100). The ACS API now
   requires a registered key.

## What this changes

Two jurisdictions rejected in the GIS survey are reachable here. **Tampa** was
rejected for an empty GIS folder and **Pinellas County** for a permit layer with no
status field, yet both run Accela. That is the thesis holding up: the data exists,
it is just not in GIS. Coverage should be pursued per vendor, not per county.

Next step is not more enumeration. It is one agency, end to end: confirm that
anonymous Accela search returns open code cases for a known parcel in a county-level
agency (Pinellas is the largest), then write the adapter once.
