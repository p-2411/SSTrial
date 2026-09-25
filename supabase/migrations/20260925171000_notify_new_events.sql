-- Announces new activity-log events on the 'new_events' channel, so the Logs page updates live the
-- way the upload list does. Once per statement and with no payload: the page refetches its newest
-- events rather than being sent them, so the notification carries nothing to parse or trust.
create function public.notify_new_events() returns trigger
language plpgsql as $$
begin
  perform pg_notify('new_events', '');
  return null;
end;
$$;

create trigger events_notify_insert
after insert on public.events
for each statement execute function public.notify_new_events();
