-- Apply after 073. Expose the current server without changing court visibility.
begin;

drop function public.get_court_scoreboard(bigint);
create function public.get_court_scoreboard(p_court_id bigint)
returns table (
  court_id bigint, arena_id bigint, court_name text, match_id uuid,
  team_a_player1_name text, team_a_player2_name text,
  team_b_player1_name text, team_b_player2_name text,
  team_a_game_score smallint, team_b_game_score smallint,
  advantage_team text, tiebreak_score jsonb,
  team_a_games integer, team_b_games integer,
  team_a_sets integer, team_b_sets integer,
  started_at timestamptz, paused_at timestamptz,
  serving_team text, serving_player smallint
)
language sql stable security definer set search_path = ''
as $$
  select
    court.id, court.arena_id, court.name, game.id,
    game.team_a_player1_name, game.team_a_player2_name,
    game.team_b_player1_name, game.team_b_player2_name,
    game.team_a_game_score, game.team_b_game_score,
    game.advantage_team, game.tiebreak_score,
    game.team_a_games, game.team_b_games,
    game.team_a_sets, game.team_b_sets,
    game.started_at, game.paused_at, game.serving_team, game.serving_player
  from public.arena_courts court
  join public.arenas arena on arena.id = court.arena_id and arena.is_active
  left join lateral (
    select live.*
    from public.live_matches live
    where live.court_id = court.id
      and live.started_at is not null
      and live.initial_server_chosen
      and live.finished_at is null
      and live.ended_early_at is null
      and (live.challenge_id is null or live.is_pin_activated)
    order by live.started_at desc
    limit 1
  ) game on true
  where court.id = p_court_id and court.is_active;
$$;

revoke all on function public.get_court_scoreboard(bigint) from public;
grant execute on function public.get_court_scoreboard(bigint) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
