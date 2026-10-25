begin;

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

notify pgrst, 'reload schema';
commit;
