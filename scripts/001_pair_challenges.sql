create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  player1_id uuid references auth.users(id) on delete set null,
  player2_id uuid references auth.users(id) on delete set null,
  player1_name text not null,
  player2_name text not null,
  region text not null default '',
  elo integer not null default 1000,
  created_at timestamptz not null default now()
);

create table if not exists public.pair_challenges (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  partner_name text not null,
  opponent_team_id uuid not null references public.teams(id) on delete cascade,
  opponent_team_name text not null,
  arena_name text not null,
  court_number integer not null check (court_number > 0),
  scheduled_at timestamptz not null,
  match_type text not null check (match_type in ('ranked', 'friendly')),
  note text,
  status text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED')),
  created_at timestamptz not null default now()
);

alter table public.teams enable row level security;
alter table public.pair_challenges enable row level security;

create policy "teams are readable by signed-in players" on public.teams
  for select to authenticated using (true);

create policy "players read own pair challenges" on public.pair_challenges
  for select to authenticated using ((select auth.uid()) = created_by);

create policy "players create own pair challenges" on public.pair_challenges
  for insert to authenticated with check ((select auth.uid()) = created_by);

create policy "players update own pair challenges" on public.pair_challenges
  for update to authenticated
  using ((select auth.uid()) = created_by)
  with check ((select auth.uid()) = created_by);

grant select on public.teams to authenticated;
grant select, insert, update on public.pair_challenges to authenticated;
