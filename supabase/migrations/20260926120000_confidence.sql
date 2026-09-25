-- How sure the extraction is of each field, out of 100 (see shared/src/confidence.ts): the model's
-- own scores, capped by code checks. Kept apart from `result`, which stays the label data that's
-- exported and edited. Null for uploads extracted before scoring existed, or when the model gave no
-- usable scores.
alter table public.uploads add column confidence jsonb;
