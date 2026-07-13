-- Cache of deep-scan (portal-scraped) permit + code results.
-- Run once against the same Supabase/Postgres as scan_jobs
-- (SUPABASE_URL / SUPABASE_SECRET_KEY):
--
--   psql "$DATABASE_URL" -f migrations/0002_portal_results.sql
-- or paste into the Supabase SQL editor.
--
-- Why: driving a county portal with a real browser is slow and rate-limited.
-- Once the worker reads a parcel's records we keep the result here so a repeat
-- lookup - and eventually the instant /api/check report - can reuse it without
-- re-scraping. Only SUCCESSFUL scrapes are written (see worker/src/cache.ts), so
-- a transient miss (CAPTCHA, layout change) never suppresses a future attempt.

create extension if not exists "pgcrypto";

create table if not exists portal_results (
  id           uuid primary key default gen_random_uuid(),
  county       text not null,               -- normalized key, e.g. 'broward'
  folio        text,                         -- preferred cache key when known
  address_key  text,                         -- normalized address, used when no folio
  ok           boolean not null default false,
  result       jsonb not null,              -- the worker's ScrapeResult
  source       text,
  scraped_at   timestamptz not null default now(),
  -- One stable key per parcel: folio when we have it, else the normalized
  -- address. Generated so PostgREST upserts (on_conflict=cache_key) are clean.
  cache_key    text generated always as (
                 lower(county) || '|' ||
                 case
                   when folio is not null and folio <> '' then 'f:' || folio
                   else 'a:' || coalesce(address_key, '')
                 end
               ) stored,
  unique (cache_key)
);

create index if not exists portal_results_scraped_idx on portal_results (scraped_at);
create index if not exists portal_results_county_idx on portal_results (county);
