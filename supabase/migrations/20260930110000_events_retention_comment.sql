-- The events table's comment still said everything is kept for 30 days. A product's history is kept
-- for as long as the product exists (see 20260929090000_activity_log_at_scale.sql); only events
-- about no upload, and a deleted upload's, go after LOG_RETENTION_DAYS (30).
comment on table public.events is
  'Activity log: what happened to each upload, kept while it exists and for 30 days after it''s deleted; and process starts, kept for 30 days.';
