begin;

create table if not exists public.live_matches (
  id uuid primary key default gen_random_uuid(),
  team_a_player1_name text not null default 'Tím A',
  team_b_player1_name text not null default 'Tím B',
  team_a_game_score smallint not null default 0 check (team_a_game_score in (0, 15, 30, 40)),
  team_b_game_score smallint not null default 0 check (team_b_game_score in (0, 15, 30, 40)),
  serving_team text check (serving_team in ('TEAM_A', 'TEAM_B')),
  initial_server_chosen boolean not null default false,
  created_at timestamptz not null default now(),
  constraint live_matches_server_selection_check
    check (initial_server_chosen = (serving_team is not null))
);

alter table public.live_matches enable row level security;
grant select, insert, update on public.live_matches to anon, authenticated;

drop policy if exists "Anyone can read the live scoreboard" on public.live_matches;
create policy "Anyone can read the live scoreboard"
  on public.live_matches for select to anon, authenticated
  using (id = '00000000-0000-0000-0000-000000000001'::uuid);

drop policy if exists "Anyone can create the live scoreboard" on public.live_matches;
create policy "Anyone can create the live scoreboard"
  on public.live_matches for insert to anon, authenticated
  with check (id = '00000000-0000-0000-0000-000000000001'::uuid);

drop policy if exists "Anyone can update the live scoreboard" on public.live_matches;
create policy "Anyone can update the live scoreboard"
  on public.live_matches for update to anon, authenticated
  using (id = '00000000-0000-0000-0000-000000000001'::uuid)
  with check (id = '00000000-0000-0000-0000-000000000001'::uuid);

insert into public.live_matches (id)
values ('00000000-0000-0000-0000-000000000001'::uuid)
on conflict (id) do nothing;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'live_matches'
    ) then
    alter publication supabase_realtime add table public.live_matches;
  end if;
end;
$$;

commit;
