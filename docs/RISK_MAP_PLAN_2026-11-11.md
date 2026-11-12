# The Risk Map: four pillars on one parcel map

Build plan, 2026-11-11. The question it answers: how to turn four data joins into one map with
layers you can switch on and off, built on code that already exists.

## Decisions, 2026-11-11 (Adrian)

1. **Scope is all of Florida.** Scan the state and store the results. Nothing is sold.
2. **Only confident flags are reported.** Everything is computed and stored with its
   confidence; only rows above a measured threshold surface as findings. QC tightens the
   threshold over time.
3. **Internal use only, for now.** No carrier, city, or third party sees the output until
   that decision is revisited.
4. Pillar C baseline runs on Miami-Dade before June. Agreed.
5. The carrier conversation starts now anyway, in parallel. Agreed.
6. Miami-Dade is the first map; other counties follow the aerial survey. Agreed.

What those decisions change below: Pillar A goes statewide from day one, because the DOR
roll covers all 67 counties and needs no imagery. Imagery pillars stay Miami-Dade until the
county aerial survey (section 4.2) says where else there is a yearly series to read. The
counsel item in 4.4 is deferred while use is internal, with the trigger that revives it
written down.

The one architectural change underneath all four: **today everything runs per address, on demand,
when someone types one in. The map needs every parcel, precomputed, refreshed on a schedule.**
Most of the per-address code becomes the batch worker's inner loop. The parcel universe, the layer
store and the map itself are new.

## 0. What already exists, and where

| Piece | Where | State |
|---|---|---|
| Parcel universe, Miami-Dade | `Homestead Finder/data/hf.db` (SQLite, 2.5 GB, 938,308 parcels from the DOR NAL roll) | Working, **zero git commits** |
| Statewide parcel roll | DOR NAL files per county, all 67, via the floridarevenue SharePoint REST path recorded in `hf/rolls.py` | Known, not ingested beyond Dade |
| Parcel outlines | PA ArcGIS `PaParcelView_gdb` (Dade), FDOR statewide cadastral (`src/lib/counties/statewide-cadastral.ts`) | Working |
| Permit records | 4 live county sources + 36 city adapters (`worker/src/scrapers/`), Playwright, Supabase queue | Working, per request |
| Yearly aerials | Miami-Dade ImageServer 2005 to 2023 at 3 in/px (`src/lib/images/county-aerials.ts`) | Working, Dade only |
| Street view, historical | Google undocumented pano search (`google-historical.ts`), Mapillary (`mapillary.ts`) | Working, per request |
| Vision comparison | `src/lib/series-compare.ts`, `vision-compare.ts`, `aerial-series.ts` with a tuned "what counts as a change" prompt | Working, per request |
| Flood | FEMA NFHL ArcGIS (`src/lib/flood.ts`) | Working |
| DBPR licenses | Lodging extracts (`hf/dbpr.py`); contractor licenses not yet pulled | Partial |
| Verified records | `verified_records` table, signed badge pages | Working |
| Database | Supabase Postgres (PostGIS available, not enabled) | Working |
| Hosting | Next.js on Vercel (app); worker runs wherever `node worker` is started; Airavata DO droplet available | Working |

## 1. Architecture

Three new things, one existing thing repointed.

**1.1 Parcel universe (new).** One `parcel` table in Supabase with PostGIS enabled: `parcel_id`
(the DOR key, county + folio), geometry (outline), centroid, county, municipality (from the parcel
point, never the postal city), year built, stories, land use code, owner mailing state, and the NAL
fields `hf/db.py` already carries. Loaded from the NAL rolls county by county. Start with Dade,
which is already parsed.

**1.2 Layer store (new).** One table, `layer_value`, that every pillar writes into and the map
reads from:

```
parcel_id, layer, value (jsonb), confidence (0 to 1), evidence (jsonb: image urls,
permit ids, record ids, sha256 of captures), computed_at, method_version,
verified_by (engineer id or null), verified_at, verified_value
```

A layer is a name: `roof_age_aerial`, `opening_protection`, `expired_open_permit`,
`milestone_due`, and so on. **A row with `verified_by` null is a lead. A row with it set is the
product.** The map draws both, differently.

