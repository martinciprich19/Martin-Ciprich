-- Public directory for matches currently scored in the app.
-- Only active match details needed by the live-matches page are returned.
begin;

-- Some deployed arenas tables predate the region field used by the directory.
alter table public.arenas
  add column if not exists region text;

-- The deployed table may use `active` instead of the app schema's `is_active`.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'arenas'
      and column_name = 'is_active'
  ) then
    alter table public.arenas
      add column is_active boolean not null default true;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'arenas'
        and column_name = 'active'
    ) then
      execute 'update public.arenas set is_active = coalesce(active, true)';
    end if;
  end if;
end;
$$;

-- The deployed arenas.id is bigint, so replace the earlier UUID return type.
drop function if exists public.get_public_live_matches();

create function public.get_public_live_matches()
returns table (
  id uuid,
  team_a_player1_name text,
  team_a_player2_name text,
  team_b_player1_name text,
  team_b_player2_name text,
  team_a_game_score smallint,
  team_b_game_score smallint,
  team_a_games integer,
  team_b_games integer,
  team_a_sets integer,
  team_b_sets integer,
  started_at timestamptz,
  arena_id bigint,
  arena_name text,
  city text,
  region text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    game.id,
    game.team_a_player1_name,
    game.team_a_player2_name,
    game.team_b_player1_name,
    game.team_b_player2_name,
    game.team_a_game_score,
    game.team_b_game_score,
    game.team_a_games,
    game.team_b_games,
    game.team_a_sets,
    game.team_b_sets,
    game.started_at,
    arena.id,
    coalesce(arena.name, nullif(trim(game.qr_arena_name), '')),
    arena.city,
    arena.region
  from public.live_matches as game
  left join lateral (
    select venue.id, venue.name, venue.city, venue.region
    from public.arenas as venue
    where venue.is_active
      and (
        (game.challenge_id is not null and exists (
          select 1
          from public.challenges as challenge
          where challenge.id::text = game.challenge_id
            and challenge.arena_id = venue.id
        ))
        or (
          game.qr_arena_name is not null
          and lower(trim(game.qr_arena_name)) = lower(trim(venue.name))
        )
      )
    order by case
      when game.challenge_id is not null and exists (
        select 1
        from public.challenges as challenge
        where challenge.id::text = game.challenge_id
          and challenge.arena_id = venue.id
      ) then 0
      else 1
    end
    limit 1
  ) as arena on true
  where game.id <> '00000000-0000-0000-0000-000000000001'::uuid
    and game.started_at is not null
    and game.initial_server_chosen
    and game.finished_at is null
    and game.ended_early_at is null
    and game.paused_at is null
    and (game.challenge_id is null or game.is_pin_activated)
  order by game.started_at desc;
$$;

revoke all on function public.get_public_live_matches() from public;
grant execute on function public.get_public_live_matches() to anon, authenticated;

notify pgrst, 'reload schema';

commit;
