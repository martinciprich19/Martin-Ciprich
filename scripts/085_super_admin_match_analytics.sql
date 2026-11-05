-- Apply after 079 and 072. Rolling periods use the match completion timestamp.
begin;
create index if not exists live_matches_court_finished_analytics_idx
  on public.live_matches(court_id, finished_at)
  where finished_at is not null and ended_early_at is null and started_at is not null;

create function public.super_admin_match_analytics()
returns table (
  arena_id bigint, arena_name text, court_id bigint, court_name text,
  last_day bigint, last_week bigint, last_month bigint, last_year bigint,
  as_of timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin access required.' using errcode='42501';
  end if;
  return query
    select a.id, a.name, c.id, c.name,
      count(m.id) filter(where m.finished_at >= now()-interval '24 hours'),
      count(m.id) filter(where m.finished_at >= now()-interval '7 days'),
      count(m.id) filter(where m.finished_at >= now()-interval '1 month'),
      count(m.id),
      now()
    from public.arenas a
    left join public.arena_courts c on c.arena_id=a.id
    left join public.live_matches m on m.court_id=c.id
      and m.started_at is not null and m.finished_at is not null
      and m.ended_early_at is null
      and m.finished_at >= now()-interval '1 year' and m.finished_at <= now()
    group by a.id,a.name,c.id,c.name
    order by a.name,a.id,c.name,c.id;
end;
$$;
revoke all on function public.super_admin_match_analytics() from public,anon;
grant execute on function public.super_admin_match_analytics() to authenticated;
notify pgrst,'reload schema';
commit;
