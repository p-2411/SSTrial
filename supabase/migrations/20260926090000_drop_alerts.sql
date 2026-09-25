-- Alerts are gone. They only ever showed inside the app, where the same facts are already on the
-- System status page (the queue, the worker, failures by reason) and in the activity log (every
-- failed or abandoned extraction). Their table goes, and so do their events in the log.
delete from public.events where type in ('alert.opened', 'alert.resolved');
drop table public.ops_alerts;
