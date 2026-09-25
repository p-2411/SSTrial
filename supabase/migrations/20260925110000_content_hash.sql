-- SHA-256 of each upload's bytes, so an identical file is recognised instead of being uploaded and
-- sent to the LLM again. Set from the browser's claim at creation, then replaced by the hash the
-- worker computes from the bytes it actually downloaded.
alter table public.uploads
  add column content_sha256 text check (content_sha256 ~ '^[0-9a-f]{64}$');

-- Lookups only ever want uploads that are (or will be) usable.
create index uploads_content_sha256_idx on public.uploads (content_sha256)
  where status in ('queued', 'processing', 'completed');
