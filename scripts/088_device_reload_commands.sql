-- Apply after 084. Reload the web app, never reboot the operating system.
begin;
create table public.device_reload_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.arena_kiosk_devices(id) on delete restrict,
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '5 minutes',
  delivered_at timestamptz,
  acknowledged_at timestamptz
);
create index device_reload_pending_idx on public.device_reload_commands(device_id,requested_at desc);
alter table public.device_reload_commands enable row level security;
revoke all on public.device_reload_commands from public,anon,authenticated;
grant select on public.device_reload_commands to authenticated;
create policy device_reload_super_read on public.device_reload_commands for select to authenticated
  using ((select public.is_super_admin()));

create function public.super_admin_request_device_reload(p_device_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare device public.arena_kiosk_devices%rowtype; command_id uuid;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Super Admin access required' using errcode='42501';
  end if;
  select * into device from public.arena_kiosk_devices where id=p_device_id for update;
  if not found or device.revoked_at is not null or device.court_id is null then
    raise exception 'Vyber autorizované zariadenie priradené ku kurtu.' using errcode='22023';
  end if;
  if not exists(select 1 from public.arenas a join public.arena_courts c on c.arena_id=a.id
    where c.id=device.court_id and a.is_active and c.is_active) then
    raise exception 'Aréna alebo kurt sú pozastavené.' using errcode='22023';
  end if;
  if exists(select 1 from public.live_matches where court_id=device.court_id
    and started_at is not null and finished_at is null and ended_early_at is null) then
    raise exception 'Na kurte prebieha alebo je pozastavený zápas. Obnov zariadenie až po jeho ukončení.' using errcode='22023';
  end if;
  select id into command_id from public.device_reload_commands where device_id=device.id
    and acknowledged_at is null and expires_at>now() order by requested_at desc limit 1;
  if command_id is not null then return command_id; end if;
  insert into public.device_reload_commands(device_id,requested_by) values(device.id,auth.uid()) returning id into command_id;
  perform public.record_super_admin_action('device.reload_requested','device',device.id::text,jsonb_build_object('command_id',command_id));
  return command_id;
end;
$$;
create function public.poll_device_reload(p_token text,p_ack uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_device_id uuid; court bigint; command_id uuid;
begin
  select d.id,d.court_id into v_device_id,court from public.arena_kiosk_devices d
    join public.get_paired_device_context(p_token) context on context.court_id=d.court_id
    where d.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and d.revoked_at is null and context.available;
  if v_device_id is null then raise exception 'Neautorizované zariadenie.' using errcode='42501'; end if;
  if p_ack is not null then
    if not exists(select 1 from public.device_reload_commands where id=p_ack
      and device_reload_commands.device_id=v_device_id and delivered_at is not null) then
      raise exception 'Príkaz nebol doručený tomuto zariadeniu.' using errcode='22023';
    end if;
    update public.device_reload_commands set acknowledged_at=now()
      where id=p_ack and device_reload_commands.device_id=v_device_id
        and delivered_at is not null and acknowledged_at is null;
    return null;
  end if;
  if exists(select 1 from public.live_matches where court_id=court
    and started_at is not null and finished_at is null and ended_early_at is null) then return null; end if;
  select id into command_id from public.device_reload_commands
    where device_reload_commands.device_id=v_device_id and acknowledged_at is null and expires_at>now()
    order by requested_at desc limit 1 for update;
  if command_id is null then return null; end if;
  update public.device_reload_commands set delivered_at=coalesce(delivered_at,now()) where id=command_id;
  return command_id;
end;
$$;
revoke all on function public.super_admin_request_device_reload(uuid) from public,anon;
grant execute on function public.super_admin_request_device_reload(uuid) to authenticated;
revoke all on function public.poll_device_reload(text,uuid) from public;
grant execute on function public.poll_device_reload(text,uuid) to anon,authenticated;
notify pgrst,'reload schema';
commit;
