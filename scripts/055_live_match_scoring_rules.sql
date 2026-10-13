-- Apply after 052 and 053. Existing matches retain Golden Point rules.
begin;

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
notify pgrst, 'reload schema';
commit;
