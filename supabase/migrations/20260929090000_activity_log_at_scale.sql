-- The activity log at scale. A product's history is now kept for as long as the product exists, so
-- the table grows with the catalogue: it's read a page at a time, searched and filtered by date, and
-- each event's details are fetched only when someone opens them (see server/src/logs/store.ts).

-- Searching messages (`ilike '%words%'`) through a trigram index rather than reading every row.
create extension if not exists pg_trgm with schema extensions;
create index events_message_search on public.events using gin (message extensions.gin_trgm_ops);

-- Pruning: events about no upload (a process starting) go after LOG_RETENTION_DAYS. An upload's go
-- that long after it's deleted, found through its "deleted" event (events_by_type).
create index events_system_by_time on public.events (occurred_at) where upload_id is null;

-- Every change to a product's data names the version it saved (`data.versionId`), for its details
-- and "Revert to here". Readings from before versions existed were saved without an event naming
-- them (see the upload_versions migration): name each in its upload's last "Extraction completed"
-- that names none.
update public.events e
set data = e.data || jsonb_build_object('versionId', v.id::text)
from (
  select distinct on (upload_id) upload_id, id
  from public.upload_versions
  where source = 'extraction'
  order by upload_id, id
) v
where e.id = (
    select max(last.id) from public.events last
    where last.upload_id = v.upload_id and last.type = 'extraction.completed' and not (last.data ? 'versionId'))
  and not exists (
    select 1 from public.events named
    where named.upload_id = v.upload_id and named.type = 'extraction.completed' and named.data->>'versionId' = v.id::text);
