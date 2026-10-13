-- Apply after 045_live_match_finish_statistics.sql. No official results / ELO writes.
begin;

alter table public.live_matches
  add column if not exists team_a_player1_serve_points_won integer not null default 0 check (team_a_player1_serve_points_won >= 0),
  add column if not exists team_a_player1_serve_points_lost integer not null default 0 check (team_a_player1_serve_points_lost >= 0),
  add column if not exists team_a_player2_serve_points_won integer not null default 0 check (team_a_player2_serve_points_won >= 0),
  add column if not exists team_a_player2_serve_points_lost integer not null default 0 check (team_a_player2_serve_points_lost >= 0),
  add column if not exists team_b_player1_serve_points_won integer not null default 0 check (team_b_player1_serve_points_won >= 0),
  add column if not exists team_b_player1_serve_points_lost integer not null default 0 check (team_b_player1_serve_points_lost >= 0),
  add column if not exists team_b_player2_serve_points_won integer not null default 0 check (team_b_player2_serve_points_won >= 0),
  add column if not exists team_b_player2_serve_points_lost integer not null default 0 check (team_b_player2_serve_points_lost >= 0);

-- Serve outcomes from before these counters existed cannot be reconstructed reliably.
update public.live_matches
set statistics_complete = false
where team_a_game_score <> 0 or team_b_game_score <> 0
  or team_a_games <> 0 or team_b_games <> 0
  or team_a_sets <> 0 or team_b_sets <> 0
  or completed_sets <> '[]'::jsonb
  or team_a_player1_points <> 0 or team_a_player2_points <> 0
  or team_b_player1_points <> 0 or team_b_player2_points <> 0;

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
  team_a_player1_serve_points_won, team_a_player1_serve_points_lost,
  team_a_player2_serve_points_won, team_a_player2_serve_points_lost,
  team_b_player1_serve_points_won, team_b_player1_serve_points_lost,
  team_b_player2_serve_points_won, team_b_player2_serve_points_lost
) on public.live_matches to anon, authenticated;
grant update (
  team_a_player1_serve_points_won, team_a_player1_serve_points_lost,
  team_a_player2_serve_points_won, team_a_player2_serve_points_lost,
  team_b_player1_serve_points_won, team_b_player1_serve_points_lost,
  team_b_player2_serve_points_won, team_b_player2_serve_points_lost
) on public.live_matches to anon, authenticated;

notify pgrst, 'reload schema';
commit;
