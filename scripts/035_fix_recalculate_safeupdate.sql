-- 035: Supabase's pg_safeupdate rejects UPDATE without WHERE for API (RPC) calls.
-- recalculate_player_stats() from 034 reset seasonal ratings with a bare UPDATE, so the final
-- match confirmation (which triggers the recalculation) failed with "UPDATE requires a WHERE clause".

begin;

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
  team1_won boolean;
  team1_score integer;
  career_team1 numeric;
  career_team2 numeric;
  season_team1 numeric;
  season_team2 numeric;
  career_delta integer;
  season_delta integer;
  match_season date;
  replay_season date;
  current_season date := public.spl_season_start(now());
  previous_flag text := coalesce(current_setting('spl.recalculating_stats', true), '');
begin
  perform pg_advisory_xact_lock(hashtext('spl.recalculate_player_stats'));
  perform set_config('spl.recalculating_stats', 'on', true);

  create temp table if not exists spl_rating_replay (
    id bigint primary key, base integer not null,
    career integer not null, career_highest integer not null, season integer not null,
    played integer not null, won integer not null
  ) on commit drop;
  truncate spl_rating_replay;
  insert into spl_rating_replay (id, base, career, career_highest, season, played, won)
    select id, coalesce(starting_elo, 1000), coalesce(starting_elo, 1000), coalesce(starting_elo, 1000),
           coalesce(starting_elo, 1000), 0, 0
    from public.proffiles;

  for m in
    select id, player1_id, team1_player2_id, player2_id, team2_player2_id, winner_id, match_date,
           elo_applied, elo_delta_team1, elo_delta_team2, career_elo_delta_team1, career_elo_delta_team2
    from public.matches
    where status in ('confirmed', 'approved') and winner_id is not null
    order by match_date nulls last, id
  loop
    team1_ids := array_remove(array[m.player1_id, m.team1_player2_id], null);
    team2_ids := array_remove(array[m.player2_id, m.team2_player2_id], null);
    if cardinality(team1_ids) = 0 or cardinality(team2_ids) = 0 then continue; end if;

    -- New season: every player's seasonal rating restarts from their base rating.
    match_season := public.spl_season_start(coalesce(m.match_date, now()));
    if replay_season is distinct from match_season then
      update spl_rating_replay set season = base where season is distinct from base;
      replay_season := match_season;
    end if;

    team1_won := m.winner_id = any(team1_ids);
    team1_score := case when team1_won then 1 else 0 end;

    select avg(career), avg(season) into career_team1, season_team1 from spl_rating_replay where id = any(team1_ids);
    select avg(career), avg(season) into career_team2, season_team2 from spl_rating_replay where id = any(team2_ids);
    career_delta := round(32 * (team1_score
      - 1 / (1 + power(10::numeric, (coalesce(career_team2, 1000) - coalesce(career_team1, 1000)) / 400))));
    season_delta := round(32 * (team1_score
      - 1 / (1 + power(10::numeric, (coalesce(season_team2, 1000) - coalesce(season_team1, 1000)) / 400))));

    update spl_rating_replay
      set career = career + case when id = any(team1_ids) then career_delta else -career_delta end,
          career_highest = greatest(career_highest, career + case when id = any(team1_ids) then career_delta else -career_delta end),
          season = season + case when id = any(team1_ids) then season_delta else -season_delta end,
          played = played + 1,
          won = won + case when (id = any(team1_ids)) = team1_won then 1 else 0 end
      where id = any(team1_ids || team2_ids);

    if not m.elo_applied
      or m.elo_delta_team1 is distinct from season_delta or m.elo_delta_team2 is distinct from -season_delta
      or m.career_elo_delta_team1 is distinct from career_delta or m.career_elo_delta_team2 is distinct from -career_delta then
      update public.matches
        set elo_applied = true,
            elo_delta_team1 = season_delta, elo_delta_team2 = -season_delta,
            career_elo_delta_team1 = career_delta, career_elo_delta_team2 = -career_delta
        where id = m.id;
    end if;
  end loop;

  -- No confirmed match yet in the current season: seasonal ratings start fresh.
  if replay_season is distinct from current_season then
    update spl_rating_replay set season = base where season is distinct from base;
  end if;

  update public.matches
    set elo_applied = false, elo_delta_team1 = null, elo_delta_team2 = null,
        career_elo_delta_team1 = null, career_elo_delta_team2 = null
    where elo_applied
      and not (status in ('confirmed', 'approved') and winner_id is not null);

  perform set_config('spl.match_stats_update', 'on', true);
  update public.proffiles as p
    set elo_rating = r.season, career_elo = r.career, highest_elo = r.career_highest,
        matches_played = r.played, matches_won = r.won, elo_season_start = current_season
    from spl_rating_replay as r
    where p.id = r.id
      and (p.elo_rating, p.career_elo, p.highest_elo, p.matches_played, p.matches_won, p.elo_season_start)
        is distinct from (r.season, r.career, r.career_highest, r.played, r.won, current_season);
  perform set_config('spl.match_stats_update', 'off', true);

  perform set_config('spl.recalculating_stats', previous_flag, true);
end;
$$;

revoke all on function public.recalculate_player_stats() from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
