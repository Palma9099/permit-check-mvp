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

**1,381,292 residents are already covered by working county adapters that
nobody had counted**, on top of the 2,049,410 the 36 city tenants reach.

> **Corrected after Codex R2.** This read 1,388,796, which was exactly 7,504
> too high: Franklin's population. Franklin is READABLE_EMPTY, meaning the
> adapter completed and the portal held nothing, so it has NO demonstrated
> returned cases and does not belong in a working-adapter total. The error was
> made in the document whose stated purpose is that its numbers are not
> hopeful. The total now counts only the four tenants that returned cases:
> Palm Beach 649,776, Pasco 513,983, Alachua 108,824, Sumter 108,709.
>
> Note also what a RETURNS row does and does not mean: a successful sampled
> street or parcel query establishes that the adapter can READ that tenant. It
> does not establish complete coverage of every resident or property in it.

**Palm Beach ePZB is built and working.** Our own notes called it "the first
adapter to build". It returns real cases, including "Construction work
without Permits, Struc", for 649,776 residents.

## Three hypotheses, and what the evidence actually did to them

Recorded because each looked right, and because the strength of each refutation
differs. Only the first was actually killed. Saying all three were "killed" was
an overstatement Codex caught in R3-03, and the wording below is what the
observations support rather than what I wanted them to.

1. **"County tenants cannot be read."** From Hillsborough alone. **Refuted.**
   Pasco is a county on the same Enforcement module returning 7 real cases, so
   the universal claim is false. A single counterexample is enough to kill a
   universal, which is why this one is clean.
2. **"The module name is wrong, so Accela serves General Search."** Our own
   notes say a hardcoded `module=Enforcement` was wrong for 17 of 28 agencies,
   so this fit. **Not supported**, and not disproved either. A nonsense module
   returns a DIFFERENT page, so the configured string is RECOGNISED by the
   portal. Recognition is not scope: it does not establish that the module
   serves the code cases we want, and no evidence here does.
3. **"Landing on the General Search form with `ddlSearchType` is the
   failure."** **Not supported.** Pasco works and lands on the identical page
   shape, so that shape alone cannot be the failure. It does not follow that
   submission behaviour is identical: two tenants can render the same form and
   handle a submit differently, and nothing here rules that out.

What later settled the matter was not any of these three. It was reading the
grid as structured cells, which showed the column-name row is not the table's
first row. See the next section. A parser correction working afterwards makes
the parser claim strong; it does not retroactively strengthen the controls
above.

## The Hillsborough fix, and what it unlocked

Fixed and verified live. The grid's column-name row is not the table's first
row, and the address sits in a trailing column whose header cell is blank, so
requiring the literal word "address" to IDENTIFY a grid rejected a page
reading "100+ Record results matching your search".

Re-probed after the fix, the same five tenants:

| tenant | before | after | unincorporated |
|---|---|---|---|
| Hillsborough | RAN_UNPARSED | **RETURNS, 10 cases** | 1,008,349 |
| Seminole | RAN_UNPARSED | **RETURNS, 11 cases** | 224,494 |
| Leon | RAN_UNPARSED | **RETURNS, 5 cases** | 96,029 |
| Lee | RAN_UNPARSED | RAN_UNPARSED | 377,864 |
| Nassau | RAN_UNPARSED | RAN_UNPARSED | 72,807 |

**One parser change unlocked 1,328,872 residents**, taking the working-adapter
total from 1,381,292 to **2,710,164**.

Leon is worth recording against my own earlier reasoning. It was the outlier
with no `ddlSearchType`, which I had treated as a meaningful difference
between the failing tenants. It recovered with everything else, so that
difference was noise.

Lee and Nassau did not recover, so they have a different cause and stay
unexplained rather than being folded into this one. With Miami-Dade that is
1,637,625 residents still failing.

## How the Hillsborough failure was found

Driven directly - navigate to the module page, fill
`input[id*="txtGSStreetName"]` with MAIN, click
`ctl00_PlaceHolderMain_btnNewSearch` - the portal **returns a results grid**.
The adapter, on the same tenant, gets no grid and no explicit empty state.

So the portal works and the adapter's flow is what fails. That is a
reproducible contrast to debug against, and it is the next piece of work. It
is NOT yet a diagnosis, and after three dead hypotheses it will not be called
one until a control confirms it.

## Method limits

- Places are assigned to counties by CENTROID, so a place straddling a county
  line lands wholly in one. Its residents on the other side are then missing
  from that county's municipal subtraction, which OVERSTATES that county's
  unincorporated figure.

  This caveat has now been wrong twice, which is worth recording as a pattern.
  First the doc and the script's comment claimed straddlers were reported when
  only places assigned to no county at all were (Codex R2). Then the
  replacement sampled the four bounding-box CORNERS and claimed that could
  only over-report (Codex R3-01). It cannot: a county can cross the box
  interior without containing a corner, and corner sampling found **zero**
  straddlers on a notch counterexample that genuinely overlapped.

  It now runs a complete box/polygon intersection, which is vertex-in-box,
  edge-crossing-edge, or box-corner-in-polygon, against the place's bounding
  box rather than its outline, so it over-reports rather than under-reports.
  **It finds 90 candidates.** The corner version found 87, so it was missing
  three real Florida straddlers: the flaw was not only theoretical.

  **This means the backlog ordering is NOT safe in the near-tie band.** Alachua
  108,824, Indian River 108,789 and Sumter 108,709 sit 35 and 115 apart, and
  all three are touched: Sumter by Leesburg 27,000, Lady Lake 15,970, Wildwood
  15,730 and Mascotte 6,609; Indian River by Sebastian 25,054; Alachua by
  Newberry 7,342 and four more. The straddling populations dwarf the gaps.

  What is still missing is the SIZE of each error, which needs each place's
  population split by county part. This source does not carry it, so the
  candidate list bounds WHICH counties can move, not by how much. Treat the
  large figures (Miami-Dade, Hillsborough, Orange, Palm Beach, Pasco) as sound
  for prioritisation and anything inside a few thousand residents as a tie.
- The probe's request counter only sees Accela's ASP.NET POSTs. citizenserve
  returned six real cases with zero counted requests, so `ok` from the adapter
  is the signal and the counter is a detail on Accela failures only.
- A READABLE_EMPTY result is readable, not proven: it means the portal held
  nothing on the probed streets.
- Broward and Palm Beach search by parcel key. A street probe against them
  measures nothing, so Broward without a folio is UNPROBED, not failing.
