-- 034: Seasonal ELO vs. all-time (career) ELO.
--
--   proffiles.elo_rating        "Aktuálne ELO"       seasonal rating, restarts from starting_elo
--                                                     every half-year (1. január, 1. júl, Europe/Bratislava)
--   proffiles.career_elo        "ELO od registrácie" continuous rating from all confirmed matches since
--                                                     registration, never reset
--   proffiles.highest_elo       all-time peak of career_elo
--   proffiles.starting_elo      base rating both values start from (default 1000)
--   proffiles.elo_season_start  season the current elo_rating belongs to
--   matches.elo_delta_team1/2         seasonal ELO change of the match
--   matches.career_elo_delta_team1/2  career ELO change of the match
--
-- Everything is recomputed by public.recalculate_player_stats(), which the matches
-- triggers from migration 031 call on every insert/update/delete of a confirmed match.
-- Requires migrations 031-033.

begin;

create or replace function public.spl_season_start(p_at timestamptz)
returns date
language sql
stable
set search_path = public
as $$
  select make_date(
    extract(year from local_at)::integer,
    case when extract(month from local_at) >= 7 then 7 else 1 end,
    1
  )
  from (select p_at at time zone 'Europe/Bratislava' as local_at) as converted;
$$;

alter table public.proffiles
  add column if not exists starting_elo integer not null default 1000,
  add column if not exists career_elo integer not null default 1000,
  add column if not exists elo_season_start date default public.spl_season_start(now());

alter table public.matches
  add column if not exists career_elo_delta_team1 integer,
  add column if not exists career_elo_delta_team2 integer;

-- Rating/statistic columns may only change through the recalculation.
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
    or new.matches_won is distinct from old.matches_won
    or new.career_elo is distinct from old.career_elo
    or new.starting_elo is distinct from old.starting_elo
    or new.elo_season_start is distinct from old.elo_season_start then
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

-- Season rollover: cheap no-op unless some profile still holds last season's rating.
create or replace function public.refresh_season_ratings()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.proffiles
    where elo_season_start is distinct from public.spl_season_start(now())
  ) then
    perform public.recalculate_player_stats();
  end if;
end;
$$;

revoke all on function public.refresh_season_ratings() from public, anon;
grant execute on function public.refresh_season_ratings() to authenticated;

-- If pg_cron is enabled, reset ratings right after each season boundary.
-- Without pg_cron the app triggers refresh_season_ratings() when a profile loads.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'spl-season-reset';
    perform cron.schedule('spl-season-reset', '5 0 1 1,7 *', 'select public.refresh_season_ratings()');
  end if;
end $$;

select public.recalculate_player_stats();

commit;

notify pgrst, 'reload schema';
