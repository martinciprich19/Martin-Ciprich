-- Apply the entire file AFTER 068 and BEFORE enabling Dutch writes.
-- No historical rows, scoring guards, RPC authorization or RLS policies are replaced.
begin;

-- NULL now means "derive membership", not "silently assign Slovakia".
-- Existing NOT NULL constraints remain: the BEFORE triggers always supply a country.
alter table public.pairs alter column country_code drop default;
alter table public.challenges alter column country_code drop default;
alter table public.matches alter column country_code drop default;
alter table public.live_matches alter column country_code drop default;

create or replace function public.national_league_for_players(ids bigint[], expected_count integer)
returns text language plpgsql security definer set search_path = '' as $$
declare
  member record;
  league text;
  total integer := 0;
begin
  if cardinality(ids) <> expected_count or array_position(ids, null) is not null
    or (select count(distinct id) from unnest(ids) id) <> expected_count then
    raise exception 'National league games require % distinct registered players.', expected_count;
  end if;
  for member in select p.id, p.country_code from public.proffiles p
    where p.id = any(ids) order by p.id for key share loop
    total := total + 1;
    if league is not null and league <> member.country_code then
      raise exception 'Players must belong to the same national league.';
    end if;
    league := member.country_code;
  end loop;
  if total <> expected_count then raise exception 'Registered player not found.'; end if;
  return league;
end;
$$;
revoke all on function public.national_league_for_players(bigint[], integer) from public, anon, authenticated;

create or replace function public.guard_profile_national_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  row_data jsonb := to_jsonb(new);
  venue text;
begin
  if tg_op = 'UPDATE' and new.country_code is distinct from old.country_code then
    -- Membership migration requires a separate audited administrative workflow.
    -- In particular, changing the directory country is never a membership change.
    raise exception 'National league membership cannot be changed through profile updates.';
  end if;
  foreach venue in array array[row_data ->> 'home_venue_id', row_data ->> 'auto_venue_id'] loop
    if venue is not null and exists (
      select 1 from public.arenas a where a.id::text = venue and a.country_code <> new.country_code
    ) then raise exception 'Home arena must belong to the profile national league.'; end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.guard_profile_national_membership() from public, anon, authenticated;
drop trigger if exists c_guard_profile_national_membership on public.proffiles;
create trigger c_guard_profile_national_membership before insert or update on public.proffiles
  for each row execute function public.guard_profile_national_membership();

create or replace function public.route_national_league_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  row_data jsonb := to_jsonb(new);
  old_data jsonb;
  ids bigint[];
  league text;
  source_country text;
  venue_id text := row_data ->> 'arena_id';
  venue_name text;
  routing_keys text[];
begin
  if tg_table_name = 'pairs' then
    routing_keys := array['country_code', 'player_1_id', 'player_2_id'];
    ids := array[(row_data ->> 'player_1_id')::bigint, (row_data ->> 'player_2_id')::bigint];
  elsif tg_table_name = 'challenges' then
    routing_keys := array['country_code', 'challenger_1_id', 'challenger_2_id',
      'challenged_1_id', 'challenged_2_id', 'arena_id'];
    ids := array[(row_data ->> 'challenger_1_id')::bigint, (row_data ->> 'challenger_2_id')::bigint,
      (row_data ->> 'challenged_1_id')::bigint, (row_data ->> 'challenged_2_id')::bigint];
  elsif tg_table_name = 'matches' then
    routing_keys := array['country_code', 'player1_id', 'team1_player2_id',
      'player2_id', 'team2_player2_id', 'arena_id', 'arena_name'];
    ids := array[(row_data ->> 'player1_id')::bigint, (row_data ->> 'team1_player2_id')::bigint,
      (row_data ->> 'player2_id')::bigint, (row_data ->> 'team2_player2_id')::bigint];
    venue_name := row_data ->> 'arena_name';
  elsif tg_table_name = 'live_matches' then
    routing_keys := array['country_code', 'challenge_id', 'team_a_player1_id', 'team_a_player2_id',
      'team_b_player1_id', 'team_b_player2_id', 'qr_created_by', 'qr_arena_name'];
    ids := array[(row_data ->> 'team_a_player1_id')::bigint, (row_data ->> 'team_a_player2_id')::bigint,
      (row_data ->> 'team_b_player1_id')::bigint, (row_data ->> 'team_b_player2_id')::bigint];
    venue_name := row_data ->> 'qr_arena_name';
  elsif tg_table_name = 'player_requests' then
    routing_keys := array['country_code', 'user_id', 'arena_id'];
    ids := array[(row_data ->> 'user_id')::bigint];
  end if;

  if tg_op = 'UPDATE' then
    old_data := to_jsonb(old);
    -- Score/status/approval updates must not reclassify historical SK records.
    if not exists (select 1 from unnest(routing_keys) key
      where row_data -> key is distinct from old_data -> key) then return new; end if;
    if new.country_code is distinct from old.country_code then
      -- Only the private rematch-link trigger can initialize a quick replay's snapshot.
      if tg_table_name <> 'live_matches' then
        raise exception 'The national league snapshot cannot be changed.';
      end if;
      if not exists (
        select 1 from public.live_match_rematches r
        join public.live_matches previous on previous.id = r.previous_match_id
        where r.next_match_id::text = row_data ->> 'id'
          and previous.country_code = new.country_code
          and row_data ->> 'challenge_id' is null and row_data ->> 'qr_created_by' is null
          and row_data ->> 'started_at' is null
      ) then raise exception 'The national league snapshot cannot be changed.'; end if;
    end if;
  end if;

  if tg_table_name = 'live_matches' then
    if row_data ->> 'challenge_id' is not null then
      select c.country_code into source_country from public.challenges c
        where c.id::text = row_data ->> 'challenge_id';
      if not found then raise exception 'Challenge not found.'; end if;
      -- Challenge creation has already validated all four memberships.
      if array_remove(ids, null) <> '{}'::bigint[] then
        league := public.national_league_for_players(ids, 4);
        if league <> source_country then raise exception 'Challenge national league mismatch.'; end if;
      end if;
      league := source_country;
    elsif row_data ->> 'qr_created_by' is not null or array_remove(ids, null) <> '{}'::bigint[] then
      league := public.national_league_for_players(ids, 4);
    else
      -- Guest quick games may explicitly select a country. Old no-country clients
      -- still work; authenticated quick games inherit the actual membership.
      select p.country_code into league from public.proffiles p
        where lower(p.email) = lower(auth.jwt() ->> 'email') limit 1;
      new.country_code := coalesce(new.country_code, league, 'SK');
      league := new.country_code;
    end if;
  else
    league := public.national_league_for_players(ids, cardinality(ids));
  end if;
  if new.country_code is not null and new.country_code <> league then
    raise exception 'Selected country does not match the participants national league.';
  end if;
  new.country_code := league;
  if tg_op = 'UPDATE' and new.country_code is distinct from old.country_code
    and tg_table_name <> 'live_matches' then
    raise exception 'The national league snapshot cannot be changed.';
  end if;

  -- Compare text representations, never cast a deployed bigint arena ID to UUID.
  if venue_id is not null and not exists (
    select 1 from public.arenas a where a.id::text = venue_id and a.country_code = league
  ) then raise exception 'Arena must belong to the same national league.'; end if;
  -- Free-text legacy/QR arenas remain allowed; known venues cannot cross leagues.
  if nullif(trim(venue_name), '') is not null
    and exists (select 1 from public.arenas a where lower(trim(a.name)) = lower(trim(venue_name)))
    and not exists (select 1 from public.arenas a
      where lower(trim(a.name)) = lower(trim(venue_name)) and a.country_code = league)
    then raise exception 'Arena must belong to the same national league.'; end if;
  return new;
