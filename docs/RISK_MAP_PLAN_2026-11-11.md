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

**2026-11-12, iteration 3.** Two workers labeled 30 stratified parcels in 26 minutes. The haiku
screen cleared 21 of 30 at 0.04 USD and about 23 seconds each; sonnet ran on nine and confirmed four
(1 flagged, 3 low), called four clear, and one failed to parse (re-queued). Average cost estimate is
now about 0.14 USD a parcel, down from 0.66. Score against verdict on the sample: nothing found below
0.25 (n=7), four findings at or above (n=22); too thin to gate on, and the gate stays off.

The chained frames run died on "database is locked": the schema DDL ran on every connect, the app
opened a connection per request, and three processes were writing. Fixed (schema only on a new
file, 60 s busy timeout, patient commits, read-only reads in the app) and relaunched; it resumes
whatever frames are missing. Frames on disk 3,907 of about 13,000.

Decision held at two workers, not three: the subscription is shared with the Airavata QC swarm and
with Adrian's own sessions, and a usage-window limit would stall all of them. At the measured rate
the zip code takes about four days of background screening. Spend to date: zero dollars; CLI
estimates 9.41 USD across 38 parcels.

**2026-11-12, iteration 4, the first eyes-on QC.** The held-transaction fix held: zero lock errors
across a full cycle, 73 parcels screened and 13 confirmed by two workers, frames at 7,072. Cost
estimates this cycle: screens 1.47 USD, confirms 6.36 USD.

All eight flagged parcels were rendered as 2019/2023 pairs with the lot outline and read by eye.
**Eight of eight are real changes**: an in-ground pool with new pavers at 271 E 55 St (0.93), an
above-ground pool at 180 E 53 Ter (0.90, the model called it in-ground), a pool removed at 331 E 56
St, reroofs at 350 E 61, 360 E 55, 4990 E 2 Ave and 91 E 53 Ter, and solar plus a reroof at 371 E
60 St. Marked verified through the app's own review endpoint with the reviewer named, so the
provenance says who looked. Precision on reported flags is 8/8 on this sample; it is a small
sample and it stays in the log as such.

The four parcels where sonnet overruled haiku were also read: sonnet was right each time. Haiku took
a neighbour's new roof for the subject's at 121 E 56 St (0.70) and reported solar at 0.90 on 241 E
57 St where there is none. The confirm step is necessary. The unmeasured side is the parcels haiku
cleared that sonnet never saw; a random sample of eight is rendered for the next read.

**2026-11-12, iteration 4 continued.** Eight haiku-cleared parcels read by eye: six unchanged, one
plain miss (321 E 58 St, an above-ground pool gone between the flights), one borderline reroof
(341 E 59 St). The screen hands off to sonnet at 0.35 now instead of 0.5, and one in ten parcels
haiku clears gets a sonnet look regardless, stored as an `audit` row; that row is where the screen's
miss rate is measured from now on.

First Pillar A integration: the drawer can fetch a parcel's city code cases on demand through the
permit-check worker's EnerGov adapter (`worker/src/riskmap-cases.ts`, branch `claude/riskmap-cases`,
checked out in the working tree so the app can call it; not merged to main). Proven live: 135 W 60
St returns BWOP-001873-2025 at status Lien in 18 seconds; 271 E 55 St, the new in-ground pool,
returns no case. The adapter searches the Code Case module only, so the drawer says so and does
not pretend an empty permit list means no permits. Reading the permit module is the next Pillar A
build.

**2026-11-12, iteration 5.** Six new flags read by eye, six confirmed: reroofs at 150 E 55 St,
310 E 54 St, 320 E 57 St, 5195 E 1 Ave and 5750 E 3 Ave (under a blue tarp in 2019, new roof by
2023), and solar on a reroofed house at 5680 E 2 Ave. **Fourteen of fourteen reported flags have
matched the photos.** All marked verified with the reviewer named.

