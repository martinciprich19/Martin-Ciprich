-- Apply after 052. Historical service games cannot be reconstructed.
begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'live_matches' and column_name = 'service_game_statistics') then
    alter table public.live_matches add column service_game_statistics jsonb;
    update public.live_matches set service_game_statistics =
      '{"team_a_won":0,"team_a_lost":0,"team_b_won":0,"team_b_lost":0}'::jsonb
      where started_at is null and team_a_game_score + team_b_game_score
        + team_a_games + team_b_games + team_a_sets + team_b_sets = 0;
  end if;
end;
$$;
alter table public.live_matches alter column service_game_statistics set default
  '{"team_a_won":0,"team_a_lost":0,"team_b_won":0,"team_b_lost":0}'::jsonb;
alter table public.live_matches drop constraint if exists live_service_games_shape;
alter table public.live_matches add constraint live_service_games_shape check (
  service_game_statistics is null or (
    jsonb_typeof(service_game_statistics) = 'object'
    and service_game_statistics ?& array['team_a_won','team_a_lost','team_b_won','team_b_lost']
    and service_game_statistics - array['team_a_won','team_a_lost','team_b_won','team_b_lost'] = '{}'::jsonb
    and jsonb_typeof(service_game_statistics -> 'team_a_won') = 'number'
    and jsonb_typeof(service_game_statistics -> 'team_a_lost') = 'number'
    and jsonb_typeof(service_game_statistics -> 'team_b_won') = 'number'
    and jsonb_typeof(service_game_statistics -> 'team_b_lost') = 'number'
    and service_game_statistics ->> 'team_a_won' ~ '^[0-9]+$'
    and service_game_statistics ->> 'team_a_lost' ~ '^[0-9]+$'
    and service_game_statistics ->> 'team_b_won' ~ '^[0-9]+$'
    and service_game_statistics ->> 'team_b_lost' ~ '^[0-9]+$'
    and pg_column_size(service_game_statistics) <= 1024
  )
);
grant select (service_game_statistics), insert (service_game_statistics), update (service_game_statistics)
  on public.live_matches to anon, authenticated;

create or replace function public.guard_finished_service_games()
returns trigger language plpgsql set search_path = public as $$
begin
  if (old.team_a_sets >= 2 or old.team_b_sets >= 2)
    and new.service_game_statistics is distinct from old.service_game_statistics then
    raise exception 'Zapas je ukonceny. Statistiky podania uz nie je mozne menit.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_finished_service_games() from public;
drop trigger if exists guard_finished_service_games on public.live_matches;
create trigger guard_finished_service_games before update on public.live_matches
  for each row execute function public.guard_finished_service_games();

alter table public.matches add column if not exists live_statistics jsonb;
drop trigger if exists guard_official_live_statistics on public.matches;
grant select (live_statistics) on public.matches to authenticated;

create or replace function public.live_statistics_snapshot(game public.live_matches)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_object_agg(key, value) from jsonb_each(to_jsonb(game))
  where key = any(array[
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

create or replace function public.save_finished_live_statistics()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.official_result_id is not null and (new.team_a_sets >= 2 or new.team_b_sets >= 2) then
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
drop trigger if exists save_finished_live_statistics on public.live_matches;
create trigger save_finished_live_statistics after update on public.live_matches
  for each row execute function public.save_finished_live_statistics();

-- Backfill only recorded counters, never inferred rallies or service games.
update public.matches m set live_statistics = public.live_statistics_snapshot(l)
from public.live_matches l where l.official_result_id = m.id::text
  and (l.team_a_sets >= 2 or l.team_b_sets >= 2) and m.live_statistics is null
  and m.player1_id = l.team_a_player1_id and m.team1_player2_id = l.team_a_player2_id
  and m.player2_id = l.team_b_player1_id and m.team2_player2_id = l.team_b_player2_id;

create or replace function public.guard_official_live_statistics()
returns trigger language plpgsql set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.live_statistics is not null)
    or (tg_op = 'UPDATE' and new.live_statistics is distinct from old.live_statistics
      and pg_trigger_depth() < 2) then
    raise exception 'Bodove statistiky moze ulozit iba ukonceny zivy zapas.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_official_live_statistics() from public;
create trigger guard_official_live_statistics before insert or update on public.matches
  for each row execute function public.guard_official_live_statistics();

create or replace function public.profile_serve_statistics(p_profile_id bigint)
returns table(points_won bigint, points_lost bigint, recorded_matches bigint, confirmed_matches bigint)
language sql stable security invoker set search_path = public as $$
  with eligible as (
    select m.*,
      case when m.player1_id = p_profile_id then 'team_a_player1'
        when m.team1_player2_id = p_profile_id then 'team_a_player2'
        when m.player2_id = p_profile_id then 'team_b_player1'
        else 'team_b_player2' end as slot
    from public.matches m where m.status in ('confirmed','approved')
      and p_profile_id in (m.player1_id,m.team1_player2_id,m.player2_id,m.team2_player2_id)
  ), recorded as (
    select live_statistics, slot from eligible
    where live_statistics ->> 'statistics_complete' = 'true'
  )
  select
    coalesce((select sum((live_statistics ->> (slot || '_serve_points_won'))::bigint) from recorded),0)::bigint,
    coalesce((select sum((live_statistics ->> (slot || '_serve_points_lost'))::bigint) from recorded),0)::bigint,
    (select count(*) from recorded), (select count(*) from eligible);
$$;
revoke all on function public.profile_serve_statistics(bigint) from public;
grant execute on function public.profile_serve_statistics(bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
