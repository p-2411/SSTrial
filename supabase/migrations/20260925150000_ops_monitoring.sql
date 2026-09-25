-- Monitoring. A scheduled monitor in the worker evaluates alert rules every minute (see
-- server/src/ops/monitor.ts). Each alert is one row per occurrence: opened when its rule starts
-- firing, updated while it keeps firing, resolved when it stops — so the table is the alert log
-- shown on the System status page and returned by GET /api/ops.
create table public.ops_alerts (
  id            bigint generated always as identity primary key,
  key           text not null,          -- which rule, e.g. 'queue-stalled'
  severity      text not null check (severity in ('warning', 'critical')),
  title         text not null,
  message       text not null,          -- latest description, e.g. "Oldest upload has waited 14 minutes"
  occurrences   integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  resolved_at   timestamptz
);

-- At most one open alert per rule.
create unique index ops_alerts_one_open_per_key on public.ops_alerts (key) where resolved_at is null;
create index ops_alerts_recent on public.ops_alerts (first_seen_at desc);

-- When each kind of process last checked in. The monitor updates 'worker' every minute, so a stale
-- value means no worker is running — the one failure a worker can't report about itself.
create table public.ops_heartbeats (
  process      text primary key,
  last_seen_at timestamptz not null default now()
);

alter table public.ops_alerts enable row level security;
alter table public.ops_heartbeats enable row level security;
