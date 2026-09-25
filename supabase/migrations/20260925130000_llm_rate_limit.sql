-- A token bucket shared by every worker process, so together they stay under the LLM provider's
-- request rate (see server/src/extraction/rate-limiter.ts). One row per limited resource.
-- paused_until is set when the provider answers "slow down" with a Retry-After: no worker makes a
-- request until then.
create table public.llm_rate_limits (
  key          text primary key,
  tokens       double precision not null,
  refilled_at  timestamptz not null default now(),
  paused_until timestamptz
);

-- Internal state only: not readable or writable through Supabase's public REST API.
alter table public.llm_rate_limits enable row level security;