With the hand-off at 0.35 haiku now sends 57 percent of parcels to sonnet, and the cumulative CLI
cost estimate is 32.84 USD after 136 labeled parcels, about 0.30 USD a parcel. Projected for the
whole zip code: roughly 1,900 USD of estimated usage over about four days, which is subscription
load rather than a bill, shared with the Airavata QC swarm and Adrian's own sessions. The two
workers stop with one command if his sessions slow:
`pkill -f "riskmap.scan --vision"`. Restart: two copies of
`python3 -m riskmap.scan --vision 100000 --order stratified` from the Homestead Finder repo.

About four percent of sonnet confirm replies failed to parse; each run now retries once and the
extractor tolerates prose around the JSON. Three error parcels re-queued. The audit row count is
one so far (sonnet disagreed), too few to quote a miss rate.

This log is being committed on branch `claude/riskmap-cases` while the worker tree stays on it for
the drawer's code-case lookup; main's copy is behind until that branch merges.

**2026-11-12, iteration 6 (01:45).** The frame run for the rest of 33013 finished: 5,975 parcels
fetched, one left behind and re-fetched by hand, 12,951 frames on disk, 6,268 parcels queued as
candidates. Nine new flags read by eye, nine confirmed: above-ground pools at 291 E 55 St and
725 E 21 St, a full rebuild at 891 E 20 St (flat patched roof to a new peaked shingle roof and
paver drive), reroofs or roof changes at 40 E 53 Ter, 1801 E 6 Ave (white seamed surface, tarp or
membrane), 520 E 49 St, 520 E 61 St and 401 E 52 St, and a new solar array at 370 E 58 St.
**Twenty-three of twenty-three reported flags have matched the photos.** All marked verified with
the reviewer named.

The audit rows now say something. Three haiku "clean" screens were re-read by sonnet: two hid a
reroof sonnet saw (0421310160270 at 0.75, 0431060650310 at 0.55) and one agreed. Both misses had
haiku saying Roof SAME at 0.80; the agreed clear said 0.95. Lowering the hand-off threshold would
not have caught them, because haiku called the roof unchanged, so vision v4 adds a roof rule: a
haiku Roof SAME under 0.85 hands the parcel to sonnet anyway. On the 180 roofs screened so far that
is about 19 percent more hand-off. The audit rate is raised from 10 to 20 percent so the miss rate
gets measured faster. The 15 screened-clear parcels the rule would have caught were re-queued, with a
`requeue` layer row saying why. Workers restarted on v4 (Homestead Finder commit 83c69b7).

Measured per model from the evidence rows: haiku screen 0.036 USD and 22 seconds a parcel; sonnet
two-run confirm 0.50 USD and 153 seconds. Cumulative CLI cost estimate 60.13 USD after 217 labeled
parcels, about 0.28 USD a parcel. A single sonnet run as the screen would cost about the same per
parcel (0.25 USD plus a second run on the third that see something) and read roofs better; that is
the fallback if the v4 audit rows still show misses after a few hundred more parcels.

**2026-11-12, iteration 7 (02:50).** Eighteen new flags read by eye, eighteen confirmed: new
above-ground pools at 380 E 56 St, 3421 E 9 Ln (where a trampoline stood) and 474 E 46 St, a new
in-ground pool with deck behind a reroofed 872 E 29 St, tarps over roofs at 240 E 39 St, 1 E 52 Pl
and 3381 E 8 Ave, a front yard paved over at 554 E 29 St, and reroofs or roof material changes at
565 E 32 St, 309 E 41 St, 241 E 53 St, 450 E 44 St, 952 E 31 St, 859 E 23 St, 520 E 45 St,
511 E 56 St, 760 E 37 St and 454 E 45 St. **Forty-one of forty-one reported flags have matched the
photos.** All marked verified with the reviewer named.

