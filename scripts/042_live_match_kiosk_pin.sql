begin;

alter table public.live_matches
  add column if not exists challenge_id text unique,
  add column if not exists match_pin text,
  add column if not exists is_pin_activated boolean not null default false;

alter table public.live_matches
  drop constraint if exists live_matches_pin_format_check,
  drop constraint if exists live_matches_pin_activation_check;
alter table public.live_matches
  add constraint live_matches_pin_format_check
    check (match_pin is null or match_pin ~ '^[0-9]{4}$'),
  add constraint live_matches_pin_activation_check
    check (not is_pin_activated or match_pin is not null);

create unique index if not exists live_matches_match_pin_unique
  on public.live_matches (match_pin)
  where match_pin is not null;

drop policy if exists "Anyone can read the live scoreboard" on public.live_matches;
create policy "Anyone can read the live scoreboard"
  on public.live_matches for select to anon, authenticated
  using (id = '00000000-0000-0000-0000-000000000001'::uuid);

drop policy if exists "Participants can read their live matches" on public.live_matches;
create policy "Participants can read their live matches"
  on public.live_matches for select to authenticated
  using (
    exists (
      select 1
      from public.challenges as challenge
      join public.proffiles as profile
        on lower(profile.email) = lower(auth.jwt() ->> 'email')
      where challenge.id::text = live_matches.challenge_id
        and profile.id::text in (
          challenge.challenger_1_id::text,
          challenge.challenger_2_id::text,
          challenge.challenged_1_id::text,
          challenge.challenged_2_id::text
        )
    )
  );

drop policy if exists "Anyone can create the live scoreboard" on public.live_matches;
create policy "Anyone can create the live scoreboard"
  on public.live_matches for insert to anon, authenticated
  with check (
    id = '00000000-0000-0000-0000-000000000001'::uuid
    and challenge_id is null
    and match_pin is null
    and not is_pin_activated
  );

drop policy if exists "Anyone can update the live scoreboard" on public.live_matches;
create policy "Anyone can update the live scoreboard"
  on public.live_matches for update to anon, authenticated
  using (id = '00000000-0000-0000-0000-000000000001'::uuid)
  with check (
    id = '00000000-0000-0000-0000-000000000001'::uuid
    and challenge_id is null
    and match_pin is null
    and not is_pin_activated
  );

drop policy if exists "Participants can update their live match scores" on public.live_matches;
create policy "Participants can update their live match scores"
  on public.live_matches for update to authenticated
  using (
    exists (
      select 1
      from public.challenges as challenge
      join public.proffiles as profile
        on lower(profile.email) = lower(auth.jwt() ->> 'email')
      where challenge.id::text = live_matches.challenge_id
        and challenge.status = 'accepted'
        and live_matches.is_pin_activated
        and profile.id::text in (
          challenge.challenger_1_id::text,
          challenge.challenger_2_id::text,
          challenge.challenged_1_id::text,
          challenge.challenged_2_id::text
        )
    )
  )
  with check (
    exists (
      select 1
      from public.challenges as challenge
      join public.proffiles as profile
        on lower(profile.email) = lower(auth.jwt() ->> 'email')
      where challenge.id::text = live_matches.challenge_id
        and challenge.status = 'accepted'
        and live_matches.is_pin_activated
        and profile.id::text in (
          challenge.challenger_1_id::text,
          challenge.challenger_2_id::text,
          challenge.challenged_1_id::text,
          challenge.challenged_2_id::text
        )
    )
  );

revoke update on public.live_matches from anon, authenticated;
grant update (team_a_game_score, team_b_game_score, serving_team, initial_server_chosen)
  on public.live_matches to anon, authenticated;

revoke select on public.live_matches from anon;
grant select (
  id,
  challenge_id,
  team_a_player1_name,
  team_b_player1_name,
  team_a_game_score,
  team_b_game_score,
  serving_team,
  initial_server_chosen,
  is_pin_activated
) on public.live_matches to anon;

drop policy if exists "Kiosk can read activated live matches" on public.live_matches;
create policy "Kiosk can read activated live matches"
  on public.live_matches for select to anon, authenticated
  using (challenge_id is not null and is_pin_activated);

drop policy if exists "Kiosk can update activated live match scores" on public.live_matches;
create policy "Kiosk can update activated live match scores"
  on public.live_matches for update to anon, authenticated
  using (challenge_id is not null and is_pin_activated)
  with check (challenge_id is not null and is_pin_activated);