**1.3 Batch worker (existing, repointed).** `worker/src/index.ts` already claims jobs from a
Supabase queue and is safe to run as replicas. Add a second job type, `layer_job`, that takes
(parcel_id, layer) and calls the same per-address functions the report uses. The queue is seeded by
a scheduler that walks the `parcel` table. Nothing in the scrapers or the vision code has to change
to become batch; only the thing that calls them does.

**1.4 Map (new).** MapLibre GL in the Next.js app. Parcel outlines as vector tiles (PMTiles
generated from the `parcel` table with tippecanoe, served as a static file, no tile server).
Layers are toggles in a side panel; each toggle colors parcels by that layer's value and
confidence. Click a parcel, get a drawer: every layer value, the evidence images side by side, the
permit timeline, and a **Verify** button that writes `verified_by`. That button is the whole
business: it turns a lead into a signed fact.

## 2. The four pillars

### Pillar A. Records versus records

No imagery, no AI, the cheapest and the first to light up the map.

| Layer | Join | Source status | Buyer |
|---|---|---|---|
| `expired_open_permit` | permits issued, never finaled, past expiry | adapters have status per permit today | owners (closeout letters), title, lenders |
| `milestone_due` | year built + stories + distance to coast | NAL has year built and units; stories needs the PA sketch or the building footprint; coastline distance is PostGIS | HOAs, the firm's own recert line |
| `contractor_vs_license` | permit contractor name and number against DBPR contractor extract | DBPR contractor files not yet pulled; same download pattern as `hf/dbpr.py` | enforcement, buyers |
| `str_vs_license` | DBPR lodging license against homestead and zoning | `hf/dbpr.py` already matches 6,124 active Dade licenses | cities |
| `open_violation` | code case open or fined | PBC and Broward and Dade adapters return cases | buyers, the ATF pipeline |
| `homestead_conflict` | the existing finder's signals | `hf/signals.py` | the PA tips program, already running |

**Build:** load the NAL for all 67 counties into Postgres (one script, `hf/rolls.py` already parses
Dade and the per-county name-order rule it carries is the only thing that varies), pull the DBPR
contractor extract, write six layer jobs. **Two to three weeks.** The milestone layer needs the
statute thresholds read first; `docs/network-rates-2026-11.md` cites F.S. 553.899 but nobody has
re-read it for this purpose.

### Pillar B. Street view versus the wind mitigation form

| Layer | What the model looks for | Source |
|---|---|---|
| `opening_protection` | shutter tracks, accordion boxes, panel brackets, roll-down housings, impact etching where visible, or none | street-level frame facing the house |
| `roof_shape` | hip, gable, flat, mixed, from the aerial, plus the ratio the form asks for | aerial, not street view |
| `roof_cover` | tile, shingle, metal, flat membrane | aerial, confirmed from street |
| `equipment_below_bfe` | condenser, meter, water heater visible at grade, against the FEMA zone and LiDAR ground elevation | street view plus `flood.ts` plus the state LiDAR DEM |
| `flood_vents` | vents present in enclosed areas below BFE, where the zone requires them | street view |

**Build:** a second `SeriesSpec` next to `AERIAL_SPEC` in `aerial-series.ts`, with the wind
mitigation form's own categories as the areas. The vision code is already generic over the spec.
The hard part is not the model, it is the imagery source at batch scale (see section 4).
**Three weeks** after Pillar A, mostly prompt calibration against a labeled sample.

### Pillar C. Imagery over time versus permits

This is the existing `AERIAL_SPEC` comparison, run for every parcel instead of one.

| Layer | Already detected by the current prompt |
|---|---|
| `roof_age_aerial` | yes, "roof replaced" with the year of the change |
| `unpermitted_structure` | yes: addition, pool, patio cover, screen enclosure, shed, fence, driveway, solar |
| `coverage_change` | derivable: new impervious area versus the lot, the 7180 SW 16 St case |
| `post_storm_damage` | **new**: pre-storm frame versus NOAA or FEMA post-event frame |
| `deteriorated_structure` | **new**: an accessory structure visibly failing from above |

