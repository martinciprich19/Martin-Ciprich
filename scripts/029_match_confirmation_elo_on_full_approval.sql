begin;

-- Each participant's confirmation is stored in matches.approved_profile_ids.
-- ELO and player statistics are applied exactly once, only when every participant has confirmed.

alter table public.matches
  add column if not exists approved_profile_ids bigint[] not null default '{}',
  add column if not exists rejected_by bigint references public.proffiles(id),
  add column if not exists elo_applied boolean not null default false,
  add column if not exists elo_delta_team1 integer,
  add column if not exists elo_delta_team2 integer;

-- Block direct client writes to rating/statistic columns; only the match RPC may change them.
create or replace function public.guard_proffiles_match_stats()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('spl.match_stats_update', true), '') = 'on'
    or coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.elo_rating is distinct from old.elo_rating
    or new.highest_elo is distinct from old.highest_elo
    or new.matches_played is distinct from old.matches_played
    or new.matches_won is distinct from old.matches_won then
    raise exception 'ELO a štatistiky sa aktualizujú iba po potvrdení zápasu všetkými hráčmi.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_proffiles_match_stats on public.proffiles;
create trigger guard_proffiles_match_stats
  before update on public.proffiles
  for each row execute function public.guard_proffiles_match_stats();

create or replace function public.respond_to_match_result(p_match_id text, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id bigint;
  match_record public.matches%rowtype;
  participant_ids bigint[];
  approved_ids bigint[];
  team1_ids bigint[];
  team1_elo numeric;
  team2_elo numeric;
  expected_team1 numeric;
  team1_delta integer;
begin
  if auth.uid() is null then raise exception 'Prihlásenie je potrebné.'; end if;
  if p_accept is null then raise exception 'Vyber potvrdenie alebo odmietnutie.'; end if;

  select id into current_profile_id from public.proffiles
    where lower(email) = lower(auth.jwt() ->> 'email') limit 1;

  select * into match_record from public.matches where id::text = p_match_id for update;
  if not found then raise exception 'Zápas sa nenašiel.'; end if;

  participant_ids := array_remove(array[
    match_record.player1_id, match_record.team1_player2_id,
    match_record.player2_id, match_record.team2_player2_id
  ], null);
  team1_ids := array_remove(array[match_record.player1_id, match_record.team1_player2_id], null);

  if current_profile_id is null or not (current_profile_id = any(participant_ids)) then
    raise exception 'Na výsledok môže odpovedať iba účastník zápasu.';
  end if;

  if match_record.status in ('confirmed', 'approved') then return 'confirmed'; end if;
  if match_record.status <> 'pending' then return 'rejected'; end if;

  approved_ids := coalesce(match_record.approved_profile_ids, '{}');

  if not p_accept then
    if current_profile_id = any(approved_ids) then
      raise exception 'Tento výsledok si už potvrdil.';
    end if;
    update public.matches set status = 'rejected', rejected_by = current_profile_id
      where id = match_record.id;
    return 'rejected';
  end if;

  -- Individual confirmation: persist it, but do not touch ELO or statistics yet.
  if not (current_profile_id = any(approved_ids)) then
    approved_ids := array_append(approved_ids, current_profile_id);
    update public.matches set approved_profile_ids = approved_ids where id = match_record.id;
  end if;

  if not (participant_ids <@ approved_ids) then return 'pending'; end if;

  -- Final confirmation: everyone approved -> apply ELO and statistics exactly once.
  if match_record.elo_applied then
    update public.matches set status = 'confirmed' where id = match_record.id;
    return 'confirmed';
  end if;
  if match_record.winner_id is null then
    raise exception 'Zápas nemá určeného víťaza.';
  end if;

  perform id from public.proffiles where id = any(participant_ids) order by id for update;
  select avg(coalesce(elo_rating, 1000)) into team1_elo from public.proffiles
    where id = any(team1_ids);
  select avg(coalesce(elo_rating, 1000)) into team2_elo from public.proffiles
    where id = any(participant_ids) and not (id = any(team1_ids));
  expected_team1 := 1 / (1 + power(10::numeric, (coalesce(team2_elo, 1000) - coalesce(team1_elo, 1000)) / 400));
  team1_delta := round(32 * ((case when match_record.winner_id = any(team1_ids) then 1 else 0 end) - expected_team1));

  perform set_config('spl.match_stats_update', 'on', true);
  update public.proffiles as profile
  set elo_rating = coalesce(profile.elo_rating, 1000) + case when profile.id = any(team1_ids) then team1_delta else -team1_delta end,
      highest_elo = greatest(
        coalesce(profile.highest_elo, profile.elo_rating, 1000),
        coalesce(profile.elo_rating, 1000) + case when profile.id = any(team1_ids) then team1_delta else -team1_delta end
      ),
      matches_played = coalesce(profile.matches_played, 0) + 1,
      matches_won = coalesce(profile.matches_won, 0)
        + case when (profile.id = any(team1_ids)) = (match_record.winner_id = any(team1_ids)) then 1 else 0 end
  where profile.id = any(participant_ids);
  perform set_config('spl.match_stats_update', 'off', true);

  update public.matches
    set status = 'confirmed', elo_applied = true,
        elo_delta_team1 = team1_delta, elo_delta_team2 = -team1_delta
    where id = match_record.id;
  return 'confirmed';
end;
$$;

revoke all on function public.respond_to_match_result(text, boolean) from public;
grant execute on function public.respond_to_match_result(text, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
