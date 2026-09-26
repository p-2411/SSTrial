-- The upload lists, searches and status figures at scale: each reads only the uploads it's about,
-- however many products and finished uploads pile up (see server/src/uploads/store.ts and
-- server/src/ops/store.ts).

-- Products, newest first, a page at a time: everyone's list, and the one that grows for good.
create index uploads_products on public.uploads (created_at desc, id desc)
  where status = 'completed' and submitted_at is not null;

-- Searching products (`ilike '%words%'`) by name, brand or file name at once, through a trigram
-- index rather than reading every product. The store searches this exact expression, which is what
-- lets it use the index; the newline keeps a search from matching across two fields.
create index uploads_products_search on public.uploads
  using gin ((file_name || E'\n' || coalesce(result->>'productName', '') || E'\n' || coalesce(result->>'brand', '')) extensions.gin_trgm_ops)
  where status = 'completed' and submitted_at is not null;

-- One person's uploads before they're read: their Upload list (queued, processing, failed), and how
-- many they have under way (uploading, queued, processing), without reading everything they've ever
-- uploaded.
create index uploads_unread_by_person on public.uploads (uploaded_by, created_at desc, id desc)
  where status in ('uploading', 'queued', 'processing', 'failed');

-- The System page's last 24 hours: uploads by when they finished (read, or failed for good).
create index uploads_finished_at on public.uploads ((coalesce(completed_at, updated_at)))
  where status in ('completed', 'failed');