**The deteriorated structure layer, in detail.** Gazebos, pool screen enclosures, sheds,
docks, boat lifts, pergolas, carports and seawall caps all fail in ways the aerial shows before
anyone reports them: screen panels missing or a whole enclosure frame down, roof panels gone from
a gazebo or carport, a sagging or partly collapsed shed ridge, dock boards missing or a section
gone, rust bleed on a metal frame, debris where a structure stood. The model gets a third spec
beside the change spec: it looks at the **latest** frame alone and the two before it, and names
the structure, the failure, and whether it is worsening across years. Confidence stays low on
anything under about 8 ft across, and the layer carries a `structure_kind` so docks and seawalls
can be filtered on their own, because in the Keys those are a line of business by themselves.
This is the one layer that is simultaneously a risk flag for a carrier, a code case for a city,
and **a lead for exactly the repair and replacement engineering the firm already does.**

**Build:** the layer job is the existing `compareCountyAerials` with the permit digest from Pillar
A's permit table. The output is already structured. What is new is cost control: 938,308 Dade
parcels times a vision call is too much to run blind. So: a cheap first pass (pixel-level change
detection between two years, a classical image diff, no AI) selects the parcels that changed at
all, and Claude only looks at those. Expect that to cut the vision calls by an order of
magnitude. Use the Anthropic Batch API for the rest; it is half price and this is not latency
sensitive. **Four weeks**, including a measured precision and recall on a hand-labeled sample of
300 parcels, because no flag goes to a carrier or a city without that number.

### Pillar D. Insurers, after the storm, against fraud

The only pillar with no code today, and the one that needs a partner before it needs a line of
code.

| Layer | Join |
|---|---|
| `roof_claim_vs_age` | a roof claimed as storm damaged where the aerial series shows it already aged out, or replaced before the storm |
| `reroof_vs_permit` | a reroof billed to a carrier with no reroof permit |
| `windmit_vs_imagery` | a wind mitigation inspection attesting to features the street and aerial frames contradict |
| `damage_delta` | pre-storm versus post-storm frame per parcel, classified, within days of landfall |

**Build order:** (1) the pre-storm baseline is Pillar C run before June, because post-storm
imagery is only worth something against a before; (2) NOAA and FEMA post-event imagery ingest,
which is a new `HistoricalAerialFrame` source and nothing else; (3) a carrier willing to share
claims on a sample, under an agreement, which is a sales conversation that takes months. Start
that conversation in the first month, not after the code exists. **The code is four weeks. The
carrier is eighteen months.**

## 3. The map

**Stack:** MapLibre GL (free, no Mapbox token), PMTiles for the parcel outlines (one static file
per county, built with tippecanoe from the `parcel` table, regenerated when parcels change),
Supabase for the layer values queried by viewport.

**Screens:**

- **The map.** Parcels drawn as outlines. A side panel lists every layer with a toggle and a
  count. Turning a layer on colors parcels by value, with saturation by confidence and a
  distinct outline for verified rows. Several layers at once stack as an intersection filter
  ("expired permit AND roof older than 15 years AND in VE zone").
- **The parcel drawer.** Click a parcel: address, owner kind (never the name on screen by
  default), every layer value with its evidence images, the permit timeline, the open cases, and
  the Verify button. Verify writes `verified_by`, `verified_at`, `verified_value`, and files the
  evidence to the project Drive folder the way site photos are filed today.
- **Export.** Any filtered set to CSV, and any single parcel to the existing PDF report, which
  already renders most of these facts.
- **Access.** Behind the existing admin auth (`app/admin/`). Not public.

**Build:** two weeks for the map and tiles, one week for the drawer, one week for export and
auth. It can go up after Pillar A alone and grow a toggle each time a pillar lands.

## 4. The constraints that decide whether this works

**4.1 Imagery rights, the biggest one.** Google's Street View and the undocumented pano endpoint
are fine for a per-address report a person asked for. **They are not fine for a precomputed
statewide layer, and the problem is the storing and the bulk querying, not the selling.** Google's
terms bar caching its imagery beyond a short window and bar bulk retrieval, whether or not
anything is resold, so "internal and not for sale" does not clear it. The batch path has to run
on sources you are allowed to store: county aerials (public records, already wired for Dade), the state's aerial
programs, NOAA and FEMA post-event imagery, and Mapillary for street level (documented API, open
license, already in `mapillary.ts`, token needed). Nearmap or EagleView for a commercial
multi-year statewide feed is a contract and a real cost; get a quote in month one. Keep Google
for the on-demand report and the drawer's "look now" view only.

