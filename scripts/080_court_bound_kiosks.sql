-- Apply after 071, 072, 076 and 079. Existing unbound installations stay valid.
begin;

alter table public.arena_kiosk_devices
  add column if not exists court_id bigint references public.arena_courts(id) on delete restrict;
grant select (court_id) on public.arena_kiosk_devices to authenticated;

-- A global owner can use the same court/device management UI as an arena manager.
create or replace function public.is_arena_admin(p_arena_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    public.is_super_admin() or exists (
      select 1 from public.arena_admins manager
      where manager.arena_id = p_arena_id and manager.user_id = auth.uid()
    )
  );
$$;

create or replace function public.authorize_court_kiosk_device(
  p_arena_id bigint, p_court_id bigint, p_name text, p_token text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare device_id uuid;
begin
  if not public.is_arena_admin(p_arena_id) then
    raise exception 'Nemáš oprávnenie pre túto arénu.' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$'
    or p_name is null or length(trim(p_name)) not between 1 and 80 then
    raise exception 'Neplatné údaje zariadenia.' using errcode = '22023';
  end if;
  -- Lock the court so simultaneous authorizations cannot bind two tablets.
  perform court.id from public.arena_courts court
    join public.arenas arena on arena.id = court.arena_id
    where court.id = p_court_id and court.arena_id = p_arena_id
      and court.is_active and arena.is_active
    for update of court;
  if not found then
    raise exception 'Vyber aktívny kurt tejto arény.' using errcode = '22023';
  end if;
  if exists (select 1 from public.arena_kiosk_devices
    where court_id = p_court_id and revoked_at is null) then
    raise exception 'Kurt už má autorizovaný tablet. Najprv odvolaj pôvodné zariadenie.'
      using errcode = '23505';
  end if;
  insert into public.arena_kiosk_devices(arena_id, court_id, name, token_hash, authorized_by)
    values (p_arena_id, p_court_id, trim(p_name),
      encode(sha256(convert_to(p_token, 'UTF8')), 'hex'), auth.uid())
    returning id into device_id;
  return device_id;
end;
$$;
revoke all on function public.authorize_court_kiosk_device(bigint, bigint, text, text) from public, anon;
grant execute on function public.authorize_court_kiosk_device(bigint, bigint, text, text) to authenticated;

create or replace function public.get_kiosk_device_context(p_token text)
returns table (court_id bigint, available boolean)
language sql stable security definer set search_path = '' as $$
  select device.court_id,
    arena.is_active and (device.court_id is null or coalesce(court.is_active, false))
  from public.arena_kiosk_devices device
  join public.arenas arena on arena.id = device.arena_id
  left join public.arena_courts court on court.id = device.court_id and court.arena_id = device.arena_id
  join auth.users owner on owner.id = device.authorized_by
  where p_token ~ '^[a-f0-9]{64}$'
    and device.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and device.revoked_at is null
    and (
      owner.raw_app_meta_data ->> 'role' = 'super_admin'
      or exists (select 1 from public.arena_admins manager
        where manager.arena_id = device.arena_id and manager.user_id = device.authorized_by)
    );
$$;
revoke all on function public.get_kiosk_device_context(text) from public;
grant execute on function public.get_kiosk_device_context(text) to anon, authenticated;

create or replace function public.is_authorized_kiosk_device(p_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.get_kiosk_device_context(p_token) where available);
$$;

create or replace function public.keep_rematch_court()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.live_matches next_game
    set court_id = previous_game.court_id
    from public.live_matches previous_game
    where previous_game.id = new.previous_match_id and next_game.id = new.next_match_id;
  return new;
end;
$$;
revoke all on function public.keep_rematch_court() from public, anon, authenticated;
drop trigger if exists keep_rematch_court on public.live_match_rematches;
create trigger keep_rematch_court after insert on public.live_match_rematches
  for each row execute function public.keep_rematch_court();

notify pgrst, 'reload schema';
commit;
