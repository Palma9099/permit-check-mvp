-- Palma Verified records: a staff-reviewed, dated statement that a home's
-- permit and code records were checked. Run once in the app's Supabase
-- project (Palma9099's Project), SQL editor.
--
-- Only the server (secret key) reads or writes it; the public page and badge
-- read through the app.

create table if not exists verified_records (
  id           text primary key,              -- public id, e.g. PV-7K3Q9X
  folio        text not null,
  address      text not null,
  status       text not null default 'verified',  -- 'verified' or 'revoked'
  verified_at  timestamptz not null default now(),
  expires_at   timestamptz not null,
  reviewer     text not null,                 -- Palma staff member who signed off
  checks       jsonb not null,                -- [{ key, label, ok, note }]
  summary      jsonb,                         -- { score, band, roofYear, floodZone }
  notes        text,                          -- short public note
  hero_image   text,                          -- aerial photo URL for the page
  created_at   timestamptz not null default now()
);

create index if not exists verified_records_folio_idx on verified_records (folio, verified_at desc);

alter table verified_records enable row level security;