**4.2 Other counties' aerials.** `county-aerials.ts` knows Miami-Dade's eighteen flights. Broward,
Palm Beach and the rest publish their own ImageServers on their own schedules, and some do not
publish at all. A survey of county aerial services is the first research task for going beyond
Dade. Until then the map is a Miami-Dade map, and that is the right first map: best imagery in
the state, the parcel roll already parsed, and the PA's own JSON for live checks.

**4.3 Precision before anyone sees a flag.** Decision 2 says only confident flags are reported.
"Confident" has to be a number, not a feeling: each vision layer gets a confidence threshold set
from its labeled sample so that rows above it hit a stated precision, and that threshold is what
separates a stored row from a reported finding. Internally the map shows every row with its
confidence; the reported list is the filtered view. Every vision layer ships with a measured
precision and recall on a labeled sample, and the labels come from the one source that can produce them: a
person standing at the property. **Every site visit Anthony makes should label the parcel he is
standing on**, whether or not the job asked for it. That is ten minutes per visit and it is the
training signal nothing else can supply.

**4.4 Who owns the record and who may see it.** Decision 3 makes this internal only, which
defers the exposure rather than removing it. Written down so it is not forgotten: parcel data is
public, but a compiled file of owners, flags and risk scores is a data product. **The trigger
that revives the counsel item is the first time any output leaves the firm**, and specifically,
if a carrier ever uses it to decide whether to insure someone, federal consumer reporting rules
can attach. Until then: owner names never render on the map by default, and exports strip them.

**4.5 Cost.** Vision calls dominate. Rough shape for Dade: 938k parcels, two years compared, maybe
one in ten changed at all after the pixel pre-filter, Batch API pricing. Measure it on 1,000
parcels in week one of Pillar C before committing to the full run.

**4.6 Compute.** Vercel cannot run the batch. The worker already runs as a long-lived Node
process; put replicas on the Airavata droplet or a second small droplet, pointed at the same
Supabase queue. Playwright and the vision calls both run fine there.

## 5. Phases

| Phase | Weeks | Delivers |
|---|---|---|
| 0 | 1 | Commit Homestead Finder (done, `1ab0994`). Enable PostGIS. Load the NAL for all 67 counties into Supabase. Build PMTiles per county. Map shows every Florida parcel, no layers. |
| 1 | 2 to 4 | Pillar A, all six layers, statewide where the adapters reach and county-level elsewhere. Map gets its first toggles. Expired open permits is the first list anyone can act on. |
| 2 | 5 to 8 | Pillar C on Dade: pixel pre-filter, vision on candidates, 300-parcel labeled sample, measured precision. Roof age and unpermitted structure toggles. |
| 3 | 9 to 11 | Pillar B: the wind mitigation spec, Mapillary batch, LiDAR for equipment height. Opening protection and roof shape toggles. |
| 4 | 12 to 14 | Parcel drawer with Verify, evidence filing to Drive, CSV and PDF export. |
| 5 | 15+ | Pillar D code: NOAA and FEMA ingest, the three fraud joins. Runs the moment a carrier shares a sample. |
| Parallel from week 1 | | Carrier conversations. Nearmap or EagleView quote. Counsel on data product exposure. County aerial survey for Broward and Palm Beach. |

## 6. The first thirty days, concretely

1. `git init` and commit Homestead Finder. A 2.5 GB database and working code with no commits is
   the single most fragile thing in this plan.
2. Enable PostGIS on the Supabase project. One click.
3. Write `scripts/load-nal.ts` in permit-check: NAL CSV to the `parcel` table, Dade first. The
   parser exists in `hf/rolls.py`; port or call it.
