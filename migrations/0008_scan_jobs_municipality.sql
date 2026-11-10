-- The municipality a deep-scan job is in, so the worker can pick the CITY's
-- code adapter instead of its county's.
--
--   psql "$DATABASE_URL" -f migrations/0008_scan_jobs_municipality.sql
-- or paste into the Supabase SQL editor.
--
-- Why this column exists. `resolveJurisdiction(county, municipality)` picks a
-- city adapter from CITY_JURISDICTIONS when it is given a municipality, and
-- falls back to the county's adapter when it is not. The queue had no
-- municipality column, so every job arrived without one, and all 36 city
-- adapters were unreachable from the product's own deep-scan button.
--
-- For an address in the City of Tampa that meant the fallback ran
-- HILLSBOROUGH COUNTY's code search - which covers UNINCORPORATED Hillsborough
-- only, about 1 in 5 of the county's residents, and none of Tampa. An empty
-- answer from the wrong office is the one result this product must never
-- produce.
--
-- The value is resolved from the PARCEL POINT (Census incorporated-place
-- boundaries), never from the postal city in the typed address: a letter
-- addressed to "Miami, FL" is usually not in the City of Miami.
alter table scan_jobs add column if not exists municipality text;

comment on column scan_jobs.municipality is
  'Incorporated place containing the parcel point, e.g. ''TAMPA''. NULL means we could not establish it - never a finding of unincorporated land. Resolved from Census place boundaries, never from the postal city.';
