-- Apply after 046_live_match_serve_statistics.sql.
begin;

alter table public.live_matches
  add column if not exists team_a_total_points_won integer not null default 0 check (team_a_total_points_won >= 0),
  add column if not exists team_b_total_points_won integer not null default 0 check (team_b_total_points_won >= 0),
  add column if not exists streak_team text check (streak_team in ('TEAM_A', 'TEAM_B')),
  add column if not exists current_point_streak integer not null default 0 check (current_point_streak >= 0),
  add column if not exists team_a_longest_point_streak integer not null default 0 check (team_a_longest_point_streak >= 0),
  add column if not exists team_b_longest_point_streak integer not null default 0 check (team_b_longest_point_streak >= 0),
  add column if not exists team_a_break_points integer not null default 0 check (team_a_break_points >= 0),
  add column if not exists team_a_break_points_converted integer not null default 0 check (team_a_break_points_converted >= 0),
  add column if not exists team_a_break_points_missed integer not null default 0 check (team_a_break_points_missed >= 0),
  add column if not exists team_b_break_points integer not null default 0 check (team_b_break_points >= 0),
  add column if not exists team_b_break_points_converted integer not null default 0 check (team_b_break_points_converted >= 0),
  add column if not exists team_b_break_points_missed integer not null default 0 check (team_b_break_points_missed >= 0),
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz;

alter table public.live_matches
  drop constraint if exists live_matches_team_a_break_points_accounted,
  drop constraint if exists live_matches_team_b_break_points_accounted,
  drop constraint if exists live_matches_finish_after_start;

alter table public.live_matches
  add constraint live_matches_team_a_break_points_accounted
    check (team_a_break_points = team_a_break_points_converted + team_a_break_points_missed),
  add constraint live_matches_team_b_break_points_accounted
    check (team_b_break_points = team_b_break_points_converted + team_b_break_points_missed),
  add constraint live_matches_finish_after_start
    check (finished_at is null or (started_at is not null and finished_at >= started_at));

-- Pre-migration rallies have no reliable duration, streak, or breakpoint history.
update public.live_matches
set statistics_complete = false
where team_a_game_score <> 0 or team_b_game_score <> 0
  or team_a_games <> 0 or team_b_games <> 0
  or team_a_sets <> 0 or team_b_sets <> 0
  or completed_sets <> '[]'::jsonb
  or team_a_player1_serve_points_won <> 0 or team_a_player1_serve_points_lost <> 0
  or team_a_player2_serve_points_won <> 0 or team_a_player2_serve_points_lost <> 0
  or team_b_player1_serve_points_won <> 0 or team_b_player1_serve_points_lost <> 0
  or team_b_player2_serve_points_won <> 0 or team_b_player2_serve_points_lost <> 0;

create or replace function public.guard_finished_live_match()
returns trigger language plpgsql set search_path = public as $$
begin
  if (old.team_a_sets >= 2 or old.team_b_sets >= 2) and (
    new.team_a_game_score is distinct from old.team_a_game_score
    or new.team_b_game_score is distinct from old.team_b_game_score
    or new.team_a_games is distinct from old.team_a_games
    or new.team_b_games is distinct from old.team_b_games
    or new.team_a_sets is distinct from old.team_a_sets
    or new.team_b_sets is distinct from old.team_b_sets
    or new.team_a_player1_points is distinct from old.team_a_player1_points
    or new.team_a_player2_points is distinct from old.team_a_player2_points
    or new.team_b_player1_points is distinct from old.team_b_player1_points
    or new.team_b_player2_points is distinct from old.team_b_player2_points
    or new.team_a_player1_serve_points_won is distinct from old.team_a_player1_serve_points_won
    or new.team_a_player1_serve_points_lost is distinct from old.team_a_player1_serve_points_lost
    or new.team_a_player2_serve_points_won is distinct from old.team_a_player2_serve_points_won
    or new.team_a_player2_serve_points_lost is distinct from old.team_a_player2_serve_points_lost
    or new.team_b_player1_serve_points_won is distinct from old.team_b_player1_serve_points_won
    or new.team_b_player1_serve_points_lost is distinct from old.team_b_player1_serve_points_lost
    or new.team_b_player2_serve_points_won is distinct from old.team_b_player2_serve_points_won
    or new.team_b_player2_serve_points_lost is distinct from old.team_b_player2_serve_points_lost
    or new.team_a_total_points_won is distinct from old.team_a_total_points_won
    or new.team_b_total_points_won is distinct from old.team_b_total_points_won
    or new.streak_team is distinct from old.streak_team
    or new.current_point_streak is distinct from old.current_point_streak
    or new.team_a_longest_point_streak is distinct from old.team_a_longest_point_streak
    or new.team_b_longest_point_streak is distinct from old.team_b_longest_point_streak
    or new.team_a_break_points is distinct from old.team_a_break_points
    or new.team_a_break_points_converted is distinct from old.team_a_break_points_converted
    or new.team_a_break_points_missed is distinct from old.team_a_break_points_missed
    or new.team_b_break_points is distinct from old.team_b_break_points
    or new.team_b_break_points_converted is distinct from old.team_b_break_points_converted
    or new.team_b_break_points_missed is distinct from old.team_b_break_points_missed
    or new.started_at is distinct from old.started_at
    or new.finished_at is distinct from old.finished_at
    or new.completed_sets is distinct from old.completed_sets
    or new.serving_team is distinct from old.serving_team
    or new.serving_player is distinct from old.serving_player
  ) then
    raise exception 'Zapas je ukonceny. Skore ani statistiky uz nie je mozne menit.';
  end if;
  return new;
end;
$$;

grant select (
  team_a_total_points_won, team_b_total_points_won, streak_team,
  current_point_streak, team_a_longest_point_streak, team_b_longest_point_streak,
  team_a_break_points, team_a_break_points_converted, team_a_break_points_missed,
  team_b_break_points, team_b_break_points_converted, team_b_break_points_missed,
  started_at, finished_at
) on public.live_matches to anon, authenticated;
grant update (
  team_a_total_points_won, team_b_total_points_won, streak_team,
  current_point_streak, team_a_longest_point_streak, team_b_longest_point_streak,
  team_a_break_points, team_a_break_points_converted, team_a_break_points_missed,
  team_b_break_points, team_b_break_points_converted, team_b_break_points_missed,
  started_at, finished_at
) on public.live_matches to anon, authenticated;

notify pgrst, 'reload schema';
commit;
