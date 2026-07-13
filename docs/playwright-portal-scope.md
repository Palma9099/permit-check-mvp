# Playwright Portal Scraping — Scope

_permit-check-mvp · deep-scan worker · July 2026_

## Why this exists

The instant report pulls live permits only where a county/city publishes an open,
geo-queryable API — Fort Lauderdale, Tampa, Orlando, and Miami-Dade countywide.
A July 2026 survey of ~15 more metros found **no additional current open feed**:
almost every other Florida jurisdiction keeps permits and code cases behind a
**vendor permitting portal** (Accela, Tyler EnerGov, eTRAKiT, CitizenServe…)
with no public data endpoint. The only way to read those is to drive the portal
like a person — which is what the deep-scan worker does.

The goal of this work: turn the deep-scan worker from a best-effort prototype into
a reliable engine that reads real permit + code-enforcement records from the
portals that cover most of Florida's population, and feed those results back into
the report.

## What already exists (do not rebuild)

The plumbing is ~70% done and works end to end in principle:

- **Queue** — `scan_jobs` table in Supabase; app enqueues via `POST /api/deep-scan`,
  polls status via the status route. (`src/lib/scan-queue.ts`.)
- **Worker service** — `/worker` (Node + Playwright, Dockerfile present). Polls the
  queue, runs a scrape, writes the result back, emails the requester via Resend.
- **Generic browser engine** — `worker/src/scrapers/generic.ts`. Navigates to a
  portal search URL, fills folio/address, submits, reads the results table, maps
  columns by keyword. **Degrades safely**: any miss returns `ok:false` with portal
  links + a note, never fabricated data.
- **Declarative portal config** — `worker/src/scrapers/counties.ts`
  (`PortalConfig`: searchUrl, input selectors, submit selectors, result-header
  keywords, portal links). Broward + Palm Beach (Accela) and Miami-Dade (EPS)
  are configured but **uncalibrated**.
- **Calibration script** — `worker/src/calibrate.ts` runs one address against one
  portal and prints the structured result (no email/queue), for tuning selectors.

### Gaps between prototype and production

1. **Not calibrated** — configs are best-effort selector guesses; until calibrated
   against each live portal, they degrade to "use the link."
2. **Deployment unconfirmed** — the worker needs to run on a long-lived host with a
   real browser; that host isn't stood up/verified.
3. **Single-step search only** — the engine fills a form and reads the first table.
   Real Accela flows are multi-step: address search → **results list** →
   (often) **address-disambiguation** → **detail page** for value/contractor/finaled
   date. Those fields are currently null.
4. **Config keyed by county, not platform** — every jurisdiction is written from
   scratch even though dozens share one vendor. This caps how fast coverage grows.
5. **No CAPTCHA / SPA handling** — EnerGov CSS and Miami-Dade EPS render results in
   JS grids; some Accela deployments gate search behind a CAPTCHA.
6. **Results are email-only** — not cached, not merged into the instant report.

## The key insight: scrape by platform, not by city

Florida jurisdictions cluster onto a handful of permitting vendors. One calibrated
scraper per **platform** + a registry of **agency codes** covers many jurisdictions
at once. Accela alone runs the same `aca-prod.accela.com/<AGENCY>/…` app for Broward,
Palm Beach, Miami-Dade RER, and many cities — the only thing that changes per
jurisdiction is the agency code in the URL.

| Platform | URL shape | FL coverage (indicative) | Difficulty |
|---|---|---|---|
| **Accela Citizen Access (ACA)** | `aca-prod.accela.com/<AGENCY>/Cap/CapHome.aspx` | Broward, Palm Beach, Miami-Dade RER, many cities | Medium (classic ASP.NET tables; multi-step) |
| **Tyler EnerGov / CSS** | `<jur>.tylerhost.net` / `energov` SPA | Growing among mid cities | Higher (SPA, XHR JSON) |
| **SuperION / eTRAKiT** | `<jur>.<vendor>.com/etrakit` | Older small-city installs | Medium |
| **CentralSquare / CitizenServe / MyGov** | vendor-hosted | Long tail of small cities | Varies |

**Implication:** ~4 platform scrapers + an agency-code registry can cover the
large majority of Florida's permitting jurisdictions. That keeps the maintenance
surface small (you maintain ~4 flows, not ~60 city sites).

## Target architecture

1. **Refactor config from per-county to per-platform.**
   - `PLATFORMS`: one scraper flow per vendor (`accela`, `energov`, `etrakit`, …).
   - `JURISDICTIONS`: `Record<countyOrCityKey, { platform, agencyCode, portalLinks }>`.
   - Dispatch: resolve jurisdiction → platform scraper(agencyCode).
   - The existing generic engine becomes the **Accela** flow (its selectors already
     lean ASP.NET); other platforms get their own flow module.

