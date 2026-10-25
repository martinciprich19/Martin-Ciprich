-- Repair QR match creation, current scoring formats, history and pause/resume.
-- Generated from the repository migrations; execute this entire file once.
-- Requires the existing live-match schema through migrations 048, 050, 051, 053 and 054.
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.live_matches') IS NULL
    OR to_regprocedure('public.create_qr_device_match(uuid,bigint,bigint,bigint,bigint,text,text)') IS NULL
    OR to_regprocedure('public.live_statistics_snapshot(public.live_matches)') IS NULL
  THEN
    RAISE EXCEPTION 'Chybaju zakladne migracie QR zapasov 048-054. Oprava nebola aplikovana.';
  END IF;
END;
$$;


-- Apply after 052 and 053. Existing matches retain Golden Point rules.

alter table public.live_matches
  add column if not exists scoring_type text not null default 'golden_point',
  add column if not exists advantage_team text;
alter table public.live_matches drop constraint if exists live_scoring_type;
alter table public.live_matches add constraint live_scoring_type
  check (scoring_type in ('golden_point', 'advantage'));
alter table public.live_matches drop constraint if exists live_advantage_state;
alter table public.live_matches add constraint live_advantage_state check (
  advantage_team is null or (
    advantage_team in ('TEAM_A', 'TEAM_B') and scoring_type = 'advantage'
    and team_a_game_score = 40 and team_b_game_score = 40
    and team_a_sets < 2 and team_b_sets < 2
  )
);
grant select (scoring_type, advantage_team), insert (scoring_type, advantage_team),
  update (scoring_type, advantage_team) on public.live_matches to anon, authenticated;

create or replace function public.guard_live_scoring_rules()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.scoring_type is distinct from old.scoring_type and (
    old.started_at is not null or old.team_a_game_score + old.team_b_game_score
      + old.team_a_games + old.team_b_games + old.team_a_sets + old.team_b_sets > 0
  ) then
    raise exception 'Pravidla bodovania nie je mozne menit po zaciatku zapasu.';
  end if;
  if (old.team_a_sets >= 2 or old.team_b_sets >= 2)
    and new.advantage_team is distinct from old.advantage_team then
    raise exception 'Zapas je ukonceny.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_live_scoring_rules() from public;
drop trigger if exists guard_live_scoring_rules on public.live_matches;
create trigger guard_live_scoring_rules before update on public.live_matches
  for each row execute function public.guard_live_scoring_rules();

