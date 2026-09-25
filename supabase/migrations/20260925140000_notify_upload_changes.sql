-- Announces every change to a visible upload on the 'upload_changes' channel. The API LISTENs and
-- forwards these to browsers as server-sent events, so screens update when something changes
-- instead of polling. Uploads still being uploaded aren't shown anywhere, so they're skipped until
-- they're confirmed (or discarded).
create function public.notify_upload_change() returns trigger
language plpgsql as $$
begin
  if (tg_op = 'INSERT' and new.status = 'uploading') or (tg_op = 'DELETE' and old.status = 'uploading') then
    return null;
  end if;
  perform pg_notify(
    'upload_changes',
    json_build_object('id', coalesce(new.id, old.id), 'status', coalesce(new.status, old.status))::text
  );
  return null;
end;
$$;

create trigger uploads_notify_change
after insert or update or delete on public.uploads
for each row execute function public.notify_upload_change();
