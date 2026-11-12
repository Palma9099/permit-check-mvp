# Phase 0: what our county adapters actually reach, measured 2026-11-12

Two questions, measured rather than estimated: how many residents a county
source can reach, and whether our adapter can read it.

## Why the population question exists

A county code office governs the unincorporated area; cities inside it run
their own. So crediting a county tenant with county population counts every
city twice. The Accela survey credits Hillsborough County at 1,459,762, which
includes Tampa at 384,959, routed separately to its own tenant.

`scripts/phase0-reach.ts` computes it per county. Validated against four
figures derived independently elsewhere, all exact: Palm Beach 649,776,
Broward 16,888, St. Lucie 76,465, Duval 0.

| Florida | residents |
|---|---|
| total | 21,538,187 |
| in 412 incorporated places | 10,832,913 |
| unincorporated | 10,705,274 |

**Half the state is reachable through ~67 county sources and half needs ~412
city ones**, so a county adapter is worth about six times a city adapter per
unit of work. We had been building cities.

## What the 12 county tenants actually do

`worker/src/phase0-county-probe.ts`, live runs.

| tenant | result | unincorporated |
|---|---|---|
| Palm Beach | RETURNS, 4 cases | 649,776 |
| Pasco | RETURNS, 7 cases | 513,983 |
| Alachua | RETURNS, 6 cases | 108,824 |
| Sumter | RETURNS, 2 cases | 108,709 |
| Franklin | READABLE_EMPTY | 7,504 |
| Broward | NEEDS_KEY (folio) | 16,888 |
| Miami-Dade | FAILED | 1,186,954 |
| Hillsborough | adapter fails, portal works | 1,008,349 |
| Lee | adapter fails | 377,864 |
| Seminole | adapter fails | 224,494 |
| Leon | adapter fails | 96,029 |
| Nassau | adapter fails | 72,807 |

**1,388,796 residents are already covered by working county adapters that
nobody had counted**, on top of the 2,049,410 the 36 city tenants reach.

**Palm Beach ePZB is built and working.** Our own notes called it "the first
adapter to build". It returns real cases, including "Construction work
without Permits, Struc", for 649,776 residents.

## Three hypotheses killed, in order

Recorded because each looked right and each was wrong, and the pattern is the
point: a single confirming case is not a cause.

1. **"County tenants cannot be read."** From Hillsborough alone. Killed by
   Pasco within the hour: a county, same Enforcement module, 7 real cases.
2. **"The module name is wrong, so Accela serves General Search."** Our own
   notes say a hardcoded `module=Enforcement` was wrong for 17 of 28
   agencies, so this fit. Killed by a control: a nonsense module returns a
   DIFFERENT page, so the configured module is valid.
3. **"Landing on the General Search form with `ddlSearchType` is the
   failure."** Killed by the same run: PASCO, which works, lands on the
   identical page shape.

## Where the Hillsborough failure actually is

Driven directly - navigate to the module page, fill
`input[id*="txtGSStreetName"]` with MAIN, click
`ctl00_PlaceHolderMain_btnNewSearch` - the portal **returns a results grid**.
The adapter, on the same tenant, gets no grid and no explicit empty state.

So the portal works and the adapter's flow is what fails. That is a
reproducible contrast to debug against, and it is the next piece of work. It
is NOT yet a diagnosis, and after three dead hypotheses it will not be called
one until a control confirms it.

## Method limits

- Places are assigned to counties by centroid, so a place straddling a county
  line lands wholly in one. Longboat Key is the known Florida case.
- The probe's request counter only sees Accela's ASP.NET POSTs. citizenserve
  returned six real cases with zero counted requests, so `ok` from the adapter
  is the signal and the counter is a detail on Accela failures only.
- A READABLE_EMPTY result is readable, not proven: it means the portal held
  nothing on the probed streets.
- Broward and Palm Beach search by parcel key. A street probe against them
  measures nothing, so Broward without a folio is UNPROBED, not failing.