create or replace function public.activate_live_match_pin_with_rules(
  p_match_pin text, p_scoring_type text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare match_id uuid;
begin
  if p_scoring_type is null or p_scoring_type not in ('golden_point', 'advantage') then
    raise exception 'Neplatne pravidla bodovania.';
  end if;
  match_id := public.activate_live_match_pin(p_match_pin);
  update public.live_matches set scoring_type = p_scoring_type where id = match_id;
  return match_id;
end;
$$;
revoke all on function public.activate_live_match_pin_with_rules(text, text) from public;
grant execute on function public.activate_live_match_pin_with_rules(text, text) to anon, authenticated;

create or replace function public.create_qr_device_match_with_rules(
  p_live_match_id uuid,
  p_team_a_player1_id bigint, p_team_a_player2_id bigint,
  p_team_b_player1_id bigint, p_team_b_player2_id bigint,
  p_arena_name text, p_device_token text, p_scoring_type text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare match_id uuid;
begin
  if p_scoring_type is null or p_scoring_type not in ('golden_point', 'advantage') then
    raise exception 'Neplatne pravidla bodovania.';
  end if;
  match_id := public.create_qr_device_match(p_live_match_id,
    p_team_a_player1_id, p_team_a_player2_id, p_team_b_player1_id,
    p_team_b_player2_id, p_arena_name, p_device_token);
  update public.live_matches set scoring_type = p_scoring_type where id = match_id;
  return match_id;
end;
$$;
revoke all on function public.create_qr_device_match_with_rules(uuid, bigint, bigint, bigint, bigint, text, text, text) from public;
grant execute on function public.create_qr_device_match_with_rules(uuid, bigint, bigint, bigint, bigint, text, text, text) to anon, authenticated;

create or replace function public.live_statistics_snapshot(game public.live_matches)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_object_agg(key, value) from jsonb_each(to_jsonb(game))
  where key = any(array[
    'scoring_type',
    'team_a_player1_name','team_a_player2_name','team_b_player1_name','team_b_player2_name',
    'team_a_sets','team_b_sets','completed_sets','set_statistics','statistics_complete',
    'team_a_player1_serve_points_won','team_a_player1_serve_points_lost',
    'team_a_player2_serve_points_won','team_a_player2_serve_points_lost',
    'team_b_player1_serve_points_won','team_b_player1_serve_points_lost',
    'team_b_player2_serve_points_won','team_b_player2_serve_points_lost',
    'team_a_total_points_won','team_b_total_points_won',
    'streak_team','current_point_streak','team_a_longest_point_streak','team_b_longest_point_streak',
    'team_a_break_points','team_a_break_points_converted','team_a_break_points_missed',
    'team_b_break_points','team_b_break_points_converted','team_b_break_points_missed',
    'started_at','finished_at','service_game_statistics'
  ]);
$$;
revoke all on function public.live_statistics_snapshot(public.live_matches) from public;

ALTER TABLE public.live_matches
  ADD COLUMN IF NOT EXISTS set_format text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS third_set_format text NOT NULL DEFAULT 'full_set';
GRANT SELECT (set_format, third_set_format), INSERT (set_format, third_set_format),
  UPDATE (set_format, third_set_format) ON public.live_matches TO anon, authenticated;
ALTER TABLE public.live_matches DROP CONSTRAINT IF EXISTS live_third_set_format;
ALTER TABLE public.live_matches ADD CONSTRAINT live_third_set_format
  CHECK (third_set_format IN ('full_set', 'super_tiebreak'));


do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'live_matches'
      and column_name = 'tiebreak_score') then
    alter table public.live_matches add column tiebreak_score jsonb;
    -- Convert the visible legacy fifteens once; never invent earlier deuce rallies.
    with points as (
      select id,
        case team_a_game_score when 15 then 1 when 30 then 2 when 40 then 3 else 0 end
          + case when advantage_team = 'TEAM_A' then 1 else 0 end as a,
        case team_b_game_score when 15 then 1 when 30 then 2 when 40 then 3 else 0 end
          + case when advantage_team = 'TEAM_B' then 1 else 0 end as b,
        (serving_player - 1) * 2 + case when serving_team = 'TEAM_B' then 1 else 0 end as server_index
      from public.live_matches where team_a_games = 6 and team_b_games = 6
        and team_a_sets < 2 and team_b_sets < 2
    ), seeded as (
      select *, (server_index - (((a + b + 1) / 2) % 4) + 4) % 4 as first_index
      from points
    )
    update public.live_matches m set
      tiebreak_score = case when m.serving_team is not null then jsonb_build_object(
        'a', p.a, 'b', p.b,
        'first_team', case when p.first_index % 2 = 0 then 'TEAM_A' else 'TEAM_B' end,
        'first_player', p.first_index / 2 + 1
      ) else null end,
      statistics_complete = case when m.team_a_game_score + m.team_b_game_score > 0
        then false else m.statistics_complete end,
      team_a_game_score = 0, team_b_game_score = 0, advantage_team = null
    from seeded p where m.id = p.id;
  end if;
end;
$$;



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



ALTER TABLE public.live_matches ADD COLUMN IF NOT EXISTS is_tiebreak boolean
  GENERATED ALWAYS AS (team_a_games = 6 AND team_b_games = 6) STORED;
GRANT SELECT (tiebreak_score), INSERT (tiebreak_score), UPDATE (tiebreak_score)
  ON public.live_matches TO anon, authenticated;
DROP TRIGGER IF EXISTS guard_finished_tiebreak ON public.live_matches;
CREATE TRIGGER guard_finished_tiebreak BEFORE UPDATE ON public.live_matches
  FOR EACH ROW EXECUTE FUNCTION public.guard_finished_tiebreak();


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

alter table public.live_matches
  add column if not exists point_history jsonb not null default '[]'::jsonb
    check (jsonb_typeof(point_history) = 'array'),
  add column if not exists point_history_complete boolean not null default false;

alter table public.live_matches
  alter column point_history_complete set default true;

grant select (point_history, point_history_complete),
  update (point_history, point_history_complete)
  on public.live_matches to anon, authenticated;

create or replace function public.guard_finished_point_history()
returns trigger language plpgsql set search_path = public as $$
begin
  if (
    (old.set_format = 'pro_set' and (old.team_a_sets >= 1 or old.team_b_sets >= 1))
    or (old.set_format in ('standard', 'seven_games_no_tiebreak')
      and (old.team_a_sets >= 2 or old.team_b_sets >= 2))
  ) and (
    new.point_history is distinct from old.point_history
    or new.point_history_complete is distinct from old.point_history_complete
  ) then
    raise exception 'Zapas je ukonceny. Historiu bodov uz nie je mozne menit.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_finished_point_history() from public;
drop trigger if exists guard_finished_point_history on public.live_matches;
create trigger guard_finished_point_history before update on public.live_matches
  for each row execute function public.guard_finished_point_history();

create or replace function public.live_statistics_snapshot(game public.live_matches)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_object_agg(key, value) from jsonb_each(to_jsonb(game))
  where key = any(array[
    'scoring_type','set_format','third_set_format',
    'team_a_player1_name','team_a_player2_name','team_b_player1_name','team_b_player2_name',
    'team_a_sets','team_b_sets','completed_sets','set_statistics','statistics_complete',
    'point_history','point_history_complete',
    'team_a_player1_serve_points_won','team_a_player1_serve_points_lost',
    'team_a_player2_serve_points_won','team_a_player2_serve_points_lost',
    'team_b_player1_serve_points_won','team_b_player1_serve_points_lost',
    'team_b_player2_serve_points_won','team_b_player2_serve_points_lost',
    'team_a_total_points_won','team_b_total_points_won',
    'streak_team','current_point_streak','team_a_longest_point_streak','team_b_longest_point_streak',
    'team_a_break_points','team_a_break_points_converted','team_a_break_points_missed',
    'team_b_break_points','team_b_break_points_converted','team_b_break_points_missed',
    'started_at','finished_at','service_game_statistics'
  ]);
$$;
revoke all on function public.live_statistics_snapshot(public.live_matches) from public;

-- Apply after 059. Run this entire file in the Supabase SQL Editor.

alter table public.live_matches
  add column if not exists paused_at timestamptz,
  add column if not exists paused_seconds double precision not null default 0
    check (paused_seconds >= 0),
  add column if not exists resume_pin text check (resume_pin ~ '^[0-9]{4}$'),
  add column if not exists status text generated always as (
    case
      when finished_at is not null then 'finished'
      when paused_at is not null then 'paused'
      else 'in_progress'
    end
  ) stored;
-- Keep the resume PIN out of public scoreboard SELECTs.
do $$
declare col record;
begin
  if has_table_privilege('authenticated', 'public.live_matches', 'SELECT') then
    revoke select on public.live_matches from authenticated;
    for col in select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'live_matches' and column_name <> 'resume_pin'
    loop
      execute format('grant select (%I) on public.live_matches to authenticated', col.column_name);
    end loop;
  end if;
end;
$$;
revoke select (resume_pin) on public.live_matches from anon, authenticated;
grant select (paused_at, paused_seconds, status) on public.live_matches to anon, authenticated;

create table if not exists public.live_match_pauses (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.live_matches(id) on delete cascade,
  pin text check (pin ~ '^[0-9]{4}$'),
  dispatch_token text not null,
  device_token_hash text,
  created_at timestamptz not null default now(),
  resumed_at timestamptz
);
create unique index if not exists live_match_pauses_active_pin
  on public.live_match_pauses(pin) where pin is not null;
create unique index if not exists live_match_pauses_active_match
  on public.live_match_pauses(match_id) where resumed_at is null;
alter table public.live_match_pauses enable row level security;
revoke all on public.live_match_pauses from public, anon, authenticated;

create table if not exists public.live_match_pause_emails (
  id uuid primary key default gen_random_uuid(),
  pause_id uuid not null references public.live_match_pauses(id) on delete cascade,
  recipient text not null,
  sent_at timestamptz,
  unique (pause_id, recipient)
);
alter table public.live_match_pause_emails enable row level security;
revoke all on public.live_match_pause_emails from public, anon, authenticated;

create table if not exists public.live_match_resume_attempts (
  client_key text primary key,
  window_started timestamptz not null default now(),
  attempts integer not null default 0
);
alter table public.live_match_resume_attempts enable row level security;
revoke all on public.live_match_resume_attempts from public, anon, authenticated;

create or replace function public.has_resumed_match_access(p_match_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.live_match_pauses p
    where p.match_id = p_match_id and p.resumed_at is not null
      and p.device_token_hash = encode(sha256(convert_to(
        coalesce(nullif(current_setting('request.headers', true), '')::jsonb
          ->> 'x-riva-qr-device', ''), 'UTF8')), 'hex')
      and not exists (
        select 1 from public.live_match_pauses newer
        where newer.match_id = p.match_id and newer.created_at > p.created_at
      )
  );
$$;
revoke all on function public.has_resumed_match_access(uuid) from public;
grant execute on function public.has_resumed_match_access(uuid) to anon, authenticated;

-- The existing QR final-result trigger must recognize a resumed device too.
create or replace function public.has_qr_device_access(p_match_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_resumed_match_access(p_match_id) or exists (
    select 1 from public.live_matches m
    where m.id = p_match_id and m.qr_device_token_hash is not null
      and m.qr_device_token_hash = encode(sha256(convert_to(
        coalesce(nullif(current_setting('request.headers', true), '')::jsonb
          ->> 'x-riva-qr-device', ''), 'UTF8')), 'hex')
  );
$$;
revoke all on function public.has_qr_device_access(uuid) from public;
grant execute on function public.has_qr_device_access(uuid) to anon, authenticated;

drop policy if exists "Resumed device can read match" on public.live_matches;
create policy "Resumed device can read match" on public.live_matches
  for select to anon, authenticated using (public.has_resumed_match_access(id));
drop policy if exists "Resumed device can score match" on public.live_matches;
create policy "Resumed device can score match" on public.live_matches
  for update to anon, authenticated using (public.has_resumed_match_access(id))
  with check (public.has_resumed_match_access(id));

create or replace function public.guard_paused_live_match()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated') and (new.paused_at is not null or new.paused_seconds <> 0 or new.resume_pin is not null) then
      raise exception 'Neplatny stav prerusenia noveho zapasu.';
    end if;
    return new;
  end if;
  if current_user in ('anon', 'authenticated') and (
    old.paused_at is not null
    or new.paused_at is distinct from old.paused_at
    or new.paused_seconds is distinct from old.paused_seconds
    or new.resume_pin is distinct from old.resume_pin
  ) then
    raise exception 'Zapas je preruseny. Pokracuj zadanim PIN-u.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_paused_live_match() from public;
drop trigger if exists guard_paused_live_match on public.live_matches;
create trigger guard_paused_live_match before insert or update on public.live_matches
  for each row execute function public.guard_paused_live_match();

create or replace function public.pause_live_match(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  game public.live_matches%rowtype;
  paused public.live_match_pauses%rowtype;
  candidate text;
  attempts integer := 0;
begin
  select * into game from public.live_matches where id = p_match_id for update;
  if not found then raise exception 'Zapas sa nenasiel.'; end if;
  if not (
    public.has_qr_device_access(game.id)
    or (game.qr_created_by is null and game.challenge_id is null)
    or (game.challenge_id is not null and game.is_pin_activated
      and exists (select 1 from public.challenges c
        where c.id::text = game.challenge_id and c.status = 'accepted'))
    or (auth.uid() is not null and exists (
      select 1 from public.proffiles p where p.id = game.qr_created_by
        and lower(p.email) = lower(auth.jwt() ->> 'email')
    ))
  ) then raise exception 'Nemas opravnenie prerusit tento zapas.'; end if;
  if game.finished_at is not null or game.team_a_sets >= 2 or game.team_b_sets >= 2
    or (game.set_format = 'pro_set' and greatest(game.team_a_sets, game.team_b_sets) >= 1)
  then raise exception 'Ukonceny zapas nie je mozne prerusit.'; end if;

  select * into paused from public.live_match_pauses
    where match_id = game.id and resumed_at is null;
  if not found then
    -- Serialize PIN allocation across all concurrent pause requests.
    perform pg_advisory_xact_lock(604060);
    loop
      candidate := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 10000))::text, 4, '0');
      exit when not exists (select 1 from public.live_match_pauses where pin = candidate);
      attempts := attempts + 1;
      if attempts >= 1000 then raise exception 'Nie je dostupny volny PIN. Skus neskor.'; end if;
    end loop;
    insert into public.live_match_pauses(match_id, pin, dispatch_token)
      values (game.id, candidate, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
      returning * into paused;
    update public.live_matches set paused_at = clock_timestamp(), resume_pin = paused.pin where id = game.id;
    insert into public.live_match_pause_emails(pause_id, recipient)
      select distinct paused.id, lower(trim(p.email))
      from public.proffiles p
      where nullif(trim(p.email), '') is not null and (
        p.id in (game.team_a_player1_id, game.team_a_player2_id,
                 game.team_b_player1_id, game.team_b_player2_id)
        or exists (select 1 from public.challenges c
          where c.id::text = game.challenge_id and p.id in (
            c.challenger_1_id, c.challenger_2_id, c.challenged_1_id, c.challenged_2_id))
      );
  end if;
  return jsonb_build_object('pin', paused.pin, 'dispatchToken', paused.dispatch_token,
    'pauseId', paused.id, 'recipients', (select count(*) from public.live_match_pause_emails where pause_id = paused.id));
end;
$$;
revoke all on function public.pause_live_match(uuid) from public;
grant execute on function public.pause_live_match(uuid) to anon, authenticated;

-- Called only by the server; failed attempts persist rather than rolling back.
create or replace function public.resume_paused_live_match(
  p_pin text, p_device_token text, p_client_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  paused public.live_match_pauses%rowtype;
  tries integer;
begin
  if p_client_key is null or p_device_token !~ '^[a-f0-9]{64}$'
    or p_device_token is null or p_pin is null or p_pin !~ '^[0-9]{4}$'
  then return jsonb_build_object('error', 'Neplatne udaje pre pokracovanie.'); end if;
  delete from public.live_match_resume_attempts where window_started < now() - interval '1 day';
  insert into public.live_match_resume_attempts as a(client_key, attempts)
    values (p_client_key, 1)
    on conflict (client_key) do update set
      attempts = case when a.window_started < now() - interval '10 minutes' then 1 else a.attempts + 1 end,
      window_started = case when a.window_started < now() - interval '10 minutes' then now() else a.window_started end
    returning attempts into tries;
  if tries > 5 then return jsonb_build_object('error', 'Prilis vela pokusov. Skus znova o 10 minut.'); end if;
  select * into paused from public.live_match_pauses
    where device_token_hash = encode(sha256(convert_to(p_device_token, 'UTF8')), 'hex')
      and resumed_at is not null
    order by created_at desc limit 1;
  if found and not exists (select 1 from public.live_match_pauses
    where match_id = paused.match_id and created_at > paused.created_at)
  then return jsonb_build_object('matchId', paused.match_id); end if;
  select * into paused from public.live_match_pauses where pin = p_pin and resumed_at is null for update;
  if not found then return jsonb_build_object('error', 'PIN preruseneho zapasu nie je platny alebo uz bol pouzity.'); end if;
  perform 1 from public.live_matches where id = paused.match_id for update;
  update public.live_match_pauses set pin = null, resumed_at = clock_timestamp(),
    device_token_hash = encode(sha256(convert_to(p_device_token, 'UTF8')), 'hex')
    where id = paused.id;
  update public.live_matches set
    paused_seconds = paused_seconds + greatest(0, extract(epoch from (clock_timestamp() - paused_at))),
    paused_at = null, resume_pin = null
    where id = paused.match_id;
  return jsonb_build_object('matchId', paused.match_id);
end;
$$;
revoke all on function public.resume_paused_live_match(text, text, text) from public, anon, authenticated;
grant execute on function public.resume_paused_live_match(text, text, text) to service_role;

create or replace function public.pending_match_pause_emails(
  p_pause_id uuid, p_dispatch_token text, p_match_id uuid, p_pin text
)
returns table(email_id uuid, recipient text, pin text)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.live_match_pauses
    where id = p_pause_id and dispatch_token = p_dispatch_token and resumed_at is null
      and match_id = p_match_id and live_match_pauses.pin = p_pin)
  then raise exception 'Neplatne alebo uz obnovene prerusenie.'; end if;
  return query select e.id, e.recipient, p.pin from public.live_match_pause_emails e
    join public.live_match_pauses p on p.id = e.pause_id
    where p.id = p_pause_id and p.dispatch_token = p_dispatch_token
      and p.resumed_at is null and e.sent_at is null;
end;
$$;
revoke all on function public.pending_match_pause_emails(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.pending_match_pause_emails(uuid, text, uuid, text) to service_role;

create or replace function public.mark_match_pause_email_sent(p_email_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.live_match_pause_emails set sent_at = now() where id = p_email_id;
$$;
revoke all on function public.mark_match_pause_email_sent(uuid) from public, anon, authenticated;
grant execute on function public.mark_match_pause_email_sent(uuid) to service_role;

create or replace function public.live_statistics_snapshot(game public.live_matches)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_object_agg(key, value) from jsonb_each(to_jsonb(game))
  where key = any(array[
    'scoring_type','set_format','third_set_format',
    'team_a_player1_name','team_a_player2_name','team_b_player1_name','team_b_player2_name',
    'team_a_sets','team_b_sets','completed_sets','set_statistics','statistics_complete',
    'point_history','point_history_complete','paused_seconds',
    'team_a_player1_serve_points_won','team_a_player1_serve_points_lost',
    'team_a_player2_serve_points_won','team_a_player2_serve_points_lost',
    'team_b_player1_serve_points_won','team_b_player1_serve_points_lost',
    'team_b_player2_serve_points_won','team_b_player2_serve_points_lost',
    'team_a_total_points_won','team_b_total_points_won',
    'streak_team','current_point_streak','team_a_longest_point_streak','team_b_longest_point_streak',
    'team_a_break_points','team_a_break_points_converted','team_a_break_points_missed',
    'team_b_break_points','team_b_break_points_converted','team_b_break_points_missed',
    'started_at','finished_at','service_game_statistics'
  ]);
$$;
revoke all on function public.live_statistics_snapshot(public.live_matches) from public;

NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT p.proname AS function_name, pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('create_qr_device_match_with_settings', 'pause_live_match', 'resume_paused_live_match')
ORDER BY p.proname;