The haiku screen is retired. After the v4 roof rule, sonnet re-read four more haiku clears and found
a change in two (0.70 and 0.65), so four of seven audits overall; meanwhile haiku was already handing
off 64 percent of parcels. A screen that passes most parcels through and still misses half of what it
clears is not a screen. Vision v5 (Homestead Finder commit 82e575d) makes sonnet the screen: one run
on every parcel, and that run doubles as confirm run 1, so a parcel that shows something costs one
more run, not two. A sonnet clear is still audited at 20 percent with a second run; disagreement adds
a third and the two-of-three merge decides. Haiku screening stays available behind
`RISKMAP_SCREEN_MODEL=haiku`. Expected per parcel: about 0.25 USD plus a second run on the third
that show something, about 0.34 USD, against 0.29 USD measured on the haiku path; time about 100
seconds a parcel against 120. Workers restarted on v5.

Cumulative CLI cost estimate 83.49 USD after 292 labeled parcels. Queue: 6,186 candidates.

**2026-11-12, iteration 8 (04:10).** Vision v5 after its first hour: 73 parcels screened by sonnet,
43 showed something at 0.5 or more, 13 flagged, 21 flagged low, 30 clear. Audit disagreement fell to
1 of 8 (from 4 of 7 under haiku); that one, a roof at 0.55, lost the two-of-three vote and ended
clear. Measured: a clear parcel 0.21 USD and 54 seconds, a confirmed one 0.43 USD and 116 seconds,
blended about 0.34 USD; 80 parcels an hour on two workers. One parcel went to error because the
screen run had no parse retry (the reply was prose, not JSON); fixed, re-queued, workers restarted.
Fifteen new flags read by eye, fifteen confirmed (five new pools, a tarp replaced by a new roof at
5420 E 6 Ave, the rebuild at 897 E 20 St next to 891, and eight roof changes). **Fifty-six of
fifty-six reported flags have matched the photos.**

The permit module is now read. The riskmap lookup script runs the code-case search as before and
then a second search on the same page in EnerGov's Permit module (2), reading the portal's own XHR
answer and the parcel number it carries. permitsChecked is true only when the answer parsed and
carried a PermitsFound count. Verified live: 891 E 20 St returns four permits (a 2025 pool, 2024 and
2025 pavers, 2025 pool electrical, parcel 0431080024815); 40 E 53 Ter (a confirmed reroof) and
135 W 60 St (the lien case) return PermitsFound 0. **Every permit returned so far was applied for in
2024 or later**, so the drawer says plainly that earlier work may be permitted in the city's prior
system, which this lookup does not read; an empty list is never shown as "no permit". A batch
lookup is running for the 57 verified and flagged parcels, one at a time with a pause. Next tick
reads the flag-versus-permit matches.

Cumulative CLI cost estimate 112.84 USD after 367 labeled parcels. Queue: 6,106 candidates.

**2026-11-12, iteration 9 (05:20).** Fourteen new flags read by eye, fourteen confirmed (thirteen roof
changes, one with a new solar array at 521 E 45 St, and a side yard paved to the street at
5330 E 6 Ave). **Seventy of seventy reported flags have matched the photos.** The v5 audit now has 15
rows: six second runs saw something the first run had not, all at 0.5 to 0.55; the third run kept four
of them as flagged low (0.4 to 0.68 merged) and dropped two. None reached the 0.75 report line, so no
reportable flag has been lost to the single-run screen in this sample.

The permit batch finished for all 56 verified parcels. Against EnerGov: 10 flags fully match a
permit, 4 partly, 41 have no matching permit, 1 lookup did not parse. That 41 is NOT a finding.
Hialeah's EnerGov holds permits only from about February 2023, and the work in this pair happened
between the 2019 and 2023 flights. The city's older permit history is not online: the Building
Department's Microfilm and Records page offers plans and index cards 1944 to 1996, trade records
2004 to present and paper plans 1996 to present by request, one form per address, 15 USD for a
single-family house, 45 USD otherwise, requested through the same Citizen Self Service portal
(hialeahfl.gov/659/Microfilm-and-Records, read 2026-11-12). So a 2019 to 2023 flag in Hialeah
closes only with a 15 USD records request.

