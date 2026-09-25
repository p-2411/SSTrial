-- =============================================================================================
-- People correcting and confirming extracted data (see server/src/uploads/edit.ts).
--
--   original_result  the model's output, kept on the first edit: `result` is what people see and
--                    export, this is what the AI read.
--   field_reviews    per field, who edited or checked it and when:
--                    { "brand": { "kind": "edited", "by": "<user id>", "at": "<timestamp>" } }
--   result_revision  goes up with every saved edit. An edit names the revision it was made
--                    against, and is refused if someone else has saved since (no lost updates).
-- =============================================================================================

alter table public.uploads
  add column original_result jsonb,
  add column field_reviews   jsonb   not null default '{}'::jsonb,
  add column result_revision integer not null default 0;
