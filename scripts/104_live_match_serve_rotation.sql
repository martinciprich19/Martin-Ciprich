-- Apply after 077 and 097, before deploying the client.
begin;

alter table public.live_matches
  add column if not exists serve_rotation text not null default 'per_point';
alter table public.live_matches drop constraint if exists live_serve_rotation;
alter table public.live_matches add constraint live_serve_rotation
  check (serve_rotation in ('per_game', 'per_point'));
grant select (serve_rotation), insert (serve_rotation), update (serve_rotation)
  on public.live_matches to anon, authenticated;

create or replace function public.guard_live_scoring_rules()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.scoring_type is distinct from old.scoring_type
    or new.set_format is distinct from old.set_format
    or new.third_set_format is distinct from old.third_set_format
    or new.serve_rotation is distinct from old.serve_rotation)
    and (old.started_at is not null or old.team_a_game_score + old.team_b_game_score
      + old.team_a_games + old.team_b_games + old.team_a_sets + old.team_b_sets > 0) then
    raise exception 'Pravidla zapasu nie je mozne menit po zaciatku zapasu.';
  end if;
  return new;
end;
$$;

create or replace function public.set_live_serve_rotation(p_match_id uuid, p_serve_rotation text)
returns void language plpgsql set search_path = '' as $$
begin
  if p_serve_rotation is null or p_serve_rotation not in ('per_game', 'per_point') then
    raise exception 'Neplatne pravidlo podania.';
  end if;
  update public.live_matches set serve_rotation = p_serve_rotation
    where id = p_match_id and serve_rotation is distinct from p_serve_rotation;
end;
$$;
revoke all on function public.set_live_serve_rotation(uuid, text) from public, anon, authenticated;

create or replace function public.activate_live_match_pin_with_settings(
  p_match_pin text, p_scoring_type text, p_set_format text, p_third_set_format text, p_serve_rotation text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare match_id uuid;
begin
  match_id := public.activate_live_match_pin_with_settings(p_match_pin, p_scoring_type, p_set_format, p_third_set_format);
  perform public.set_live_serve_rotation(match_id, p_serve_rotation);
  return match_id;
end;
$$;
revoke all on function public.activate_live_match_pin_with_settings(text, text, text, text, text) from public;
grant execute on function public.activate_live_match_pin_with_settings(text, text, text, text, text) to anon, authenticated;

create or replace function public.activate_live_match_pin_for_court(
  p_match_pin text, p_scoring_type text, p_set_format text, p_third_set_format text,
  p_court_id bigint, p_serve_rotation text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare match_id uuid;
begin
  match_id := public.activate_live_match_pin_for_court(p_match_pin, p_scoring_type, p_set_format, p_third_set_format, p_court_id);
  perform public.set_live_serve_rotation(match_id, p_serve_rotation);
  return match_id;
end;
$$;
revoke all on function public.activate_live_match_pin_for_court(text, text, text, text, bigint, text) from public;
grant execute on function public.activate_live_match_pin_for_court(text, text, text, text, bigint, text) to anon, authenticated;

create or replace function public.create_qr_device_match_with_settings(
  p_live_match_id uuid, p_team_a_player1_id bigint, p_team_a_player2_id bigint,
  p_team_b_player1_id bigint, p_team_b_player2_id bigint, p_arena_name text,
  p_device_token text, p_scoring_type text, p_set_format text, p_third_set_format text,
  p_serve_rotation text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare match_id uuid;
begin
  match_id := public.create_qr_device_match_with_settings(p_live_match_id, p_team_a_player1_id,
    p_team_a_player2_id, p_team_b_player1_id, p_team_b_player2_id, p_arena_name,
    p_device_token, p_scoring_type, p_set_format, p_third_set_format);
  perform public.set_live_serve_rotation(match_id, p_serve_rotation);
  return match_id;
end;
$$;
revoke all on function public.create_qr_device_match_with_settings(uuid, bigint, bigint, bigint, bigint, text, text, text, text, text, text) from public;
grant execute on function public.create_qr_device_match_with_settings(uuid, bigint, bigint, bigint, bigint, text, text, text, text, text, text) to anon, authenticated;

create or replace function public.create_qr_court_match_with_settings(
  p_live_match_id uuid, p_team_a_player1_id bigint, p_team_a_player2_id bigint,
  p_team_b_player1_id bigint, p_team_b_player2_id bigint, p_arena_name text,
  p_device_token text, p_scoring_type text, p_set_format text, p_third_set_format text,
  p_court_id bigint, p_serve_rotation text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare match_id uuid;
begin
  match_id := public.create_qr_court_match_with_settings(p_live_match_id, p_team_a_player1_id,
    p_team_a_player2_id, p_team_b_player1_id, p_team_b_player2_id, p_arena_name,
    p_device_token, p_scoring_type, p_set_format, p_third_set_format, p_court_id);
  perform public.set_live_serve_rotation(match_id, p_serve_rotation);
  return match_id;
end;
$$;
revoke all on function public.create_qr_court_match_with_settings(uuid, bigint, bigint, bigint, bigint, text, text, text, text, text, bigint, text) from public;
grant execute on function public.create_qr_court_match_with_settings(uuid, bigint, bigint, bigint, bigint, text, text, text, text, text, bigint, text) to anon, authenticated;

do $$
begin
  if to_regprocedure('public.create_live_match_rematch_before_serve_rotation(uuid,uuid,text,smallint[])') is null then
    alter function public.create_live_match_rematch(uuid, uuid, text, smallint[])
      rename to create_live_match_rematch_before_serve_rotation;
  end if;
end;
$$;
revoke all on function public.create_live_match_rematch_before_serve_rotation(uuid, uuid, text, smallint[]) from public, anon, authenticated;
create or replace function public.create_live_match_rematch(
  p_previous_match_id uuid, p_next_match_id uuid, p_device_token text, p_team_slots smallint[]
) returns uuid language plpgsql security definer set search_path = '' as $$
declare match_id uuid; rotation text;
begin
  match_id := public.create_live_match_rematch_before_serve_rotation(
    p_previous_match_id, p_next_match_id, p_device_token, p_team_slots);
  select serve_rotation into rotation from public.live_matches where id = p_previous_match_id;
  perform public.set_live_serve_rotation(match_id, rotation);
  return match_id;
end;
$$;
revoke all on function public.create_live_match_rematch(uuid, uuid, text, smallint[]) from public;
grant execute on function public.create_live_match_rematch(uuid, uuid, text, smallint[]) to anon, authenticated;

create or replace function public.live_statistics_snapshot(game public.live_matches)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_object_agg(key, value) from jsonb_each(to_jsonb(game))
  where key = any(array[
    'scoring_type','set_format','third_set_format','serve_rotation',
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

notify pgrst, 'reload schema';
commit;
