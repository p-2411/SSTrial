-- Every state a product's data has been in, so an admin can put it back to one (see
-- server/src/uploads/revert.ts). A version is written in the same statement as the change that made
-- it, so none can go missing: the AI's reading when an upload completes, each saved edit or check,
-- and each revert. The history links its entries to them through the event's `versionId`.
create table public.upload_versions (
  id            bigint generated always as identity primary key,
  upload_id     uuid not null references public.uploads (id) on delete cascade,
  source        text not null check (source in ('extraction', 'review', 'revert')),
  result        jsonb not null,
  -- The model's scores for this reading: a revert to an earlier run's data brings its scores back too.
  confidence    jsonb,
  field_reviews jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index upload_versions_by_upload on public.upload_versions (upload_id, id);

alter table public.upload_versions enable row level security;

-- Uploads read before versions existed keep their AI reading, so it can always be gone back to:
-- the model's own output (kept in original_result once someone edits), with its scores.
insert into public.upload_versions (upload_id, source, result, confidence, created_at)
select id, 'extraction', coalesce(original_result, result), confidence, coalesce(completed_at, updated_at)
from public.uploads
where status = 'completed' and result is not null;
