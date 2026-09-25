-- Indexes for the paginated, filterable upload list: newest first with the ID as a tie-breaker,
-- which keyset pagination needs to be exact. The per-status one serves the filtered views.
drop index public.uploads_listing_idx;
create index uploads_listing_idx on public.uploads (created_at desc, id desc) where status <> 'uploading';
create index uploads_status_listing_idx on public.uploads (status, created_at desc, id desc);
