-- 031: Player statistics always derived from confirmed matches.
--
-- Before: respond_to_match_result added +1 match / +ELO to proffiles once, and
-- nothing undid it when a match was deleted, rejected or edited afterwards.
-- Now: proffiles.elo_rating, highest_elo, matches_played and matches_won are a
-- deterministic replay of every counted match (status confirmed/approved),
-- recomputed by triggers on INSERT / UPDATE / DELETE / TRUNCATE of matches.
-- Sets and games are already computed live from matches in the frontend.

begin;

alter table public.proffiles
  add column if not exists starting_elo integer not null default 1000;

alter table public.matches
  add column if not exists elo_applied boolean not null default false,
  add column if not exists elo_delta_team1 integer,
  add column if not exists elo_delta_team2 integer;

create or replace function public.recalculate_player_stats()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  team1_ids bigint[];
  team2_ids bigint[];
  team1_elo numeric;
  team2_elo numeric;
  team1_won boolean;
  team1_delta integer;
  previous_flag text := coalesce(current_setting('spl.recalculating_stats', true), '');
begin
  -- Serialize concurrent recalculations so they can't interleave.
  perform pg_advisory_xact_lock(hashtext('spl.recalculate_player_stats'));
  perform set_config('spl.recalculating_stats', 'on', true);

  create temp table if not exists spl_rating_replay (
    id bigint primary key, elo integer not null, highest integer not null,
    played integer not null, won integer not null
  ) on commit drop;
  truncate spl_rating_replay;
  insert into spl_rating_replay (id, elo, highest, played, won)
    select id, coalesce(starting_elo, 1000), coalesce(starting_elo, 1000), 0, 0 from public.proffiles;

  for m in
    select id, player1_id, team1_player2_id, player2_id, team2_player2_id, winner_id,
           elo_applied, elo_delta_team1, elo_delta_team2
    from public.matches
    where status in ('confirmed', 'approved') and winner_id is not null
    order by match_date nulls last, id
  loop
    team1_ids := array_remove(array[m.player1_id, m.team1_player2_id], null);
    team2_ids := array_remove(array[m.player2_id, m.team2_player2_id], null);
    if cardinality(team1_ids) = 0 or cardinality(team2_ids) = 0 then continue; end if;

    select avg(elo) into team1_elo from spl_rating_replay where id = any(team1_ids);
    select avg(elo) into team2_elo from spl_rating_replay where id = any(team2_ids);
    team1_won := m.winner_id = any(team1_ids);
    team1_delta := round(32 * ((case when team1_won then 1 else 0 end)
      - 1 / (1 + power(10::numeric, (coalesce(team2_elo, 1000) - coalesce(team1_elo, 1000)) / 400))));

    update spl_rating_replay
      set elo = elo + case when id = any(team1_ids) then team1_delta else -team1_delta end,
          highest = greatest(highest, elo + case when id = any(team1_ids) then team1_delta else -team1_delta end),
          played = played + 1,
          won = won + case when (id = any(team1_ids)) = team1_won then 1 else 0 end
      where id = any(team1_ids || team2_ids);

    if not m.elo_applied or m.elo_delta_team1 is distinct from team1_delta
      or m.elo_delta_team2 is distinct from -team1_delta then
      update public.matches
        set elo_applied = true, elo_delta_team1 = team1_delta, elo_delta_team2 = -team1_delta
        where id = m.id;
    end if;
  end loop;

  update public.matches
    set elo_applied = false, elo_delta_team1 = null, elo_delta_team2 = null
    where elo_applied
      and not (status in ('confirmed', 'approved') and winner_id is not null);

  perform set_config('spl.match_stats_update', 'on', true);
  update public.proffiles as p
    set elo_rating = r.elo, highest_elo = r.highest, matches_played = r.played, matches_won = r.won
    from spl_rating_replay as r
    where p.id = r.id
      and (p.elo_rating, p.highest_elo, p.matches_played, p.matches_won)
        is distinct from (r.elo, r.highest, r.played, r.won);
  perform set_config('spl.match_stats_update', 'off', true);

  perform set_config('spl.recalculating_stats', previous_flag, true);
end;
$$;

revoke all on function public.recalculate_player_stats() from public, anon, authenticated;

-- Trigger function: recalculates only when a counted (confirmed) match is involved.
create or replace function public.matches_recalculate_player_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affects_stats boolean := false;
begin
  if coalesce(current_setting('spl.recalculating_stats', true), '') = 'on' then return null; end if;

  if tg_op = 'TRUNCATE' then
    affects_stats := true;
  elsif tg_op = 'INSERT' then
    select exists (select 1 from new_rows where status in ('confirmed', 'approved')) into affects_stats;
  elsif tg_op = 'DELETE' then
    select exists (select 1 from old_rows where status in ('confirmed', 'approved') or elo_applied) into affects_stats;
  else
    select exists (select 1 from old_rows where status in ('confirmed', 'approved') or elo_applied)
      or exists (select 1 from new_rows where status in ('confirmed', 'approved'))
      into affects_stats;
  end if;

  if affects_stats then perform public.recalculate_player_stats(); end if;
  return null;
end;
$$;

drop trigger if exists matches_stats_after_insert on public.matches;
drop trigger if exists matches_stats_after_update on public.matches;
drop trigger if exists matches_stats_after_delete on public.matches;
drop trigger if exists matches_stats_after_truncate on public.matches;

create trigger matches_stats_after_insert
  after insert on public.matches referencing new table as new_rows
  for each statement execute function public.matches_recalculate_player_stats();
create trigger matches_stats_after_update
  after update on public.matches referencing old table as old_rows new table as new_rows
  for each statement execute function public.matches_recalculate_player_stats();
create trigger matches_stats_after_delete
  after delete on public.matches referencing old table as old_rows
  for each statement execute function public.matches_recalculate_player_stats();
create trigger matches_stats_after_truncate
  after truncate on public.matches
  for each statement execute function public.matches_recalculate_player_stats();

-- Confirmation RPC: only records confirmations / status. Statistics come from the trigger.
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

  if not (current_profile_id = any(approved_ids)) then
    approved_ids := array_append(approved_ids, current_profile_id);
  end if;

  if not (participant_ids <@ approved_ids) then
    update public.matches set approved_profile_ids = approved_ids where id = match_record.id;
    return 'pending';
  end if;

  if match_record.winner_id is null then
    raise exception 'Zápas nemá určeného víťaza.';
  end if;

  -- Last confirmation: the status change fires the stats trigger (ELO + stats).
  update public.matches set approved_profile_ids = approved_ids, status = 'confirmed'
    where id = match_record.id;
  return 'confirmed';
end;
$$;

revoke all on function public.respond_to_match_result(text, boolean) from public, anon;
grant execute on function public.respond_to_match_result(text, boolean) to authenticated;

-- Let the frontend receive live UPDATE events when the trigger rewrites a profile's stats.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'proffiles'
    ) then
    alter publication supabase_realtime add table public.proffiles;
  end if;
end $$;

-- Fix any statistics that are already stuck.
select public.recalculate_player_stats();

notify pgrst, 'reload schema';

commit;
