-- Apply after 081. Last reported device state, not historical location tracking.
begin;
alter table public.arena_kiosk_devices
  add column last_seen_at timestamptz,
  add column battery_percent smallint check (battery_percent between 0 and 100),
  add column is_charging boolean,
  add column app_version text,
  add column telemetry_source text check (telemetry_source in ('browser','android'));
grant select(last_seen_at,battery_percent,is_charging,app_version,telemetry_source)
  on public.arena_kiosk_devices to authenticated;

create function public.report_device_heartbeat(
  p_token text, p_source text, p_battery integer, p_charging boolean, p_version text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_device_id uuid;
begin
  if p_source is null or p_source not in ('browser','android')
    or (p_battery is not null and p_battery not between 0 and 100)
    or (p_version is not null and (length(p_version) not between 1 and 40 or p_version !~ '^[A-Za-z0-9._+-]+$'))
    or (p_source='browser' and (p_battery is not null or p_charging is not null or p_version is not null)) then
    raise exception 'Neplatné údaje zariadenia.' using errcode='22023';
  end if;
  select d.id into v_device_id from public.arena_kiosk_devices d
    join public.get_paired_device_context(p_token) c on c.court_id=d.court_id
    where d.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
      and d.revoked_at is null and c.available;
  if v_device_id is null then
    raise exception 'Neautorizované zariadenie.' using errcode='42501';
  end if;
  update public.arena_kiosk_devices set last_seen_at=now(),
    battery_percent=p_battery, is_charging=p_charging,
    app_version=p_version, telemetry_source=p_source
    where id=v_device_id and (last_seen_at is null or last_seen_at < now()-interval '10 seconds');
  return found;
end;
$$;
revoke all on function public.report_device_heartbeat(text,text,integer,boolean,text) from public;
grant execute on function public.report_device_heartbeat(text,text,integer,boolean,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
