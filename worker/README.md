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
Palm Beach (ePZB, `src/scrapers/pbc.ts`), Miami-Dade (generic/EPS; permits also
covered instantly by the app API), Broward (**currently broken, see below**).
Others get a graceful "not yet automated + statewide lookup link" email.

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

### Broward County — known broken
`aca-prod.accela.com/BROWARD/` returns 404 (verified 2026-11-09), so every
Broward deep scan currently falls through to "portal could not be read". Broward
is not on Accela; it runs Posse (Computronix) at `dpepp.broward.org/BCS`, whose
folio search works and whose detail pages are plain GET with no session. Before
building that adapter, note that Broward's county caseload is unincorporated-only
too, and unincorporated Broward is just 16,888 people.
