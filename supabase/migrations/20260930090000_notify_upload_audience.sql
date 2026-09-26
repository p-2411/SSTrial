-- Each upload change now says whose upload it is, so the API forwards it only to the people who may
-- see it (see server/src/api/routes/events.ts): one being read, or waiting for review, is its
-- uploader's alone. Browsers are still sent just `{ id, status }`.
--
--   uploadedBy  its uploader (null for uploads from before sign-in, which admins look after)
--   product     whether it's in Products before or after the change, so everyone who could see it
--               hears when it leaves (read again) as well as when it arrives
create or replace function public.notify_upload_change() returns trigger
language plpgsql as $$
declare
  changed public.uploads;
begin
  if tg_op = 'DELETE' then
    changed := old;
  else
    changed := new;
  end if;
  -- Uploads still being uploaded aren't shown anywhere, until they're confirmed (or discarded).
  if tg_op <> 'UPDATE' and changed.status = 'uploading' then
    return null;
  end if;
  perform pg_notify(
    'upload_changes',
    json_build_object(
      'id', changed.id,
      'status', changed.status,
      'uploadedBy', changed.uploaded_by,
      'product', (changed.status = 'completed' and changed.submitted_at is not null)
                 or (tg_op = 'UPDATE' and old.status = 'completed' and old.submitted_at is not null)
    )::text
  );
  return null;
end;
$$;
