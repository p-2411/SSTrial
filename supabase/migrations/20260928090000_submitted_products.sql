-- A read upload waits in its uploader's Review list until they submit it to Products, the shared
-- record, once nothing in it is left to check (see server/src/uploads/submit.ts).
alter table public.uploads
  add column submitted_at timestamptz,
  add column submitted_by uuid references auth.users (id) on delete set null;

-- Everything read before review existed was already in Products, and stays there. Its updated_at is
-- left alone: nothing about the upload itself changed.
alter table public.uploads disable trigger uploads_set_updated_at;
update public.uploads set submitted_at = coalesce(completed_at, updated_at) where status = 'completed';
alter table public.uploads enable trigger uploads_set_updated_at;

-- Only a read upload can be in Products: reading it again (a rerun) takes it back out.
alter table public.uploads
  add constraint uploads_submitted_only_when_completed check (submitted_at is null or status = 'completed');

-- Each person's Review list.
create index uploads_awaiting_review on public.uploads (uploaded_by, created_at desc, id desc)
  where status = 'completed' and submitted_at is null;
