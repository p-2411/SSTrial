-- =============================================================================================
-- Uploads: one row per file a user uploads.
--
-- This table is the source of truth for what the UI shows (status, failure reason, result).
-- The job queue (pg-boss, which creates and migrates its own `pgboss` schema on start-up) only
-- tracks *delivery* of work: which job is due, retry counts and back-off timers.
-- =============================================================================================

create type public.upload_status as enum ('uploading', 'queued', 'processing', 'completed', 'failed');

create table public.uploads (
  id            uuid primary key default gen_random_uuid(),
  file_name     text        not null check (char_length(file_name) between 1 and 255),
  mime_type     text        not null,
  size_bytes    integer     not null check (size_bytes > 0),
  -- Object key inside the `labels` storage bucket, e.g. "2026/09/25/<id>.jpg".
  storage_path  text        not null unique,
  status        public.upload_status not null default 'uploading',
  -- Number of processing attempts the worker has started.
  attempts      integer     not null default 0 check (attempts >= 0),
  -- Machine-readable code + human-readable message. Set when failed, or while queued for a retry.
  error_code    text,
  error_message text,
  -- The validated extraction (see shared/src/extraction.ts). Only present once completed.
  result        jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz,

  constraint uploads_result_iff_completed check ((status = 'completed') = (result is not null)),
  constraint uploads_failed_has_reason check (status <> 'failed' or (error_code is not null and error_message is not null))
);

comment on table public.uploads is 'Uploaded label files and their extraction status/result.';

-- The list view shows newest first and never shows rows still waiting for the browser's upload.
create index uploads_listing_idx on public.uploads (created_at desc) where status <> 'uploading';

-- Keep updated_at honest without relying on every UPDATE statement remembering to set it.
create function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger uploads_set_updated_at
before update on public.uploads
for each row execute function public.set_updated_at();

-- Supabase exposes the `public` schema through its auto-generated REST API. Enabling RLS with no
-- policies means that API can't read or write this table at all. Our server connects to Postgres
-- directly as the table owner, which bypasses RLS.
alter table public.uploads enable row level security;

-- =============================================================================================
-- Storage bucket for the uploaded files. Private: files are only reachable through short-lived
-- signed URLs issued by the API. The size and type limits are enforced by Supabase itself, so a
-- signed upload URL can't be used to push something we'd reject.
-- Keep in sync with MAX_FILE_SIZE_BYTES / SUPPORTED_FILE_TYPES in shared/src/files.ts.
-- =============================================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'labels',
  'labels',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
