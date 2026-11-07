-- Withdrawing a Palma Verified or Palma Checked record.
--
-- verified_records already allows status 'revoked', and the whole read side
-- honours it: isLive() gates on it, the listing badge greys out, the folio
-- lookup filters it out, and the public page says "No longer verified".
-- Nothing could set it. A $599 staff-reviewed record that turned out wrong
-- could only be pulled back by editing the database by hand.
--
-- Same shape as migrations/0006 for lien searches. A withdrawal is never a
-- delete: the badge went out on a live listing and the question afterwards is
-- what Palma certified and when they took it back.
--
-- Run once in the app's Supabase project (Palma9099's Project), SQL editor.

alter table verified_records add column if not exists revoked_at     timestamptz;
alter table verified_records add column if not exists revoked_by     text;
alter table verified_records add column if not exists revoked_reason text;  -- shown publicly

create index if not exists verified_records_revoked_idx
  on verified_records (folio, revoked_at desc)
  where revoked_at is not null;
