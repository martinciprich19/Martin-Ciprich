begin;

alter table public.live_matches
  drop constraint if exists live_tiebreak_shape,
  drop constraint if exists live_tiebreak_no_fifteens,
  drop constraint if exists live_set_format;

alter table public.live_matches add constraint live_set_format
  check (set_format in ('standard', 'pro_set', 'seven_games_no_tiebreak'));

alter table public.live_matches drop column is_tiebreak;
alter table public.live_matches add column is_tiebreak boolean
  generated always as (
    (set_format = 'standard' and team_a_games = 6 and team_b_games = 6)
    or (set_format = 'pro_set' and team_a_games = 8 and team_b_games = 8)
  ) stored;

alter table public.live_matches add constraint live_tiebreak_shape check (
  tiebreak_score is null or (
    team_a_game_score = 0 and team_b_game_score = 0 and advantage_team is null
    and jsonb_typeof(tiebreak_score) = 'object'
    and tiebreak_score ?& array['a','b','first_team','first_player']
    and tiebreak_score - array['a','b','first_team','first_player'] = '{}'::jsonb
    and jsonb_typeof(tiebreak_score -> 'a') = 'number'
    and jsonb_typeof(tiebreak_score -> 'b') = 'number'
    and jsonb_typeof(tiebreak_score -> 'first_team') = 'string'
    and jsonb_typeof(tiebreak_score -> 'first_player') = 'number'
    and tiebreak_score ->> 'a' ~ '^[0-9]+$'
    and tiebreak_score ->> 'b' ~ '^[0-9]+$'
    and tiebreak_score ->> 'first_team' in ('TEAM_A','TEAM_B')
    and tiebreak_score ->> 'first_player' in ('1','2')
    and pg_column_size(tiebreak_score) <= 1024
    and (
      (set_format = 'standard' and team_a_games = 6 and team_b_games = 6
        and team_a_sets < 2 and team_b_sets < 2)
      or (set_format = 'pro_set' and team_a_games = 8 and team_b_games = 8
        and team_a_sets = 0 and team_b_sets = 0)
      or (set_format = 'standard' and third_set_format = 'super_tiebreak'
        and team_a_sets = 1 and team_b_sets = 1 and team_a_games = 0 and team_b_games = 0)
    )
  )
);
alter table public.live_matches add constraint live_tiebreak_no_fifteens check (
  not is_tiebreak or (team_a_game_score = 0 and team_b_game_score = 0 and advantage_team is null)
);
grant select (is_tiebreak) on public.live_matches to anon, authenticated;

