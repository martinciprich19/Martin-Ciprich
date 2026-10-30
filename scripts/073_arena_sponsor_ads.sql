-- Apply after migrations 071 and 072 in the Supabase SQL Editor.
-- Public displays rotate arena sponsor images only when no match is active.
begin;

do $$
begin
  if to_regclass('public.arena_admins') is null
    or to_regclass('public.arena_courts') is null
    or to_regclass('public.live_matches') is null then
    raise exception 'Missing arena manager, court or live match tables. Apply migrations 071 and 072 first.';
  end if;
  if to_regprocedure('public.get_court_scoreboard(bigint)') is null then
    raise exception 'Missing public.get_court_scoreboard(bigint). Apply migration 072 first.';
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'arena-sponsor-ads',
  'arena-sponsor-ads',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists arena_sponsor_ads_public_read on storage.objects;
create policy arena_sponsor_ads_public_read
  on storage.objects for select
  using (bucket_id = 'arena-sponsor-ads');

drop policy if exists arena_sponsor_ads_manager_insert on storage.objects;
create policy arena_sponsor_ads_manager_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'arena-sponsor-ads'
    and case
      when (storage.foldername(name))[1] ~ '^[1-9][0-9]*$'
        then public.is_arena_admin((storage.foldername(name))[1]::bigint)
      else false
    end
  );

drop policy if exists arena_sponsor_ads_manager_update on storage.objects;
create policy arena_sponsor_ads_manager_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'arena-sponsor-ads'
    and case
      when (storage.foldername(name))[1] ~ '^[1-9][0-9]*$'
        then public.is_arena_admin((storage.foldername(name))[1]::bigint)
      else false
    end
  )
  with check (
    bucket_id = 'arena-sponsor-ads'
    and case
      when (storage.foldername(name))[1] ~ '^[1-9][0-9]*$'
        then public.is_arena_admin((storage.foldername(name))[1]::bigint)
      else false
    end
  );

drop policy if exists arena_sponsor_ads_manager_delete on storage.objects;
create policy arena_sponsor_ads_manager_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'arena-sponsor-ads'
    and case
      when (storage.foldername(name))[1] ~ '^[1-9][0-9]*$'
        then public.is_arena_admin((storage.foldername(name))[1]::bigint)
      else false
    end
  );

create table if not exists public.arena_sponsor_ads (
  id uuid primary key default gen_random_uuid(),
  arena_id bigint not null references public.arenas(id) on delete cascade,
  sponsor_name text not null check (length(trim(sponsor_name)) between 1 and 100),
  image_path text not null unique,
  display_seconds smallint not null default 10 check (display_seconds between 5 and 60),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint arena_sponsor_ads_path_matches_arena
    check (image_path like arena_id::text || '/%')
);

create index if not exists arena_sponsor_ads_active_rotation_idx
  on public.arena_sponsor_ads (arena_id, sort_order, created_at)
  where is_active;

alter table public.arena_sponsor_ads enable row level security;
revoke all on public.arena_sponsor_ads from public, anon, authenticated;
grant select on public.arena_sponsor_ads to anon, authenticated;
grant insert, update, delete on public.arena_sponsor_ads to authenticated;

drop policy if exists arena_sponsor_ads_public_active_read on public.arena_sponsor_ads;
create policy arena_sponsor_ads_public_active_read
  on public.arena_sponsor_ads for select to anon, authenticated
  using (is_active);

drop policy if exists arena_sponsor_ads_manager_read on public.arena_sponsor_ads;
create policy arena_sponsor_ads_manager_read
  on public.arena_sponsor_ads for select to authenticated
  using ((select public.is_arena_admin(arena_id)));

drop policy if exists arena_sponsor_ads_manager_insert on public.arena_sponsor_ads;
create policy arena_sponsor_ads_manager_insert
  on public.arena_sponsor_ads for insert to authenticated
  with check (
    (select public.is_arena_admin(arena_id))
    and image_path like arena_id::text || '/%'
  );

drop policy if exists arena_sponsor_ads_manager_update on public.arena_sponsor_ads;
create policy arena_sponsor_ads_manager_update
  on public.arena_sponsor_ads for update to authenticated
  using ((select public.is_arena_admin(arena_id)))
  with check (
    (select public.is_arena_admin(arena_id))
    and image_path like arena_id::text || '/%'
  );

drop policy if exists arena_sponsor_ads_manager_delete on public.arena_sponsor_ads;
create policy arena_sponsor_ads_manager_delete
  on public.arena_sponsor_ads for delete to authenticated
  using ((select public.is_arena_admin(arena_id)));

drop function public.get_court_scoreboard(bigint);
create function public.get_court_scoreboard(p_court_id bigint)
returns table (
  court_id bigint,
  arena_id bigint,
  court_name text,
  match_id uuid,
  team_a_player1_name text,
  team_a_player2_name text,
  team_b_player1_name text,
  team_b_player2_name text,
  team_a_game_score smallint,
  team_b_game_score smallint,
  advantage_team text,
  tiebreak_score jsonb,
  team_a_games integer,
  team_b_games integer,
  team_a_sets integer,
  team_b_sets integer,
  started_at timestamptz,
  paused_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    court.id,
    court.arena_id,
    court.name,
    game.id,
    game.team_a_player1_name,
    game.team_a_player2_name,
    game.team_b_player1_name,
    game.team_b_player2_name,
    game.team_a_game_score,
    game.team_b_game_score,
    game.advantage_team,
    game.tiebreak_score,
    game.team_a_games,
    game.team_b_games,
    game.team_a_sets,
    game.team_b_sets,
    game.started_at,
    game.paused_at
  from public.arena_courts court
  join public.arenas arena on arena.id = court.arena_id and arena.is_active
  left join lateral (
    select live.*
    from public.live_matches live
    where live.court_id = court.id
      and live.started_at is not null
      and live.initial_server_chosen
      and live.finished_at is null
      and live.ended_early_at is null
      and (live.challenge_id is null or live.is_pin_activated)
    order by live.started_at desc
    limit 1
  ) game on true
  where court.id = p_court_id
    and court.is_active;
$$;

revoke all on function public.get_court_scoreboard(bigint) from public;
grant execute on function public.get_court_scoreboard(bigint) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
