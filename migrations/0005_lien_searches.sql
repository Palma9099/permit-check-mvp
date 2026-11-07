-- Palma Lien Search: a finished search Palma staff delivered to a title
-- company. The county part is a snapshot taken when staff publish; the staff
-- part (taxes, Official Records, utilities, city letter) is what staff found.
-- Run once in the app's Supabase project (Palma9099's Project), SQL editor.
--
-- Only the server (secret key) reads or writes it. The client link
-- /lien/{id} is private: the id is long and random, and the page is noindex.

create table if not exists lien_searches (
  id            text primary key,              -- private link id, e.g. LS-7K3Q9X2M4P
  folio         text not null,
  address       text not null,
  status        text not null default 'final', -- 'final' or 'revoked'
  searched_at   timestamptz not null,          -- when the county records were pulled
  completed_at  timestamptz not null default now(),
  reviewer      text not null,                 -- Palma staff member who completed it
  client        jsonb,                         -- { company, name, email, closingDate }
  search        jsonb not null,                -- county results (LienSearch snapshot)
  staff         jsonb not null,                -- [{ key, title, result, amount, note }]
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists lien_searches_folio_idx on lien_searches (folio, completed_at desc);

alter table lien_searches enable row level security;
