-- Who uploaded each file. Uploads from before sign-in existed have none; deleting an account keeps
-- its uploads.
alter table public.uploads add column uploaded_by uuid references auth.users (id) on delete set null;
