# Deep-Scan Worker

A long-running agent that pulls **full permit + code-violation history** for a
property by driving a real headless browser through the county's portals — for
the counties where the instant API path can't reach the records. It's decoupled
from the web app: the app enqueues a job, this worker processes it (taking as
long as it needs), and emails the results.

```
 Web app (Vercel)                Supabase Postgres            This worker (always-on)
 ────────────────                ─────────────────            ───────────────────────
 POST /api/deep-scan  ──enqueue──►  scan_jobs (queued)  ──claim──►  Playwright scrape
   { email, address }                                                 │
                                                          email ◄──────┘ (Resend)
                                    scan_jobs (done) ◄──update──────────┘
```

## Why a separate worker?

Vercel serverless functions cap at 60s and can't keep a browser open. Scraping a
county portal (navigate → search → paginate → read) can take minutes. So the
scrape runs here, on an always-on host with a real Chromium, and the result is
**emailed** rather than returned in the HTTP request.

## How it works

- **Queue:** `scan_jobs` table in the same Supabase project the app/ledger use.
  Claiming is atomic via the `claim_scan_job()` SQL function (`FOR UPDATE SKIP
  LOCKED`), so you can run several worker replicas safely.
- **Scrape:** `src/scrapers/` — a generic engine (`generic.ts`) drives each
  county's search form (`counties.ts`) and reads the results table. It **degrades
  safely**: if a portal can't be read, the email still goes out with direct
  portal links and a clear note — it never invents records.
- **Email:** Resend (`src/email.ts`), formatted by `src/report.ts`.
- **Retries:** up to `max_attempts` (default 3); on final failure the requester
  still gets a graceful "couldn't complete, here are the links" email.

## One-time setup

### 1. Run the migrations (queue + result cache)
Against the same database as `SUPABASE_URL` (Supabase SQL editor or psql):
```
-- paste migrations/0001_scan_jobs.sql       (queue)
-- paste migrations/0002_portal_results.sql  (result cache)
```
`portal_results` caches every **successful** scrape (keyed by folio, else
normalized address). Repeat lookups and — once wired in Phase 3 — the instant
`/api/check` report reuse it instead of re-driving the portal. Misses are never
cached, so a transient failure can't suppress a future scrape.

### 2. Set env (see `.env.example`)
```
SUPABASE_URL, SUPABASE_SECRET_KEY     # same project as the app/ledger
RESEND_API_KEY, RESEND_FROM           # email delivery (verify your sender domain)
```
The Vercel **app** also needs `SUPABASE_URL` + `SUPABASE_SECRET_KEY` set (it
already does if the ledger is enabled) so `/api/deep-scan` can enqueue.

### 3. Deploy the worker (pick one — it's just a Docker container)
- **Render:** New → **Background Worker** → point at this repo, root dir `worker/`,
  it auto-detects the `Dockerfile`. Add the env vars. (Most robust default.)
- **Railway:** New service from repo → set root to `worker/` → add env vars.
- **Fly.io:** `fly launch` in `worker/` (uses the Dockerfile), `fly secrets set …`.
- **Any Docker host:** `docker build -t pc-worker worker/ && docker run --env-file worker/.env pc-worker`

The image is based on `mcr.microsoft.com/playwright`, so Chromium + OS deps are
already present — no extra browser install step.

## ⚠ Calibration (do this once per county after deploy)

The search URLs/selectors in `src/scrapers/counties.ts` are best-effort starting
points. County portals change; confirm them against the live sites with a real
browser:

```
HEADLESS=false npm run calibrate -- "1450 Collins Ave, Miami Beach, FL 33139" miami-dade
npm run calibrate -- "<a real Broward address>" broward
npm run calibrate -- "<a real Palm Beach address>" palm-beach
```

Watch which input/submit selectors hit, check the printed result, and tighten the
arrays in `counties.ts`. Until a county is calibrated, its emails degrade to
portal links (correct, just not auto-filled) — never wrong data.

## Run locally
```
cp .env.example .env   # fill in values
npm install
npx playwright install chromium   # only needed outside the Docker image
npm start
```

## Architecture: scrape by platform, not by city
Most Florida jurisdictions run one of a few permitting products. The worker is
organized around that:

- `src/scrapers/jurisdictions.ts` — the registry. Each county (later: city) maps
  to a **platform** (`accela` | `generic`) + its config. Accela entries just carry
  an **agency code** (the path segment in `aca-prod.accela.com/<AGENCY>/`), so
  adding an Accela jurisdiction is one line.
