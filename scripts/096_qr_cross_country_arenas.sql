-- Apply after 095. QR matches retain their players' league, but may be played
-- at any active arena; ordinary league results and challenges stay country-bound.
begin;

alter table public.matches
  add column if not exists qr_live_match_id uuid references public.live_matches(id);
create index if not exists matches_qr_live_match_id_idx
  on public.matches(qr_live_match_id) where qr_live_match_id is not null;

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
  qr_source_match boolean := false;
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
      'player2_id', 'team2_player2_id', 'arena_id', 'arena_name', 'qr_live_match_id'];
    ids := array[(row_data ->> 'player1_id')::bigint, (row_data ->> 'team1_player2_id')::bigint,
      (row_data ->> 'player2_id')::bigint, (row_data ->> 'team2_player2_id')::bigint];
    venue_name := row_data ->> 'arena_name';
  elsif tg_table_name = 'live_matches' then
    routing_keys := array['country_code', 'challenge_id', 'team_a_player1_id', 'team_a_player2_id',
      'team_b_player1_id', 'team_b_player2_id', 'qr_created_by', 'qr_arena_name', 'qr_device_token_hash'];
    ids := array[(row_data ->> 'team_a_player1_id')::bigint, (row_data ->> 'team_a_player2_id')::bigint,
      (row_data ->> 'team_b_player1_id')::bigint, (row_data ->> 'team_b_player2_id')::bigint];
    venue_name := row_data ->> 'qr_arena_name';
  elsif tg_table_name = 'player_requests' then
    routing_keys := array['country_code', 'user_id', 'arena_id'];
    ids := array[(row_data ->> 'user_id')::bigint];
  end if;

  if tg_op = 'UPDATE' then
    old_data := to_jsonb(old);
    if tg_table_name = 'matches'
      and row_data ->> 'qr_live_match_id' is distinct from old_data ->> 'qr_live_match_id' then
      raise exception 'QR match source cannot be changed.';
    end if;
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

  if tg_table_name = 'matches' and row_data ->> 'qr_live_match_id' is not null then
    select exists (
      select 1 from public.live_matches game
      where game.id::text = row_data ->> 'qr_live_match_id'
        and game.qr_created_by::text = row_data ->> 'submitted_by'
        and game.country_code = league
        and game.team_a_player1_id::text = row_data ->> 'team1_player1_id'
        and game.team_a_player2_id::text = row_data ->> 'team1_player2_id'
        and game.team_b_player1_id::text = row_data ->> 'team2_player1_id'
        and game.team_b_player2_id::text = row_data ->> 'team2_player2_id'
        and lower(trim(game.qr_arena_name)) = lower(trim(venue_name))
    ) into qr_source_match;
    if not qr_source_match then raise exception 'QR match source does not match the official result.'; end if;
  end if;

  -- A QR venue is independent of the roster's league. Other record types retain
  -- the original arena-country validation.
  if not (tg_table_name = 'matches' and qr_source_match)
    and not (tg_table_name = 'live_matches'
      and (row_data ->> 'qr_created_by' is not null
        or row_data ->> 'qr_device_token_hash' is not null)) then
    if venue_id is not null and not exists (
      select 1 from public.arenas a where a.id::text = venue_id and a.country_code = league
    ) then raise exception 'Arena must belong to the same national league.'; end if;
    if nullif(trim(venue_name), '') is not null
      and exists (select 1 from public.arenas a where lower(trim(a.name)) = lower(trim(venue_name)))
      and not exists (select 1 from public.arenas a
        where lower(trim(a.name)) = lower(trim(venue_name)) and a.country_code = league)
      then raise exception 'Arena must belong to the same national league.'; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.route_national_league_row() from public, anon, authenticated;

create or replace function public.submit_finished_qr_live_match()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  set_score jsonb;
  a integer;
  b integer;
  a_sets integer := 0;
  b_sets integer := 0;
  a_games integer := 0;
  b_games integer := 0;
  result_sets jsonb := '[]'::jsonb;
  saved public.matches%rowtype;
begin
  if new.qr_created_by is null or new.official_result_id is not null
    or (new.team_a_sets < 2 and new.team_b_sets < 2) then return new; end if;
  if auth.uid() is null or not exists (
    select 1 from public.proffiles p where p.id = new.qr_created_by
      and lower(p.email) = lower(auth.jwt() ->> 'email')
  ) then raise exception 'Vysledok QR zapasu moze odoslat iba prihlaseny organizator.'; end if;
  if jsonb_array_length(new.completed_sets) not in (2, 3) then
    raise exception 'Zapas musi mat dva alebo tri sety.';
  end if;
  for set_score in select value from jsonb_array_elements(new.completed_sets) loop
    if a_sets = 2 or b_sets = 2 or jsonb_typeof(set_score) <> 'array'
      or jsonb_array_length(set_score) <> 2
      or coalesce(set_score ->> 0, '') !~ '^[0-9]+$'
      or coalesce(set_score ->> 1, '') !~ '^[0-9]+$' then
      raise exception 'Neplatne vysledky setov.';
    end if;
    a := (set_score ->> 0)::integer;
    b := (set_score ->> 1)::integer;
    if not ((greatest(a, b) = 6 and least(a, b) <= 4)
      or (greatest(a, b) >= 7 and abs(a - b) = 2)) then
      raise exception 'Set bez tajbrejku musi skoncit rozdielom dvoch gemov.';
    end if;
    a_sets := a_sets + case when a > b then 1 else 0 end;
    b_sets := b_sets + case when b > a then 1 else 0 end;
    a_games := a_games + a;
    b_games := b_games + b;
    result_sets := result_sets || jsonb_build_array(jsonb_build_object('team1Score', a, 'team2Score', b));
  end loop;
  if a_sets <> new.team_a_sets or b_sets <> new.team_b_sets
    or greatest(a_sets, b_sets) <> 2 or new.started_at is null or new.finished_at is null then
    raise exception 'Konecny vysledok alebo cas zapasu je neplatny.';
  end if;

  insert into public.matches (
    player1_id, team1_player1_id, team1_player2_id,
    player2_id, team2_player1_id, team2_player2_id,
    winner_id, match_date, status, player1_sets_won, player2_sets_won,
    player1_games_won, player2_games_won, result_sets, arena_name, submitted_by,
    approved_profile_ids, qr_live_match_id
  ) values (
    new.team_a_player1_id, new.team_a_player1_id, new.team_a_player2_id,
    new.team_b_player1_id, new.team_b_player1_id, new.team_b_player2_id,
    case when a_sets = 2 then new.team_a_player1_id else new.team_b_player1_id end,
    new.started_at, 'pending', a_sets, b_sets, a_games, b_games,
    result_sets, new.qr_arena_name, new.qr_created_by, '{}', new.id
  ) returning * into saved;
  if saved.player1_id is distinct from new.team_a_player1_id
    or saved.team1_player1_id is distinct from new.team_a_player1_id
    or saved.team1_player2_id is distinct from new.team_a_player2_id
    or saved.player2_id is distinct from new.team_b_player1_id
    or saved.team2_player1_id is distinct from new.team_b_player1_id
    or saved.team2_player2_id is distinct from new.team_b_player2_id then
    raise exception 'Ucastnici oficialneho vysledku boli pri ukladani zmeneni.';
  end if;
  new.official_result_id := saved.id::text;
  return new;
end;
$$;
revoke all on function public.submit_finished_qr_live_match() from public;

notify pgrst, 'reload schema';
commit;
