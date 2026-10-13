-- Apply after 042_live_match_kiosk_pin.sql in the Supabase SQL Editor.
-- Quick games are independent live scoreboards, never official results or ELO inputs.
begin;

drop policy if exists "Anyone can read the live scoreboard" on public.live_matches;
drop policy if exists "Anyone can create the live scoreboard" on public.live_matches;
drop policy if exists "Anyone can update the live scoreboard" on public.live_matches;

drop policy if exists "Anyone can read quick games" on public.live_matches;
create policy "Anyone can read quick games"
  on public.live_matches for select to anon, authenticated
  using (challenge_id is null and match_pin is null and not is_pin_activated);

drop policy if exists "Anyone can create quick games" on public.live_matches;
create policy "Anyone can create quick games"
  on public.live_matches for insert to anon, authenticated
  with check (challenge_id is null and match_pin is null and not is_pin_activated);

drop policy if exists "Anyone can update quick game scores" on public.live_matches;
create policy "Anyone can update quick game scores"
  on public.live_matches for update to anon, authenticated
  using (challenge_id is null and match_pin is null and not is_pin_activated)
  with check (challenge_id is null and match_pin is null and not is_pin_activated);

commit;
