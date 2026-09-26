-- Reverts to an upload's first reading said "back to the AI's reading"; the app calls that the
-- original reading now (which part of the system read it is an engineering detail). Messages are
-- stored as written, so earlier ones are reworded to match.
update public.events
set message = replace(message, 'back to the AI''s reading', 'back to the original reading')
where type = 'upload.reverted' and message like '%back to the AI''s reading%';
