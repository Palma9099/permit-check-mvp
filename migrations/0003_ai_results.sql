-- Saved AI photo-check answers, so the same property shows the same findings.
-- Run once against the same Supabase project as scan_jobs and portal_results
-- (SUPABASE_URL / SUPABASE_SECRET_KEY): paste into the Supabase SQL editor.
--
-- Why: the AI aerial and Street View checks can disagree with themselves on a
-- borderline item from one request to the next, even with a 2-of-3 vote. The
-- first successful answer for a parcel and a given set of photos is saved here
-- and reused for 30 days (see src/lib/ai-cache.ts). New photos make a new key,
-- so fresher imagery is always checked again.

create table if not exists ai_results (
  cache_key   text primary key,             -- kind|parcel|hash of the photos compared
  kind        text not null,                -- 'aerial' or 'street'
  result      jsonb not null,
  created_at  timestamptz not null default now()
);

create index if not exists ai_results_created_idx on ai_results (created_at);

-- Only the server (secret key) reads or writes it.
alter table ai_results enable row level security;
