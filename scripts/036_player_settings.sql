-- 036: Persist player preferences from the "Nastavenia" tab.
--
-- Notification toggles and game preferences used to live only in React state and
-- were lost on logout. They are stored as one jsonb object on the player's own
-- profile row, which the existing "update own profile" policy already allows.
--
-- Keys (all optional, the app falls back to defaults for missing ones):
--   emailChallenges, emailMatchApproval, emailMessages, emailTournaments,
--   pushAlerts, rankingAlerts, publicStats, allowDirectMessages   boolean
--   preferredSide ('left' | 'right' | 'both'), racketBrand         text
--   preferredTimeSlots                                             text[]

begin;

alter table public.proffiles
  add column if not exists settings jsonb not null default '{}'::jsonb;

alter table public.proffiles
  drop constraint if exists proffiles_settings_is_object;
alter table public.proffiles
  add constraint proffiles_settings_is_object
  check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 8192);

commit;

notify pgrst, 'reload schema';