create or replace function public.activate_live_match_pin(p_match_pin text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  activated_match_id uuid;
begin
  if p_match_pin is null or p_match_pin !~ '^[0-9]{4}$' then
    raise exception 'Zadaj platný 4-miestny PIN.';
  end if;

  update public.live_matches
  set is_pin_activated = true
  where match_pin = p_match_pin
    and not is_pin_activated
    and challenge_id is not null
  returning id into activated_match_id;

  if activated_match_id is null then
    raise exception 'PIN nie je platný alebo už bol použitý.';
  end if;

  return activated_match_id;
end;
$$;

revoke all on function public.activate_live_match_pin(text) from public;
grant execute on function public.activate_live_match_pin(text) to anon, authenticated;

create or replace function public.respond_to_pair_challenge(p_challenge_id text, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id bigint;
  challenge_row public.challenges%rowtype;
  next_first_accepted boolean;
  next_second_accepted boolean;
  next_challenger_2_accepted boolean;
  next_status text;
  team_a_name text;
  team_b_name text;
  generated_pin text;
  pin_attempt smallint;
begin
  if auth.uid() is null then
    raise exception 'Prihlásenie je potrebné na odpoveď na výzvu.';
  end if;

  select profile.id
  into current_profile_id
  from public.proffiles as profile
  where lower(profile.email) = lower(auth.jwt() ->> 'email')
  limit 1;

  if current_profile_id is null then
    raise exception 'Profil prihláseného používateľa sa nenašiel.';
  end if;

  select *
  into challenge_row
  from public.challenges as challenge
  where challenge.id::text = p_challenge_id
  for update;

  if not found or challenge_row.status <> 'pending' then
    raise exception 'Čakajúca výzva sa nenašla.';
  end if;

  if current_profile_id::text not in (
    challenge_row.challenger_2_id::text,
    challenge_row.challenged_1_id::text,
    challenge_row.challenged_2_id::text
  ) then
    raise exception 'Na túto výzvu môže odpovedať iba jeden z troch pozvaných hráčov.';
  end if;

  if not p_accept then
    update public.challenges
    set status = 'declined'
    where id::text = p_challenge_id;
    next_status := 'declined';
  else
    next_first_accepted := challenge_row.challenged_1_accepted
      or current_profile_id::text = challenge_row.challenged_1_id::text;
    next_second_accepted := challenge_row.challenged_2_accepted
      or current_profile_id::text = challenge_row.challenged_2_id::text;
    next_challenger_2_accepted := challenge_row.challenger_2_accepted
      or current_profile_id::text = challenge_row.challenger_2_id::text;
    next_status := case
      when next_first_accepted and next_second_accepted and next_challenger_2_accepted then 'accepted'
      else 'pending'
    end;

    update public.challenges
    set challenged_1_accepted = next_first_accepted,
        challenged_2_accepted = next_second_accepted,
        challenger_2_accepted = next_challenger_2_accepted,
        status = next_status
    where id::text = p_challenge_id;

    if next_status = 'accepted' then
      select string_agg(coalesce(nullif(trim(profile.full_name), ''), 'Hráč'), ' & ' order by profile.id)
      into team_a_name
      from public.proffiles as profile
      where profile.id in (challenge_row.challenger_1_id, challenge_row.challenger_2_id);

      select string_agg(coalesce(nullif(trim(profile.full_name), ''), 'Hráč'), ' & ' order by profile.id)
      into team_b_name
      from public.proffiles as profile
      where profile.id in (challenge_row.challenged_1_id, challenge_row.challenged_2_id);

      if not exists (
        select 1 from public.live_matches as live_match
        where live_match.challenge_id = challenge_row.id::text
      ) then
        for pin_attempt in 1..100 loop
          generated_pin := lpad(floor(random() * 10000)::integer::text, 4, '0');
          insert into public.live_matches (
            challenge_id,
            match_pin,
            team_a_player1_name,
            team_b_player1_name
          )
          values (
            challenge_row.id::text,
            generated_pin,
            coalesce(team_a_name, 'Tím A'),
            coalesce(team_b_name, 'Tím B')
          )
          on conflict do nothing;
          exit when found;
        end loop;
        if not exists (
          select 1 from public.live_matches as live_match
          where live_match.challenge_id = challenge_row.id::text
        ) then
          raise exception 'Nepodarilo sa vygenerovať jedinečný PIN pre zápas.';
        end if;
      end if;
    end if;
  end if;

  update public.notifications
  set is_read = true
  where challenge_id = p_challenge_id
    and type in ('challenge_request', 'pair_challenge')
    and (not p_accept or user_id::text = current_profile_id::text);

  return next_status;
end;
$$;

revoke all on function public.respond_to_pair_challenge(text, boolean) from public;
grant execute on function public.respond_to_pair_challenge(text, boolean) to authenticated;

commit;