The scan therefore moves to a pair the permit system covers. The county image server lists
Woolpert2024, Woolpert2025 and Woolpert2026 (0.25 ft pixels); all three return imagery at
891 E 20 St. A second database, `data/riskmap_2023_2026.db`, was seeded from the first (same 6,476
parcels, outlines and 2023 frames) and the 2026 frames are fetching, about two a second. When they
land, both workers move to 2023 versus 2026 and every flag gets the EnerGov lookup, which now covers
the whole window. The flight month is not in the service metadata; it is needed before dating work
against a permit's apply date, and is the next thing to source. Pair-1 results stay as a 500-parcel
labeled set that proved the vision step.

One database per pair is a deliberate shortcut: the proper fix is a pair column on scan_parcel, due
with the consolidation. The app reads `RISKMAP_DB` and `RISKMAP_PORT`; pair 1 on 8790, pair 2 on
8791, header shows the flights.

Cumulative CLI cost estimate 149 USD after 446 labeled parcels, 0.33 USD a parcel.

**2026-11-12, iteration 10 (06:10).** The 2026 frames landed for all 6,476 parcels (0 errors) and the
prefilter queued every one of them in the second database. Both workers moved from the 2019 to 2023
pair to 2023 versus 2026 at 06:05; the first pair stops at 514 labeled parcels. Four random 2026
frames read by eye: same georeferencing as 2023, a little hazier, nothing missing. Thirteen more
pair-1 flags read by eye, thirteen confirmed (two tarped roofs, a solar array over a former paved
court at 468 E 50 St, a round pool replaced by a rectangular one at 651 E 50 St, nine roof changes).
**Eighty-three of eighty-three reported flags have matched the photos.** Their permit lookups are
running.

A race was closed before it could bite: a frame pass sets each parcel back to "frames" when it
reaches it, from a row list read at the start of the pass, so a worker that had already carried the
parcel to a verdict would have been undone. The pass now only resets a parcel still waiting for
frames (Homestead Finder 2e2e30c). Vision and fetching can overlap from here on.

Pair 1 cumulative CLI cost estimate 175.32 USD after 514 labeled parcels, 0.34 USD a parcel.
Pair 2 starts at zero; its flags are the first that the EnerGov lookup can close.

**2026-11-12, iteration 11 (07:25).** The loop closes end to end for the first time. Pair 2
(2023 versus 2026) in its first hour: 69 parcels labeled, 14 flagged, 17 flagged low, 38 clear, six
audits with no disagreement, 0.41 USD a parcel (more parcels show something across this window).
All fourteen flags read by eye, fourteen confirmed: new solar arrays at 393 E 51 St and 633 E 45 St,
a new pool with paved surround at 420 E 61 St, the round pool at 725 E 21 St gone again, a tarp at
226 E 44 St, a paver courtyard at 4795 E 9 Ct, and eight roof changes. **Ninety-seven of
ninety-seven reported flags have matched the photos.**

Their EnerGov lookups are running, and the drawer now carries a permit-match row per finding: the
matching permit with its number, type, apply date and status, or "no matching permit on this portal
since 2023" in red. The row says whether the pair's window lies inside the portal's records, so a
gap on pair 1 reads as not determinable while a gap on pair 2 reads as a lead. First four results:

- 393 E 51 St: re-roof RFR-005130-2023 (applied 2023-10-04, Complete) and solar
  ELER-012132-2024 (applied 2024-05-13, Complete). Both findings permitted. Not a lead.
