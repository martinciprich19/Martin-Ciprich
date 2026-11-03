-- Apply after 073. Include paused matches without exposing resume PINs or tokens.
begin;

drop function if exists public.get_public_live_matches(text);
create function public.get_public_live_matches(p_country_code text default null)
returns table (
  id uuid, team_a_player1_name text, team_a_player2_name text,
  team_b_player1_name text, team_b_player2_name text,
  team_a_game_score smallint, team_b_game_score smallint,
  team_a_games integer, team_b_games integer, team_a_sets integer, team_b_sets integer,
  started_at timestamptz, arena_id bigint, arena_name text, city text, region text,
  country_code text, paused_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select game.id, game.team_a_player1_name, game.team_a_player2_name,
    game.team_b_player1_name, game.team_b_player2_name,
    game.team_a_game_score, game.team_b_game_score,
    game.team_a_games, game.team_b_games, game.team_a_sets, game.team_b_sets,
    game.started_at, arena.id, coalesce(arena.name, nullif(trim(game.qr_arena_name), '')),
    arena.city, arena.region, game.country_code, game.paused_at
  from public.live_matches game
  left join lateral (
    select venue.id, venue.name, venue.city, venue.region from public.arenas venue
    where venue.is_active and venue.country_code = game.country_code and (
      (game.challenge_id is not null and exists (
        select 1 from public.challenges challenge where challenge.id::text = game.challenge_id
          and challenge.arena_id::text = venue.id::text
      )) or (game.qr_arena_name is not null
        and lower(trim(game.qr_arena_name)) = lower(trim(venue.name))))
    order by case when game.challenge_id is not null and exists (
      select 1 from public.challenges challenge where challenge.id::text = game.challenge_id
        and challenge.arena_id::text = venue.id::text
    ) then 0 else 1 end
    limit 1
  ) arena on true
  where game.id <> '00000000-0000-0000-0000-000000000001'::uuid
    and (p_country_code is null or game.country_code = p_country_code)
    and game.started_at is not null and game.initial_server_chosen
    and game.finished_at is null and game.ended_early_at is null
    and (game.challenge_id is null or game.is_pin_activated)
  order by game.started_at desc;
$$;
revoke all on function public.get_public_live_matches(text) from public;
grant execute on function public.get_public_live_matches(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