- `src/scrapers/accela.ts` — the Accela Citizen Access flow (search street no/name
  → read the results GridView → map columns). Covers Broward + Palm Beach today;
  every other Accela agency is a registry entry away.
- `src/scrapers/generic.ts` — the original best-effort form engine, used for
  non-Accela portals (currently Miami-Dade EPS). Configs live in `counties.ts`.
- `src/scrapers/index.ts` — dispatch: resolve jurisdiction → run its platform flow.

Both flows **degrade safely** — an uncalibrated selector yields a "use the link"
email, never wrong data.

## Supported jurisdictions
Palm Beach (ePZB, `src/scrapers/pbc.ts`), Broward (Posse/BCS,
`src/scrapers/broward.ts`), Miami-Dade (generic/EPS; permits also covered
instantly by the app API). Others get a graceful "not yet automated + statewide
lookup link" email.

**Add an Accela agency:** confirm its code by opening `aca-prod.accela.com/<AGENCY>/`
and checking it returns 200 with that agency's real name — the national host
answers for every Accela customer in the country, so a code that merely resolves
proves nothing about which state you reached. Then add an entry to
`JURISDICTIONS` and calibrate.

### Palm Beach County (ePZB)
Palm Beach does **not** run Accela. The registry used to point it at
`aca-prod.accela.com/PBC/`, which 404s; that code came from a commercial
aggregator's coverage page and was never real. The county runs ePZB, with two
free searches that need no account, both keyed by PCN (its parcel number):

| | |
|---|---|
| code cases | `pbc.gov/iPZB.CodeCompliance.Service/search` |
| permits | `pbc.gov/iPZB.Building/guest/searchpermits` |

Two things decide whether this adapter is honest:

1. **ePZB covers unincorporated Palm Beach only** — 649,776 of the county's
   1,492,191 people. A parcel inside one of the 39 municipalities returns zero
   cases, and zero there means *wrong government*, not *clean*. The county
   publishes the test and so do we: a PCN beginning `00` is unincorporated.
   Anything else gets refused with an explanation instead of an empty result.
2. **The permit half is gated.** The county serves that search free to an
   ordinary browser but bounces an automated session to its login route (and
   answers 401 on its own lookup endpoint). We do not work around bot checks, so
   the adapter detects that specific condition and reports the permit side as
   **not checked**, with a link. It never returns an empty permit list that could
   read as "all clear".

The free tier prints a case status of `Fine` but never the amount and never the
lien recording — those are behind the county's certified Fine/Lien search ($65,
$97 rush, 7–10 business days). The adapter never infers a figure it cannot read.

Live selector check (needs network, ~15s):

```
cd worker && npx tsx src/smoke-pbc.ts [PCN]
```

Offline tests, including the real case-detail text, are in
`tests/pbc-adapter.test.ts` at the repo root and run with the main suite.

### Broward County (Posse / BCS)
Broward is not an Accela customer either. This entry used to point at
`aca-prod.accela.com/BROWARD/`, which returns 404, so every Broward scan
silently failed. The county runs Posse at `dpepp.broward.org/BCS`, and it is
pleasant to automate: the parcel search is one postback and everything after it
is a plain GET with no session or viewstate.

| | |
|---|---|
| parcel search | `?PossePresentation=ParcelSearchForEnforcement` |
| code cases | `?PossePresentation=ParcelEnforcementList&PosseObjectId=N` |
| permits | `?PossePresentation=ParcelPermitList&PosseObjectId=N` |
| one case | `?PossePresentation=ViewEnforcementCase&PosseObjectId=M` |

One `PosseObjectId` keys both the cases and the permits, so one search buys
both. Each case's Activities tab carries the cited section and, for a recorded
lien, a **CR number** for Broward Official Records — which is where the dollar
amount lives, since the county never publishes it.

Feed it the app's 12-digit folio (`504113111610`); that is exactly the portal's
*Parcel ID* field. The portal's separate *Folio Number* field wants the shorter
dashed form (`0113-11-1610`), and the two encodings differ by more than
punctuation, so the adapter routes each to its own field rather than converting.

**What makes this adapter honest.** County code enforcement covers
unincorporated Broward — 16,888 of 1,944,375 people — plus Unsafe Structure
cases the county hears for cities under interlocal agreement. So an empty county
result is the normal answer for ~99% of Broward and means nothing by itself.
A Broward folio does not encode incorporation, so the adapter resolves the
authority from the **parcel point** against the county's municipality layer, and
says one of three things: the county is the authority; a named city is, and
these county records are only part of the picture; or it could not tell, in
which case the result is reported as unchecked rather than clear. It never reads
the authority off the postal city — this data is full of unincorporated parcels
with `FORT LAUDERDALE` mailing addresses.