- 4795 E 9 Ct: pavers BLDR-002641-2025 (applied 2025-03-20, Complete). Permitted.
- 581 E 54 St: five permit records. The first re-roof permit RFR-004884-2023 is Void (description
  "Legalization"), but RFR-005350-2023 (applied 2023-10-11, finaled 2023-12-18) is Complete, so the
  roof is permitted. The first draft of this entry called the parcel open on the void permit alone
  because the summary script read only the first match; the drawer reads all of them. A void,
  denied, withdrawn, expired or revoked permit no longer closes a finding on its own.
- 633 E 45 St: re-roof RFR-000566-2026 applied 2026-01-22, Complete; the solar array has no permit
  on the portal since 2023. Lead.

Two things the apply dates make urgent. First, the flight date: a roof permitted 2026-01-22 that
already shows new in the 2026 flight is either an after-the-fact permit or a flight flown later in
January; the county flies late December to January but the 2026 dates are not published in the
service metadata and the SFWMD mosaic metadata that lists dates needs a token. Second, a permit
match is by type and date, not by proof that the permitted work is the work seen; a re-roof permit
in 2023 and a different roof in 2026 could be two jobs. Both are stated in the drawer wording.

Pair 1 closed at 175 USD for 514 labeled; pair 2 at 28 USD for 69.

**2026-11-12, iteration 12 (08:25).** The full permit readout for the first fourteen pair-2 flags:
17 findings at the report line, 11 matched by a completed permit (every one a re-roof, plus the
solar at 393 E 51 St and the pavers at 4795 E 9 Ct), 6 without. Of the six, three are leads: a new
pool with paved surround at 420 E 61 St (one code case on file), a roof at 476 E 62 St (one code
case), and the solar array at 633 E 45 St. The other three are not permit work: a tarp at 226 E 44 St
(damage cover), and the above-ground pool gone at 725 E 21 St. The drawer now says so: a tarp reads
as "a damage cover, not permit work", a removal as "an above-ground pool or shed can go without a
permit, a demolition of a built structure cannot". Eleven permitted re-roofs is also an independent
check on the detector: the city issued permits for the roofs the model said had changed.

Ten more flags read by eye. Nine confirmed (two tarps replaced by finished roofs at 854 E 33 St and
485 E 39 St, a tile roof now under a solar grid at 6120 E 4 Ave, six roof changes). The tenth,
972 E 18 St, was flagged for a new in-ground pool; the parcel line drawn over the 2026 frame puts
that pool on the lot behind. **First false flag: 106 of 107 reported flags have matched the photos.**
The parcel is marked dismissed with the reason.

The miss is structural, not random: the prompt tells the model to judge only inside the lot, but
the frames never showed the lot line. Vision v6 draws the parcel outline on a copy of each frame
(magenta, 3 px) and the model reads those; the prompt names the line and says a pool, shed, roof or
deck outside it belongs to a neighbour. The drawer shows the same outlined frames, so a reviewer
sees the boundary the model saw. Workers and both apps restarted on v6 (Homestead Finder).

Pair 2: 122 labeled, 0.40 USD a parcel, 14 audits with 3 second-run disagreements (none reached the
report line). Pair 1 stays at 514 labeled. Permit lookups for the new flags are running.

**2026-11-12, iteration 13 (09:20).** First hour of vision v6, with the parcel line drawn on the
frames: 54 parcels labeled, 11 flagged, 18 flagged low, 25 clear, four audits with one second-run
disagreement. Fifteen flags read by eye on the outlined frames, fifteen confirmed, every finding
inside its own line: new in-ground pools at 729 E 23 St (with a reroof) and 751 E 56 St, an
above-ground pool at 580 E 29 St, solar arrays at 398 E 56 St and 5350 E 3 Ave, a rear addition at
4635 E 4 Ave, tile to standing-seam metal at 2675 E 7 Ave, and eight more roof changes. **121 of 122
reported flags have matched the photos.** The outline makes the lot question disappear for the
reviewer as well as the model.

