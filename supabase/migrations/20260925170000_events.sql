-- =============================================================================================
-- The activity log: one row per thing that happened, written by both processes (the API and the
-- worker) and shown on the Logs page and in each upload's Activity section.
--
-- `uploads` only holds each upload's *current* state; this table keeps the history — every
-- attempt, why it was retried, how long it took, alerts opening and resolving. It's separate from
-- the processes' stdout logs (pino), which stay the place for debugging detail.
--
-- Writes are best-effort (see server/src/logs/store.ts): an event that can't be written is lost,
-- never the upload it describes.
-- =============================================================================================

create table public.events (
  -- Also the pagination key: identity values only grow, so "newest first" is `order by id desc`.
  id          bigint generated always as identity primary key,
  -- clock_timestamp(), not now(): the actual moment, even inside a longer transaction.
  occurred_at timestamptz not null default clock_timestamp(),
  source      text not null check (source in ('api', 'worker')),
  level       text not null check (level in ('info', 'warn', 'error')),
  -- e.g. 'extraction.retry_scheduled'. The list of types lives in shared/src/logs.ts.
  type        text not null,
  -- Not a foreign key: rejected and abandoned uploads are deleted, and their history should stay.
  upload_id   uuid,
  message     text not null,
  -- Structured details (error code, attempt, duration…), for filtering and the page's details view.
  data        jsonb not null default '{}'::jsonb
);

comment on table public.events is 'Activity log of uploads, extraction attempts and alerts. Kept for 30 days.';

-- The Logs page's queries, all newest first:
-- one upload's history (also the detail panel's Activity section)…
create index events_by_upload on public.events (upload_id, id desc) where upload_id is not null;
-- …one type of event…
create index events_by_type on public.events (type, id desc);
-- …and the "warnings and errors" / "errors only" filters, which skip the mass of info events.
create index events_warnings_and_errors on public.events (id desc) where level <> 'info';
create index events_errors on public.events (id desc) where level = 'error';

-- Pruning deletes by age. Rows are appended in time order, so a BRIN index is tiny and enough.
create index events_occurred_at on public.events using brin (occurred_at);

-- Not exposed through Supabase's auto-generated API (see the uploads migration).
alter table public.events enable row level security;
