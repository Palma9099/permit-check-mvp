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

### 1. Run the migration (creates the queue)
Against the same database as `SUPABASE_URL` (Supabase SQL editor or psql):
```
-- paste migrations/0001_scan_jobs.sql  (in the repo root, one level up)
```

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

## Supported counties
Miami-Dade, Broward, Palm Beach (others get a graceful "not yet automated +
statewide lookup link" email). Add a county by dropping a new entry in
`COUNTY_CONFIGS`.