create or replace function public.activate_live_match_pin_with_settings(
  p_match_pin text, p_scoring_type text, p_set_format text, p_third_set_format text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare match_id uuid;
begin
  if p_set_format not in ('standard', 'seven_games_no_tiebreak')
    or p_third_set_format not in ('full_set', 'super_tiebreak') then
    raise exception 'Neplatny format zapasu.';
  end if;
  match_id := public.activate_live_match_pin_with_rules(p_match_pin, p_scoring_type);
  update public.live_matches set
    set_format = p_set_format,
    third_set_format = p_third_set_format
  where id = match_id;
  return match_id;
end;
$$;
revoke all on function public.activate_live_match_pin_with_settings(text, text, text, text) from public;
grant execute on function public.activate_live_match_pin_with_settings(text, text, text, text) to anon, authenticated;

create or replace function public.create_qr_device_match_with_settings(
  p_live_match_id uuid,
  p_team_a_player1_id bigint, p_team_a_player2_id bigint,
  p_team_b_player1_id bigint, p_team_b_player2_id bigint,
  p_arena_name text, p_device_token text,
  p_scoring_type text, p_set_format text, p_third_set_format text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare match_id uuid;
begin
  if p_set_format not in ('standard', 'seven_games_no_tiebreak')
    or p_third_set_format not in ('full_set', 'super_tiebreak') then
    raise exception 'Neplatny format zapasu.';
  end if;
  match_id := public.create_qr_device_match_with_rules(
    p_live_match_id, p_team_a_player1_id, p_team_a_player2_id,
    p_team_b_player1_id, p_team_b_player2_id, p_arena_name,
    p_device_token, p_scoring_type
  );
  update public.live_matches set
    set_format = p_set_format,
    third_set_format = p_third_set_format
  where id = match_id;
  return match_id;
end;
$$;
revoke all on function public.create_qr_device_match_with_settings(uuid, bigint, bigint, bigint, bigint, text, text, text, text, text) from public;
grant execute on function public.create_qr_device_match_with_settings(uuid, bigint, bigint, bigint, bigint, text, text, text, text, text) to anon, authenticated;

create or replace function public.guard_finished_live_match()
returns trigger language plpgsql set search_path = public as $$
begin
  if (
    (old.set_format = 'pro_set' and (old.team_a_sets >= 1 or old.team_b_sets >= 1))
    or (old.set_format in ('standard', 'seven_games_no_tiebreak')
      and (old.team_a_sets >= 2 or old.team_b_sets >= 2))
  ) and (
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

create or replace function public.guard_finished_set_statistics()
returns trigger language plpgsql set search_path = public as $$
begin
  if (
    (old.set_format = 'pro_set' and (old.team_a_sets >= 1 or old.team_b_sets >= 1))
    or (old.set_format in ('standard', 'seven_games_no_tiebreak')
      and (old.team_a_sets >= 2 or old.team_b_sets >= 2))
  ) and new.set_statistics is distinct from old.set_statistics then
    raise exception 'Zapas je ukonceny. Statistiky setov uz nie je mozne menit.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_finished_set_statistics() from public;

create or replace function public.guard_finished_service_games()
returns trigger language plpgsql set search_path = public as $$
begin
  if (
    (old.set_format = 'pro_set' and (old.team_a_sets >= 1 or old.team_b_sets >= 1))
    or (old.set_format in ('standard', 'seven_games_no_tiebreak')
      and (old.team_a_sets >= 2 or old.team_b_sets >= 2))
  ) and new.service_game_statistics is distinct from old.service_game_statistics then
    raise exception 'Zapas je ukonceny. Statistiky podania uz nie je mozne menit.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_finished_service_games() from public;

create or replace function public.guard_live_scoring_rules()
returns trigger language plpgsql set search_path = public as $$
begin
  if (
    new.scoring_type is distinct from old.scoring_type
    or new.set_format is distinct from old.set_format
    or new.third_set_format is distinct from old.third_set_format
  ) and (
    old.started_at is not null or old.team_a_game_score + old.team_b_game_score
      + old.team_a_games + old.team_b_games + old.team_a_sets + old.team_b_sets > 0
  ) then
    raise exception 'Pravidla zapasu nie je mozne menit po zaciatku zapasu.';
  end if;
  if (
    (old.set_format = 'pro_set' and (old.team_a_sets >= 1 or old.team_b_sets >= 1))
    or (old.set_format in ('standard', 'seven_games_no_tiebreak')
      and (old.team_a_sets >= 2 or old.team_b_sets >= 2))
  ) and new.advantage_team is distinct from old.advantage_team then
    raise exception 'Zapas je ukonceny.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_live_scoring_rules() from public;

create or replace function public.guard_finished_tiebreak()
returns trigger language plpgsql set search_path = public as $$
begin
  if (
    (old.set_format = 'pro_set' and (old.team_a_sets >= 1 or old.team_b_sets >= 1))
    or (old.set_format in ('standard', 'seven_games_no_tiebreak')
      and (old.team_a_sets >= 2 or old.team_b_sets >= 2))
  ) and new.tiebreak_score is distinct from old.tiebreak_score then
    raise exception 'Zapas je ukonceny. Tajbrejk uz nie je mozne menit.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_finished_tiebreak() from public;

create or replace function public.save_finished_live_statistics()
returns trigger language plpgsql security definer set search_path = public as $$
declare is_finished boolean;
begin
  is_finished := (new.set_format = 'pro_set' and (new.team_a_sets >= 1 or new.team_b_sets >= 1))
    or (new.set_format in ('standard', 'seven_games_no_tiebreak')
      and (new.team_a_sets >= 2 or new.team_b_sets >= 2));
  if new.official_result_id is not null and is_finished then
    update public.matches set live_statistics = public.live_statistics_snapshot(new)
      where id::text = new.official_result_id and live_statistics is null
        and player1_id = new.team_a_player1_id and team1_player2_id = new.team_a_player2_id
        and player2_id = new.team_b_player1_id and team2_player2_id = new.team_b_player2_id;
    if not found and not exists (select 1 from public.matches
      where id::text = new.official_result_id and live_statistics is not null) then
      raise exception 'Statistiky oficialneho vysledku sa nepodarilo ulozit.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.save_finished_live_statistics() from public;

create or replace function public.submit_finished_qr_live_match()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  set_score jsonb;
  set_index integer := 0;
  a integer;
  b integer;
  a_sets integer := 0;
  b_sets integer := 0;
  a_games integer := 0;
  b_games integer := 0;
  result_sets jsonb := '[]'::jsonb;
  saved public.matches%rowtype;
  deciding_super_tiebreak boolean;
  pro_set boolean;
begin
  pro_set := new.set_format = 'pro_set';
  if new.qr_created_by is null or new.official_result_id is not null
    or (pro_set and new.team_a_sets < 1 and new.team_b_sets < 1)
    or (not pro_set and new.team_a_sets < 2 and new.team_b_sets < 2) then
    return new;
  end if;
  if not public.has_qr_device_access(new.id) and not (
    auth.uid() is not null and exists (
      select 1 from public.proffiles p where p.id = new.qr_created_by
        and lower(p.email) = lower(auth.jwt() ->> 'email')
    )
  ) then raise exception 'Vysledok moze odoslat iba zariadenie zapasu alebo prihlaseny organizator.'; end if;
  if jsonb_typeof(new.completed_sets) <> 'array'
    or (pro_set and jsonb_array_length(new.completed_sets) <> 1)
    or (not pro_set and jsonb_array_length(new.completed_sets) not in (2, 3)) then
    raise exception 'Pocet ukoncenych setov nesuhlasi s formatom zapasu.';
  end if;

  for set_score in select value from jsonb_array_elements(new.completed_sets) loop
    set_index := set_index + 1;
    if a_sets >= (case when pro_set then 1 else 2 end)
      or b_sets >= (case when pro_set then 1 else 2 end)
      or jsonb_typeof(set_score) <> 'array'
      or jsonb_array_length(set_score) <> 2
      or coalesce(set_score ->> 0, '') !~ '^[0-9]+$'
      or coalesce(set_score ->> 1, '') !~ '^[0-9]+$' then
      raise exception 'Neplatne vysledky setov.';
    end if;
    a := (set_score ->> 0)::integer;
    b := (set_score ->> 1)::integer;
    deciding_super_tiebreak := not pro_set and set_index = 3
      and new.third_set_format = 'super_tiebreak' and a_sets = 1 and b_sets = 1;
    if deciding_super_tiebreak then
      if greatest(a, b) < 10 or abs(a - b) < 2 then
        raise exception 'Super tajbrejk musi skoncit najmenej 10 bodmi a rozdielom dvoch.';
      end if;
    elsif pro_set then
      if not ((greatest(a, b) = 8 and least(a, b) <= 6)
        or (greatest(a, b) = 9 and least(a, b) in (7, 8))) then
        raise exception 'Pro-Set musi skoncit pri 8 gemoch s rozdielom dvoch alebo tajbrejkom 9:8.';
      end if;
    elsif new.set_format = 'seven_games_no_tiebreak' then
      if greatest(a, b) <> 7 or least(a, b) > 6 then
        raise exception 'Set bez tajbrejku musi skoncit vysledkom 7:0 az 7:6.';
      end if;
    elsif not ((greatest(a, b) = 6 and least(a, b) <= 4)
      or (greatest(a, b) = 7 and least(a, b) in (5, 6))) then
      raise exception 'Klasicky set musi skoncit pri 6 gemoch alebo tajbrejkom 7:6.';
    end if;
    a_sets := a_sets + case when a > b then 1 else 0 end;
    b_sets := b_sets + case when b > a then 1 else 0 end;
    if not deciding_super_tiebreak then
      a_games := a_games + a;
      b_games := b_games + b;
    end if;
    result_sets := result_sets || jsonb_build_array(jsonb_build_object('team1Score', a, 'team2Score', b));
  end loop;
  if a_sets <> new.team_a_sets or b_sets <> new.team_b_sets
    or greatest(a_sets, b_sets) <> (case when pro_set then 1 else 2 end)
    or new.started_at is null or new.finished_at is null then
    raise exception 'Konecny vysledok alebo cas zapasu je neplatny.';
  end if;

  insert into public.matches (
    player1_id, team1_player1_id, team1_player2_id,
    player2_id, team2_player1_id, team2_player2_id,
    winner_id, match_date, status, player1_sets_won, player2_sets_won,
    player1_games_won, player2_games_won, result_sets, arena_name, submitted_by,
    approved_profile_ids
  ) values (
    new.team_a_player1_id, new.team_a_player1_id, new.team_a_player2_id,
    new.team_b_player1_id, new.team_b_player1_id, new.team_b_player2_id,
    case when a_sets > b_sets then new.team_a_player1_id else new.team_b_player1_id end,
    new.started_at, 'pending', a_sets, b_sets, a_games, b_games,
    result_sets, new.qr_arena_name, new.qr_created_by, '{}'
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