4. Write `scripts/build-tiles.sh`: `parcel` table to GeoJSON to PMTiles with tippecanoe.
5. Add `layer_value` (migration 0009) and the `layer_job` queue type (migration 0010).
6. Pull the DBPR contractor license extract the way `hf/dbpr.py` pulls lodging.
7. Ship the six Pillar A layer jobs and the map with six toggles.
8. Read F.S. 553.899 end to end before the milestone layer is written.
9. Request the Nearmap and EagleView quotes. Open the first carrier conversation.
10. Give Anthony a one-line addition to the site visit checklist: photograph the roof-to-wall
    connection, the opening protection and the roof covering on every visit, and tag the parcel.

**What success looks like at day thirty:** every parcel in Miami-Dade on a map, six layers you can
switch on, and a list of expired open permits you can sell closeout letters against tomorrow.

## Progress log

**2026-11-12, iteration 1 of the Phase 0 loop.** Built and committed in the Homestead Finder repo
(`riskmap/`, commits `6e11687` to `be8cdd7`), not here, because that is where the parcel universe
lives and this machine holds no Supabase credentials. Decisions taken without asking, all recorded
in `riskmap/__init__.py`: local-first SQLite store; free storable imagery only (the Miami-Dade 3 inch
county flights, 2019 against 2023); vision through the claude CLI on the subscription at zero
dollars per parcel; a pixel pre-filter in front of the model; only rows above a measured threshold
reported.

Running: 500 Hialeah 33013 single-family parcels queued, outlines for all 500, frames fetched for
the first 40 and fetching for the rest in the background, the first 40 in front of the model in the
background. The coverage app is up at http://127.0.0.1:8790 (`python3 -m riskmap.app`): every
parcel on Esri imagery coloured by review status, a legend of toggles, and a drawer with the then
and now frames, each finding with its confidence, the PA record link, and Verify, Dismiss and
Re-queue buttons that log a review event.

Measured: the pre-filter's 0.10 threshold sits below this neighbourhood's noise floor (min 0.167,
median 0.328 on 40 parcels), and the three pairs rendered for inspection all show real change
(reroofs, solar, above ground pools), so the threshold is left alone until the model's own
"unchanged" verdicts give a floor to set it from. One validated model call on 371 E 60 St: new
roof 0.85, solar 0.80, above ground pool 0.75, all three visible in the frames; 55 seconds; CLI
cost estimate 0.68 USD, which on the subscription is usage-window load rather than a bill. That
led to the one-run-then-confirm scheme in `vision.py`.

Not yet: permit history per parcel (Hialeah is EnerGov, per-parcel Playwright is too heavy for a
batch and is deferred to on-demand in the drawer), year built from the PA, the labeled QC sample,
and the other Pillar A layers. The 553.899 read is still outstanding.

**2026-11-12, iteration 2 (25 minutes later).** Ten parcels through the model: 4 flagged, 5 low,
2 clear, with findings that match the frames. Two facts that changed the design:

*The pixel pre-filter does not work here.* The two parcels the model called clear had scores of
0.53 and 0.59, inside the flagged range (0.48 to 0.65), and blurring before differencing at four
radii did not separate them. On this housing stock the score measures vegetation, shadows and cars
as much as structure. It is kept as a stored field and no longer gates anything.

*The model is the bottleneck, and sonnet is too expensive to be the screen.* Median 132 seconds and
a CLI cost estimate of 0.66 USD per flagged parcel at three runs. On the subscription that is
usage-window load shared with the Airavata QC swarm, not a bill, but it is finite: one worker would
take 20 hours for the 489 waiting. Haiku screened two clear and two flagged parcels correctly
(rear addition and patio on 350 E 61 St, roof and pool on 371 E 60 St) at 0.04 USD and 23 seconds.
It disagreed on one clear parcel (5510 E 2 Ave, "pool removed 0.95"), which goes in the QC sample.

Pipeline now: haiku screens every parcel once; a parcel it calls clean is stored as
`screened_clear`; sonnet confirms only what the screen saw, two runs that must both agree. Two
workers run at once through an atomic claim, in a stratified order over the score distribution so
the labeled sample spans it. Frames: 500 done, 5,976 more queued and fetching (about 1.5 hours).
Spend to date: zero dollars; CLI estimates total 5.44 USD across the first ten parcels.