end;
$$;
revoke all on function public.route_national_league_row() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['pairs', 'challenges', 'matches', 'live_matches', 'player_requests'] loop
    if to_regclass(format('public.%I', table_name)) is null then continue; end if;
    execute format('alter table public.%I alter column country_code drop default', table_name);
    execute format('drop trigger if exists a_route_national_league on public.%I', table_name);
    execute format('create trigger a_route_national_league before insert or update on public.%I for each row execute function public.route_national_league_row()', table_name);
  end loop;
end;
$$;

-- Preserve the existing rematch RPC signature and its authorization/idempotency.
-- The link is inserted by that security-definer RPC, never directly by clients.
create or replace function public.route_quick_rematch_country()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.live_matches next_game set country_code = previous.country_code
  from public.live_matches previous
  where previous.id = new.previous_match_id and next_game.id = new.next_match_id
    and next_game.challenge_id is null and next_game.qr_created_by is null
    and next_game.country_code is distinct from previous.country_code;
  return new;
end;
$$;
revoke all on function public.route_quick_rematch_country() from public, anon, authenticated;
drop trigger if exists route_quick_rematch_country on public.live_match_rematches;
create trigger route_quick_rematch_country after insert on public.live_match_rematches
  for each row execute function public.route_quick_rematch_country();

-- One defaulted signature only: both old no-arg and country-aware calls resolve.
drop function if exists public.get_public_live_matches();
drop function if exists public.get_public_live_matches(text);
create function public.get_public_live_matches(p_country_code text default null)
returns table (
  id uuid, team_a_player1_name text, team_a_player2_name text,
  team_b_player1_name text, team_b_player2_name text,
  team_a_game_score smallint, team_b_game_score smallint,
  team_a_games integer, team_b_games integer, team_a_sets integer, team_b_sets integer,
  started_at timestamptz, arena_id bigint, arena_name text, city text, region text,
  country_code text
)
language sql stable security definer set search_path = '' as $$
  select game.id, game.team_a_player1_name, game.team_a_player2_name,
    game.team_b_player1_name, game.team_b_player2_name,
    game.team_a_game_score, game.team_b_game_score,
    game.team_a_games, game.team_b_games, game.team_a_sets, game.team_b_sets,
    game.started_at, arena.id, coalesce(arena.name, nullif(trim(game.qr_arena_name), '')),
    arena.city, arena.region, game.country_code
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
    and game.finished_at is null and game.ended_early_at is null and game.paused_at is null
    and (game.challenge_id is null or game.is_pin_activated)
  order by game.started_at desc;
$$;
revoke all on function public.get_public_live_matches(text) from public;
grant execute on function public.get_public_live_matches(text) to anon, authenticated;
-- Quick-game insertion was column-granted by earlier scoring migrations.
grant insert (country_code) on public.live_matches to anon, authenticated;

notify pgrst, 'reload schema';
commit;