Permit readout for all 23 pair-2 parcels verified before this hour: 23 permit-type findings, 16
covered by a completed permit, 7 without a live one on 5 parcels. Leads: the pool and patio at
420 E 61 St, the roof at 476 E 62 St, the roof at 6120 E 4 Ave (its only roofing permit is Denied,
and the roof now carries a solar grid), the solar at 633 E 45 St, and the roof at 698 E 32 St. The
drained pool at 485 E 39 St is a condition, not work. A tarp now counts as a damage cover only when
it is in the later photo; a tarp in 2023 followed by a new roof in 2026 is permit work and is
matched like any reroof (854 E 33 St was being excused by the first rule).

Pair 2: 199 labeled, 77 USD, 0.39 USD a parcel. Lookups for the fifteen new flags are running.

**2026-11-12, iteration 14 (10:20).** Fifteen flags read on the outlined frames, fifteen confirmed
(a solar array at 991 E 32 St, a reroof in progress with felt and materials on the roof at
64 E 48 St, a round pool gone and the area paved at 547 E 30 St, twelve roof changes). **136 of 137
reported flags have matched the photos.** Pair 2: 261 labeled, 104 USD, 0.40 USD a parcel, six v6
audits with one second-run disagreement.

Permit tally across the 38 verified pair-2 parcels with lookups: 41 permit-type findings, 16
without a live permit, on 13 parcels. By kind: roofs 8 of 29 open, solar 1 of 4, pools 5 of 5,
rear addition 1 of 1, patio 1 of 1, driveway 0 of 1. Every new pool found so far has no pool permit
on the portal, including two in-ground pools with decks (729 E 23 St, also reroofed without a
permit, and 751 E 56 St). The roof figure says the opposite: the city has permits for 21 of the 29
roofs the model said had changed, which is the same independent check as before, now on a larger
set. The parcels with a lead: 1012 E 20 St, 322 E 43 St, 371 E 58 St, 420 E 61 St, 4635 E 4 Ave,
476 E 62 St, 485 E 39 St, 580 E 29 St, 6120 E 4 Ave, 633 E 45 St, 698 E 32 St, 729 E 23 St,
751 E 56 St. The permit match is by type and date, and a lead here means "no live permit of that
type on this portal since 2023", nothing more; the flight month and the prior-system caveat still
apply.

Since above-ground and in-ground pools are different leads, the model is now asked to say which
in its pool note (vision v6.1). Lookups for the fifteen new flags are running.

**2026-11-12, lead sheet (11:05).** First deliverable from the scan: a Palma-branded lead sheet,
one page per lead parcel, built by `riskmap/lead_sheet.py` (Homestead Finder) from the pair-2
database and saved outside both repos at
`~/Documents/Claude/Projects/PALMA, LLC ONBOARDING/Risk Map/CURRENT_v01_HIALEAH_33013_RISKMAP_LEAD_SHEET_2023v2026.pdf`
(18 pages, 5.3 MB). Each page: the outlined 2023 and 2026 frames, every finding at 0.5 or more with
its confidence and permit outcome, the permits the portal returned with status (void or denied in
bold), the code cases, a one-paragraph "why this is a lead", the flight-month and prior-system
caveats, and the Property Appraiser link. No owner is named. Eighteen leads, not thirteen: the set
grew as the last fifteen lookups finished, and two rules tightened while building it. A drained pool
is a condition, not permit work (485 E 39 St keeps only its roof lead); a tarp is read inside its
own clause, so "now covered by a tarp-like surface" at 230 E 53 St is a damage cover and drops out;
and a pergola, aluminum terrace, screen or carport roof permit no longer covers a house-roof finding
(451 E 19 St's Denied "Aluminum Roof/Pergola" permit is for a terrace; its tile-to-shingle reroof has
no permit at all, and a Building Without A Permit notice for "Fence and Aluminum Roof" is already on
file). The drawer applies the same three rules.