2. **Deepen the Accela flow** (the MVP): search → results list → disambiguation →
   detail page. Capture value, contractor, finaled date. Handle "multiple matches"
   by scoring rows against the input street number. Some ACA deployments expose an
   undocumented JSON search endpoint — prefer it when present (faster, sturdier).

3. **Result caching.** Add a `portal_results` table (folio/address+county → result,
   scraped_at). The worker writes here; a repeat request or the instant report can
   read a fresh cached result (TTL ~30–90 days for permits) and merge it in without
   re-scraping. This is what eventually makes deep-scan data show up **instantly**.

4. **Report integration.** `/api/check` looks up `portal_results` for the parcel; if
   a fresh row exists, merge its permits/code cases into the report (labeled
   "read from the county portal, as of \<date\>"). If absent, keep today's async
   deep-scan offer. Coverage compounds as the cache fills for active areas.

5. **Per-portal canary.** Extend the schema-canary pattern: nightly, run one known
   address through each platform+agency and assert a results table parsed. Email on
   drift — the same early-warning system already built for the ArcGIS layers.

## Operations

- **Host:** a long-lived container with the Playwright image (Fly.io / Render /
  Railway). Concurrency 1–2, queue-driven; autoscale off (portals rate-limit).
- **Pacing / anti-bot:** human-like delays, one real browser context, realistic UA,
  exponential backoff on block. Optional residential proxy only if IP blocks appear.
  No auth bypass, no CAPTCHA-solving services.
- **Freshness:** on-demand (deep-scan button) now; later, a nightly batch can
  refresh cached results for saved/searched properties.

## Legal & ethical guardrails

- Building permits and code-enforcement cases are **public records** under Florida's
  Sunshine Law; reading them is defensible. But: respect each portal's Terms of Use
  and `robots.txt`, rate-limit politely, identify with an honest User-Agent, never
  bypass authentication or CAPTCHA, and cache aggressively to minimize load.
- Keep the tool's **conservative copy**: results are "as read from the county portal,
  confirm at the source," never a legal determination, never fabricated on a miss.
- Recommend a quick counsel review of the top portals' ToS before scaling past MVP.

## Failure modes & mitigations

| Risk | Mitigation |
|---|---|
| Portal layout drift | Degrade-to-link (already built) + calibration script + nightly per-portal canary |
| Address disambiguation misses wrong parcel | Score result rows vs input street #; prefer folio search; label match confidence |
| CAPTCHA on search | Detect + degrade to link; pace requests; revisit only if it blocks a high-value portal |
| SPA result grids (EnerGov, MD EPS) | Explicit waits on the grid, or intercept the XHR JSON directly |
| IP blocking | Backoff, low concurrency, residential proxy only if needed |
| Maintenance burden | Platform-based (not city) scrapers keep the flow count to ~4 |

## Phasing & effort

- **Phase 0 — Productionize (0.5–1 day):** deploy the worker to a real host; confirm
  one address end-to-end (enqueue → scrape → email); add the `portal_results` cache
  table.
- **Phase 1 — Accela MVP (3–5 days):** turn the generic engine into a full Accela
  flow (search → list → disambiguation → detail drill); build the agency-code
  registry for the top ~10 FL Accela jurisdictions (Broward, PBC + cities);
  calibrate; cache results. **Biggest single coverage jump.**
- **Phase 2 — Second/third platform (3–5 days):** EnerGov CSS + eTRAKiT flows for the
  next tier of cities.
- **Phase 3 — Integration + canary (2–3 days):** merge cached portal results into the
  instant `/api/check` report; ship the per-portal nightly canary.
- **Ongoing:** ~a few hours/month of selector upkeep, surfaced automatically by the
  canary rather than by user complaints.

## Recommendation

Do **Phase 0 + Phase 1 (Accela-first)** as the MVP. Accela is the highest-leverage
platform in Florida — one calibrated flow plus an agency-code registry unlocks
Broward, Palm Beach, Miami-Dade RER, and a run of cities in a single effort, reusing
the queue, engine, degrade-safety, and email that already exist. Measure scrape
success rate per portal before investing in Phase 2. Keep every result labeled
"as read from the portal — confirm at source."

### Success metrics
- Scrape success rate per portal (target > 80% on covered jurisdictions).
- Share of checks in covered jurisdictions returning a real permit/code table.
- Cache hit rate on `/api/check` (how often deep data shows instantly).
- Median deep-scan latency; portal-canary green rate.
