-- Failure messages are no longer stored. Only error_code is kept; the message users see is
-- rendered from it at response time (UPLOAD_ERROR_MESSAGES in shared/src/uploads.ts), so
-- rewording a message never requires rewriting data.

alter table public.uploads drop constraint uploads_failed_has_reason;
alter table public.uploads drop column error_message;
alter table public.uploads
  add constraint uploads_failed_has_reason check (status <> 'failed' or error_code is not null);