Two parsing traps are pinned in tests because both produced confidently wrong
output rather than an error:

- `Label:\s*(.*)` walks past an **empty** field, because `\s` matches a newline,
  and captures the next line. A case with no complaint text reported its
  `Date Established` line as the complaint. Field matching is horizontal-only.
- The page chrome is itself a `<table>` whose first row flattens the whole
  document, and a substring match on `case` hits the heading *"BCS Enforcement
  Cases"*. `pickGrid` therefore matches the id header **exactly**, keeps only
  rows as wide as the header, and prefers the table holding the most id-shaped
  rows.

Also: the permit grid prints a literal `mmm dd, yyyy` where a date is absent, and
has both a `Permit Number` and a `Permit` column, so exact header matching
matters there too.

Live selector check (needs network, ~45s):

```
cd worker && npm run smoke:broward
```

Offline tests, with the real case and Activities text as fixtures, are in
`tests/broward-adapter.test.ts`.

### Tyler EnerGov CSS (Hialeah, and the platform behind it)

Built because of one report: **135 W 60 ST, Hialeah** came back
*"Code and liens: None open"*, in green, because only Miami-Dade County was
searched. The county is not the code authority inside Hialeah. The city held:

```
BWOP-001873-2025   Building Without A Permit    status: Lien
applied 2025-05-08                              parcel 0421310020800
"Failure to obtain permits for addition to detached garage, shed, and
 concrete slab on northwest corner of property."
```

One flow serves many jurisdictions — EnerGov CSS runs Hialeah, St Lucie,
Marion, Okaloosa and several Palm Beach cities from the same app on
`tylerhost.net`; only the host and the tenant's module set change.

```
https://<tenant>.tylerhost.net/apps/selfservice#/search
```

**Module 5 (Code Case) is per-tenant, and tenants disagree.** Verified
2026-11-09: Hialeah exposes `1,2,3,4,5,6,10,11`; St Lucie County exposes
`1,2,3,4,6,10,11` — note the gap at 5. Same vendor, same page, opposite answer.
The adapter refuses up front when 5 is absent, and re-reads the live module
list every run rather than trusting the registry snapshot.

**Rows are read from the portal's own XHR, not the DOM.** The results grid is
virtualised and in several tenants renders nothing until a category filter is
clicked, which produced empty results for addresses that genuinely had cases.
The adapter listens for the response the browser already received while it
drives the page normally; it never calls that endpoint itself.

**The listener matches our own request.** The app fires its own POST to the
same endpoint while the page settles, so "first POST to search/search" is a
race — it caught the startup search about half the time. The predicate checks
the request payload carries the address we typed.

**The portal refuses intermittently.** Roughly one run in three it answers
HTTP 200 with `{"Result":null,"Success":false}` — most often on the first
search after a cold load. That is Tyler's flakiness, not ours, so the adapter
retries up to three times with a short backoff. Treating that refusal as zero
cases would report a property with a recorded lien as clean, so `Success:false`
is parsed as *unreadable*, never as empty. Four consecutive clean smoke runs
after the retry went in.

City routing: `CITY_JURISDICTIONS` is keyed `"<county>:<MUNICIPALITY>"` and
`resolveJurisdiction()` prefers a city over its county. **The municipality must
come from the property appraiser, never the postal city on the address** — a
Florida postal city routinely names a place that does not govern the parcel.
When the municipality is unknown, routing falls back to the county and the
adapter says what it covered; it never guesses.

Live check (needs network, ~30s):

```
cd worker && npm run smoke:energov
```

Offline tests, with the real Hialeah response as the fixture, are in
`tests/energov-adapter.test.ts`.

### Why the adapters are split into `*-parse.ts`

The repo-root tests import adapter logic, and the root tsconfig excludes
`worker` — but `exclude` only filters the *initial* file set; TypeScript still
follows imports across the boundary. Vercel installs root dependencies only, so
any root file that reaches a playwright-typed module builds fine locally (where
`worker/node_modules` resolves it) and **fails the deploy** with
`TS2307: Cannot find module 'playwright'`.

So each adapter keeps its pure logic — parsing, parcel keys, the decision to
refuse — in a `*-parse.ts` that imports nothing, and the browser flow in the
main module. `portal-config.ts` exists for the same reason: `PortalConfig` sat
next to `ScraperCtx`, which holds a playwright `Page`, so importing the
jurisdiction registry pulled playwright in.

Reproduce the Vercel condition before pushing anything that touches this
boundary:

```
mv worker/node_modules /tmp/_wnm && npm run build; mv /tmp/_wnm worker/node_modules
```
