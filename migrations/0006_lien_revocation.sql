-- Withdrawing a delivered lien search.
--
-- The table already allows status 'revoked', and both the client page and the
-- PDF already refuse to serve anything that is not 'final'. Nothing could set
-- it: a search delivered to a title company with a missed lien could only be
-- pulled back by editing the database by hand.
--
-- These columns record who withdrew it, when, and what the client should be
-- told, plus the id of the corrected search when one replaces it. The client
-- is holding a PDF already, so the withdrawal has to be legible to them, not
-- just a status flag.
--
-- Run once in the app's Supabase project (Palma9099's Project), SQL editor.

alter table lien_searches add column if not exists revoked_at      timestamptz;
alter table lien_searches add column if not exists revoked_by      text;
alter table lien_searches add column if not exists revoked_reason  text;   -- shown to the client
alter table lien_searches add column if not exists replaced_by     text;   -- id of the corrected search

-- Finding every withdrawal for a parcel, which is the question asked when a
-- closing goes wrong.
create index if not exists lien_searches_revoked_idx
  on lien_searches (folio, revoked_at desc)
  where revoked_at is not null;
