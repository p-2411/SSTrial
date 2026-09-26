-- Deleting an account sets uploads.uploaded_by to null (on delete set null), which finds that
-- account's uploads by this column: without an index, every account deletion scans every upload.
create index uploads_uploaded_by on public.uploads (uploaded_by) where uploaded_by is not null;

-- Alerts were removed (20260926090000_drop_alerts.sql).
comment on table public.events is 'Activity log of uploads, extraction attempts, reviews and process starts. Kept for 30 days.';
