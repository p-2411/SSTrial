-- The Logs page now filters by event type only: a type always has the same level, so "warnings and
-- errors" is just a set of types. The partial indexes behind the old level filter go; lookups by
-- type use events_by_type.
drop index public.events_warnings_and_errors;
drop index public.events_errors;