**2026-11-12, iteration 15 (11:25).** Sixteen flags read on the outlined frames, fifteen confirmed:
two in-ground pools with decks (633 E 22 St, 571 E 35 St), a structure built over a former pool and
deck at 636 E 28 St, a rebuild at 1825 E 7 Ave, a blue metal panel roof at 769 E 53 St, and ten
more roof changes. The sixteenth, 891 E 20 St, is the second false flag: the 2023 roof is already
the same dark shingle hip the 2026 photo shows, so the model's "tile to charcoal" reading is wrong
(a rear gabled structure it also saw sits below the report line). Dismissed with the reason.
**151 of 153 reported flags have matched the photos.** Pair 2: 322 labeled, 129 USD, 0.40 USD a
parcel, ten v6 audits with two second-run disagreements. Lookups for the new flags are running.

Earlier today (11:05) the lead sheet shipped, and the map app gained a ranked leads panel
(`/api/leads`, the LEADS button): value order in-ground pool, roof, solar, addition; lead parcels
glow gold on the map; a click flies to the parcel and opens its drawer. The panel refreshes itself
as lookups land. Both apps restarted (Homestead Finder d767db8).

**2026-11-12, walk order (12:00).** The leads panel now orders leads for a field walk. Inside each
kind (in-ground pool, roof, solar, addition, then the rest) three signals each add two points: a
denied, void or revoked permit on the parcel since the earlier flight year, an open code case (any
status not complied, closed, resolved, void, dismissed or rescinded), and a reroof caught in progress
(felt, underlayment, materials or workers in the later photo). Confidence breaks ties. Each lead
has a "Mark as walked" button that records the date, the walker's name (asked once, remembered on
that browser) and a one-line note as a `walked` layer row and a review event; walked leads sink to
the end of the list and show the note. Status is untouched by a walk. 22 leads at the time of
writing; 451 E 19 St tops the roofs with both a denied permit and an open Building Without A Permit
case (Homestead Finder, app commit after d767db8).

**2026-11-12, iteration 16 (12:25).** Twenty flags read on the outlined frames, twenty confirmed:
an in-ground pool with a raised spa and paver deck plus a reroof at 30 E 62 St, four above-ground
pools (268 E 62 St, 630 E 64 St, 581 E 44 St, 436 E 19 St), a solar array at 35 E 45 St, a roof
that was entirely under a blue tarp in 2023 and is re-roofed by 2026 at 4250 E 8 Ln, and thirteen
more roof changes. **171 of 173 reported flags have matched the photos.** Pair 2: 392 labeled,
157 USD, 0.40 USD a parcel, 17 v6 audits with three second-run disagreements. Lookups for the
twenty are running; the leads panel will pick them up on its own.

**2026-11-12, iteration 17 (13:25).** Fifteen flags read on the outlined frames, fifteen confirmed:
four in-ground pools demolished since 2023 (41 E 52 Pl with its shed, down to a rubble pile;
925 E 30 St; 940 E 20 St; 713 E 22 St), the north half of 671 E 62 St built out under a new roof
with the house reroofed in metal, a solar array at 4569 E 9 Ln, a fire-damaged roof under a cover
at 727 E 26 St, and eight roof changes. **186 of 188 reported flags have matched the photos.**

The removal rule was too kind. It excused every REMOVED finding as "an above-ground pool or shed
can go without a permit", which is true of a ring on the grass and false of a built pool. A
removal whose note says in-ground, demolition, rubble, debris, coping or concrete deck is now
permit work, matched against a demolition permit or one of its own type, in the sheet and the
drawer. The four demolished pools will show as leads once their lookups land unless the city has
a demolition permit for them.

Pair 2: 448 labeled, 188 USD, 0.42 USD a parcel; 22 v6 audits, four second-run disagreements, none
at the report line. 31 leads on the panel before this batch (4 in-ground pools, 20 roofs, 1 solar,
1 addition, 5 above-ground pools), none walked yet.

