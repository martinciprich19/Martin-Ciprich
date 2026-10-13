-- Apply after 048. Historical set breakdowns cannot be reconstructed.
begin;
do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'live_matches'
      and column_name = 'set_statistics') then
    alter table public.live_matches
      add column set_statistics jsonb not null default '[]'::jsonb;
    update public.live_matches
      set set_statistics = (
        select coalesce(jsonb_agg(null::jsonb), '[]'::jsonb)
        from generate_series(1, least(3, jsonb_array_length(completed_sets)
          + case when team_a_sets < 2 and team_b_sets < 2 then 1 else 0 end))
      )
      where started_at is not null or team_a_game_score + team_b_game_score > 0
        or team_a_games + team_b_games + team_a_sets + team_b_sets > 0;
  end if;
end;
$$;

alter table public.live_matches drop constraint if exists live_matches_set_statistics_shape;
alter table public.live_matches add constraint live_matches_set_statistics_shape
  check (jsonb_typeof(set_statistics) = 'array'
    and jsonb_array_length(set_statistics) <= 3
    and pg_column_size(set_statistics) <= 32768);

create or replace function public.guard_finished_set_statistics()
returns trigger language plpgsql set search_path = public as $$
begin
  if (old.team_a_sets >= 2 or old.team_b_sets >= 2)
    and new.set_statistics is distinct from old.set_statistics then
    raise exception 'Zapas je ukonceny. Statistiky setov uz nie je mozne menit.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_finished_set_statistics() from public;
drop trigger if exists guard_finished_set_statistics on public.live_matches;
create trigger guard_finished_set_statistics before update on public.live_matches
  for each row execute function public.guard_finished_set_statistics();

grant select (set_statistics), insert (set_statistics), update (set_statistics)
  on public.live_matches to anon, authenticated;
notify pgrst, 'reload schema';
commit;
