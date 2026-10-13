-- Apply after 053. Own serve is individual; return is the participant's team.
begin;

create or replace function public.profile_serve_return_statistics(p_profile_id bigint)
returns table(
  points_won bigint, points_lost bigint,
  return_points_won bigint, return_points_lost bigint,
  recorded_matches bigint, confirmed_matches bigint
)
language sql stable security invoker set search_path = public as $$
  with eligible as (
    select m.live_statistics,
      case when m.player1_id = p_profile_id then 'team_a_player1'
        when m.team1_player2_id = p_profile_id then 'team_a_player2'
        when m.player2_id = p_profile_id then 'team_b_player1'
        else 'team_b_player2' end as slot,
      case when p_profile_id in (m.player1_id, m.team1_player2_id)
        then 'team_b' else 'team_a' end as opponent
    from public.matches m where m.status in ('confirmed','approved')
      and p_profile_id in (m.player1_id,m.team1_player2_id,m.player2_id,m.team2_player2_id)
  ), recorded as (
    select * from eligible where live_statistics ->> 'statistics_complete' = 'true'
  )
  select
    coalesce(sum((live_statistics ->> (slot || '_serve_points_won'))::bigint),0)::bigint,
    coalesce(sum((live_statistics ->> (slot || '_serve_points_lost'))::bigint),0)::bigint,
    coalesce(sum(
      (live_statistics ->> (opponent || '_player1_serve_points_lost'))::bigint
      + (live_statistics ->> (opponent || '_player2_serve_points_lost'))::bigint
    ),0)::bigint,
    coalesce(sum(
      (live_statistics ->> (opponent || '_player1_serve_points_won'))::bigint
      + (live_statistics ->> (opponent || '_player2_serve_points_won'))::bigint
    ),0)::bigint,
    count(*), (select count(*) from eligible)
  from recorded;
$$;
revoke all on function public.profile_serve_return_statistics(bigint) from public;
grant execute on function public.profile_serve_return_statistics(bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
