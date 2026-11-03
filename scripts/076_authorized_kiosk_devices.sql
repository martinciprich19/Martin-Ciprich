-- Explicit per-installation kiosk authorization by an assigned arena manager.
begin;
create table public.arena_kiosk_devices (
  id uuid primary key default gen_random_uuid(),
  arena_id bigint not null references public.arenas(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  token_hash text not null unique,
  authorized_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.arena_kiosk_devices enable row level security;
revoke all on public.arena_kiosk_devices from public, anon, authenticated;
grant select (id, arena_id, name, created_at, revoked_at) on public.arena_kiosk_devices to authenticated;
create policy kiosk_devices_manager_read on public.arena_kiosk_devices
  for select to authenticated using (public.is_arena_admin(arena_id));

create function public.authorize_kiosk_device(p_arena_id bigint, p_name text, p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare device_id uuid;
begin
  if not public.is_arena_admin(p_arena_id) then raise exception 'Nemáš oprávnenie pre túto arénu.'; end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$'
    or p_name is null or length(trim(p_name)) not between 1 and 80
  then raise exception 'Neplatné údaje zariadenia.'; end if;
  insert into public.arena_kiosk_devices(arena_id, name, token_hash, authorized_by)
    values (p_arena_id, trim(p_name), encode(sha256(convert_to(p_token, 'UTF8')), 'hex'), auth.uid())
    returning id into device_id;
  return device_id;
end;
$$;
revoke all on function public.authorize_kiosk_device(bigint, text, text) from public, anon;
grant execute on function public.authorize_kiosk_device(bigint, text, text) to authenticated;

create function public.revoke_kiosk_device(p_device_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare device public.arena_kiosk_devices%rowtype;
begin
  select * into device from public.arena_kiosk_devices where id = p_device_id for update;
  if not found or not public.is_arena_admin(device.arena_id)
    then raise exception 'Nemáš oprávnenie pre toto zariadenie.'; end if;
  update public.arena_kiosk_devices set revoked_at = now() where id = device.id;
end;
$$;
revoke all on function public.revoke_kiosk_device(uuid) from public, anon;
grant execute on function public.revoke_kiosk_device(uuid) to authenticated;

create function public.is_authorized_kiosk_device(p_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_token ~ '^[a-f0-9]{64}$' and exists (
    select 1 from public.arena_kiosk_devices device
    where device.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
      and device.revoked_at is null
      and exists (select 1 from public.arena_admins manager
        where manager.arena_id = device.arena_id and manager.user_id = device.authorized_by)
  );
$$;
revoke all on function public.is_authorized_kiosk_device(text) from public;
grant execute on function public.is_authorized_kiosk_device(text) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
