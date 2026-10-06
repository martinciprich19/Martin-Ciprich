create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  challenger_1_id uuid not null references auth.users(id) on delete cascade,
  challenger_2_id uuid not null references auth.users(id) on delete cascade,
  challenged_1_id uuid not null references auth.users(id) on delete cascade,
  challenged_2_id uuid not null references auth.users(id) on delete cascade,
  arena_id uuid references public.arenas(id) on delete set null,
  match_date timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now()
);

alter table public.challenges
  add column if not exists arena_id uuid references public.arenas(id) on delete set null;

alter table public.challenges enable row level security;

drop policy if exists "challenge participants read challenges" on public.challenges;
create policy "challenge participants read challenges" on public.challenges
  for select to authenticated
  using ((select auth.uid()) in (challenger_1_id, challenger_2_id, challenged_1_id, challenged_2_id));

drop policy if exists "players create own challenges" on public.challenges;
create policy "players create own challenges" on public.challenges
  for insert to authenticated
  with check ((select auth.uid()) = challenger_1_id);

drop policy if exists "players update own challenges" on public.challenges;
create policy "players update own challenges" on public.challenges
  for update to authenticated
  using ((select auth.uid()) = challenger_1_id)
  with check ((select auth.uid()) = challenger_1_id);

grant select, insert, update on public.challenges to authenticated;
