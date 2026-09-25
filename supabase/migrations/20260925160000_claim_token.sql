-- Which processing attempt currently owns an upload. Starting an attempt sets a fresh token; saving
-- a result, scheduling a retry or failing the upload only succeeds with the matching token. If a job
-- is handed to another worker (e.g. its first worker lost contact with the database and stopped
-- heartbeating), the first worker can no longer write anything when it eventually finishes.
alter table public.uploads add column claim_token uuid;
