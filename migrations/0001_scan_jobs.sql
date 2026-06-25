-- Deep-scan job queue for the long-running county-scraping worker.
-- Run once against the same Supabase/Postgres the ledger uses
-- (SUPABASE_URL / SUPABASE_SECRET_KEY).
--
--   psql "$DATABASE_URL" -f migrations/0001_scan_jobs.sql
-- or paste into the Supabase SQL editor.

create extension if not exists "pgcrypto";

create table if not exists scan_jobs (
  id           uuid primary key default gen_random_uuid(),
  status       text not null default 'queued'
                 check (status in ('queued','running','done','failed')),
  email        text not null,
  address      text,
  folio        text,
  county       text,                       -- normalized key, e.g. 'broward'
  lat          double precision,
  lng          double precision,
  attempts     int  not null default 0,
  max_attempts int  not null default 3,
  result       jsonb,                       -- structured scrape output
  error        text,
  email_sent   boolean not null default false,
  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  finished_at  timestamptz
);

create index if not exists scan_jobs_status_created_idx
  on scan_jobs (status, created_at);

-- Atomic claim: the worker calls this via PostgREST RPC. FOR UPDATE SKIP LOCKED
-- means many workers can run safely without ever grabbing the same job twice.
-- A job is re-claimable if it's been 'running' for >20 min (crashed worker).
create or replace function claim_scan_job()
returns setof scan_jobs
language plpgsql
as $$
declare
  job scan_jobs;
begin
  select * into job
  from scan_jobs
  where (status = 'queued')
     or (status = 'running' and claimed_at < now() - interval '20 minutes')
  order by created_at
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  update scan_jobs
     set status = 'running',
         attempts = attempts + 1,
         claimed_at = now()
   where id = job.id
  returning * into job;

  return next job;
end;
$$;