**2026-11-12, iteration 18 (14:25).** Thirteen flags read on the outlined frames, thirteen
confirmed: another in-ground pool demolished and paved over for parking at 3661 E 6 Ave, a mid-lot
roof structure gone at 915 E 19 St, solar arrays at 4460 E 4 Ave and 4984 E 8 Ct, a front yard
turned parking pad at 668 E 19 St, and eight roof changes. **199 of 201 reported flags have matched
the photos.** The demolition rule is doing its job: the five demolished in-ground pools now sit in
the leads panel as in-ground pool leads, two of them with open code cases on the parcel
(713 E 22 St, a Building Without A Permit case; 41 E 52 Pl). 41 leads on the panel: 10 in-ground
pool, 24 roof, 1 solar, 1 addition, 5 above-ground pool. Pair 2: 507 labeled, 214 USD, 0.42 USD a
parcel, no errors. Lookups for the thirteen are running.

**2026-11-12, iteration 19 (15:25).** Twelve flags read on the outlined frames, twelve confirmed: a
new in-ground pool with coping at 571 E 46 St, a dirt drive paved into a circular driveway at
651 E 53 St, two above-ground pools gone, and eight roof changes (three to metal). **211 of 213
reported flags have matched the photos.** 46 leads on the panel (11 in-ground pool, 27 roof,
1 solar, 1 addition, 5 above-ground pool, 1 other), none walked. Pair 2: 564 labeled, 237 USD,
0.42 USD a parcel; 27 v6 audits, five second-run disagreements, none at the report line. Lookups
for the twelve are running.

**2026-11-12, iteration 20 (16:25).** Nineteen flags read on the outlined frames, eighteen
confirmed: two solar arrays (442 E 45 St, 556 E 41 St), an in-ground oval pool and deck demolished
at 961 E 45 St, a roof wrapped in white shrink-tarp in 2023 and finished by 2026 at 790 E 31 St,
three above-ground pools gone, and eleven roof changes. The nineteenth, 962 E 28 St, is the third
false flag: the roof went from clean white to stained and streaky, which is weathering, and the
model called it CHANGED against its own shade rule. Dismissed with the reason. **229 of 232
reported flags have matched the photos.** So that a roof that merely got dirtier can never read as
a permit gap, a Roof CHANGED whose note says it went to a mottled, streaked, stained, dirty,
weathered, faded, discoloured, moldy or rusty surface is now a condition in both the sheet and the
drawer (tested against four real notes; the three genuine reroofs still match). 52 leads on the
panel before this batch. Pair 2: 630 labeled, 269 USD, 0.43 USD a parcel, no errors. Lookups for the
eighteen are running.

**2026-11-12, iteration 21 (17:25).** Fourteen flags read on the outlined frames, fourteen
confirmed: a solar array on a rear flat roof at 642 E 24 St, two tarped or shrink-wrapped roofs
finished by 2026 (279 E 49 St, 1801 E 6 Ave, the latter a pair-1 flag whose tarp has now become a
roof), two new driveways, two above-ground pools, and seven more roof changes. **243 of 246 reported
flags have matched the photos.** 57 leads on the panel before this batch (12 in-ground pool, 35
roof, 2 solar, 1 addition, 5 above-ground pool, 2 other), none walked. Pair 2: 697 labeled, 293 USD,
0.42 USD a parcel, no errors; 36 v6 audits, five second-run disagreements, none at the report line.
Lookups for the fourteen are running.

**2026-11-12, iteration 22 (18:25).** Thirteen flags read on the outlined frames, thirteen
confirmed: a new in-ground pool with deck at 80 E 60 St, a tarped roof from pair 1 now finished at
3421 E 8 Ave, and eleven more roof changes (one to white corrugated metal, one to terracotta tile).
**256 of 259 reported flags have matched the photos.** 65 leads on the panel before this batch
(12 in-ground pool, 40 roof, 2 solar, 1 addition, 7 above-ground pool, 3 other), none walked.
Pair 2: 773 labeled, 316 USD, 0.41 USD a parcel, no errors. Lookups for the thirteen are running.
