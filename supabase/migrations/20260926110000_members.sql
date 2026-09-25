-- =============================================================================================
-- Who may use the app, and as what. Accounts themselves live in Supabase Auth (auth.users); this
-- table only says which of them have access, and with which role (see shared/src/auth.ts).
--
-- Only the API reads it, over its own database connection. Row Level Security is on with no
-- policies, so Supabase's public Data API can't.
-- =============================================================================================

create table public.members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

alter table public.members enable row level security;
