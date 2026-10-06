-- Partner arenas of the Slovak Padel League.
-- Admins are users whose app_metadata contains {"role": "admin"} (set in Supabase Dashboard → Authentication → Users,
-- or: update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}' where email = 'you@example.com';).

create table if not exists public.arenas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  region text not null,
  address text not null,
  google_maps_url text,
  courts_indoor integer not null default 0 check (courts_indoor >= 0),
  courts_outdoor integer not null default 0 check (courts_outdoor >= 0),
  surface_type text,
  amenities text[] not null default '{}',
  opening_hours jsonb not null default '{}'::jsonb,
  phone text,
  email text,
  website text,
  booking_url text,
  booking_api_endpoint text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arenas_has_court check (courts_indoor + courts_outdoor > 0)
);

alter table public.arenas enable row level security;

grant select on public.arenas to anon, authenticated;
grant insert, update, delete on public.arenas to authenticated;

drop policy if exists "arenas_public_read_active" on public.arenas;
create policy "arenas_public_read_active" on public.arenas for select
  to anon, authenticated
  using (is_active or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "arenas_admin_insert" on public.arenas;
create policy "arenas_admin_insert" on public.arenas for insert
  to authenticated
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "arenas_admin_update" on public.arenas;
create policy "arenas_admin_update" on public.arenas for update
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "arenas_admin_delete" on public.arenas;
create policy "arenas_admin_delete" on public.arenas for delete
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create or replace function public.set_arenas_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists arenas_set_updated_at on public.arenas;
create trigger arenas_set_updated_at before update on public.arenas
  for each row execute function public.set_arenas_updated_at();
