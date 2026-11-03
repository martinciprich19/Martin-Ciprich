-- Global management actions are intentionally restricted to trusted Supabase
-- app_metadata. Never let a user grant this role to themselves from the app.
begin;

do $$
begin
  if to_regclass('public.arenas') is null
    or to_regclass('public.arena_admins') is null
    or to_regclass('public.arena_kiosk_devices') is null
    or to_regclass('public.notifications') is null then
    raise exception 'Apply arena, kiosk-device and notification migrations before 079_super_admin_console.sql.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'arenas'
      and column_name = 'id' and data_type = 'bigint'
  ) then
    raise exception 'Expected public.arenas.id to be bigint, as required by migration 071.';
  end if;
end;
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role' = 'super_admin', false);
$$;

grant execute on function public.is_super_admin() to authenticated;

create table if not exists public.super_admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id),
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.super_admin_audit_log enable row level security;
revoke all on public.super_admin_audit_log from anon, authenticated;
grant select on public.super_admin_audit_log to authenticated;

drop policy if exists "super_admin_read_audit_log" on public.super_admin_audit_log;
create policy "super_admin_read_audit_log" on public.super_admin_audit_log
  for select to authenticated using ((select public.is_super_admin()));

drop policy if exists "super_admin_manage_all_arenas" on public.arenas;
create policy "super_admin_manage_all_arenas" on public.arenas
  for all to authenticated
  using ((select public.is_super_admin()))
  with check ((select public.is_super_admin()));

drop policy if exists "super_admin_read_arena_admins" on public.arena_admins;
create policy "super_admin_read_arena_admins" on public.arena_admins
  for select to authenticated using ((select public.is_super_admin()));

drop policy if exists "super_admin_read_kiosk_devices" on public.arena_kiosk_devices;
create policy "super_admin_read_kiosk_devices" on public.arena_kiosk_devices
  for select to authenticated using ((select public.is_super_admin()));

grant select (id, arena_id, name, created_at, revoked_at) on public.arena_kiosk_devices to authenticated;

drop policy if exists "notifications_read_global" on public.notifications;
create policy "notifications_read_global" on public.notifications
  for select to authenticated using (user_id is null);
grant select on public.notifications to authenticated;

create or replace function public.record_super_admin_action(
  p_action text,
  p_target_type text,
  p_target_id text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;

  insert into public.super_admin_audit_log (actor_id, action, target_type, target_id, details)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb));
end;
$$;

revoke all on function public.record_super_admin_action(text, text, text, jsonb) from public, anon, authenticated;

create or replace function public.super_admin_audit_arena_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_arena public.arenas%rowtype;
  action_name text;
begin
  if not public.is_super_admin() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    changed_arena := old;
    action_name := 'arena.deleted';
  elsif tg_op = 'INSERT' then
    changed_arena := new;
    action_name := 'arena.created';
  else
    changed_arena := new;
    action_name := 'arena.updated';
  end if;

  perform public.record_super_admin_action(
    action_name, 'arena', changed_arena.id::text,
    jsonb_build_object('name', changed_arena.name, 'city', changed_arena.city, 'is_active', changed_arena.is_active)
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.super_admin_audit_arena_change() from public, anon, authenticated;
drop trigger if exists super_admin_audit_arena_changes on public.arenas;
create trigger super_admin_audit_arena_changes
  after insert or update or delete on public.arenas
  for each row execute function public.super_admin_audit_arena_change();

create or replace function public.super_admin_list_arena_managers()
returns table (arena_id bigint, user_id uuid, email text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;

  return query
    select aa.arena_id, aa.user_id, u.email::text, aa.created_at
    from public.arena_admins aa
    join auth.users u on u.id = aa.user_id
    order by aa.arena_id, lower(u.email);
end;
$$;

revoke all on function public.super_admin_list_arena_managers() from public, anon;
grant execute on function public.super_admin_list_arena_managers() to authenticated;

create or replace function public.super_admin_create_arena(
  p_name text,
  p_city text,
  p_address text,
  p_country_code text,
  p_region text,
  p_court_count integer
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  columns_sql text := '';
  values_sql text := '';
  new_arena_id bigint;
  region_code text;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_city), '') is null
    or nullif(trim(p_address), '') is null or nullif(trim(p_region), '') is null
    or p_country_code is null or p_country_code !~ '^[A-Z]{2}$'
    or p_court_count is null or p_court_count < 1 or p_court_count > 100 then
    raise exception 'Invalid arena details' using errcode = '22023';
  end if;

  if to_regclass('public.league_subdivisions') is not null then
    execute 'select code from public.league_subdivisions where country_code = $1 and (lower(name) = lower($2) or code = $2) limit 1'
      into region_code using p_country_code, trim(p_region);
  end if;

  columns_sql := '"name", "city", "address"';
  values_sql := format('%L, %L, %L', trim(p_name), trim(p_city), trim(p_address));

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'arenas' and column_name = 'region') then
    columns_sql := columns_sql || ', "region"';
    values_sql := values_sql || format(', %L', trim(p_region));
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'arenas' and column_name = 'country_code') then
    columns_sql := columns_sql || ', "country_code"';
    values_sql := values_sql || format(', %L', p_country_code);
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'arenas' and column_name = 'subdivision_code') then
    columns_sql := columns_sql || ', "subdivision_code"';
    values_sql := values_sql || format(', %L', region_code);
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'arenas' and column_name = 'courts_count') then
    columns_sql := columns_sql || ', "courts_count"';
    values_sql := values_sql || format(', %L', p_court_count);
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'arenas' and column_name = 'courts_indoor') then
    columns_sql := columns_sql || ', "courts_indoor"';
    values_sql := values_sql || ', 0';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'arenas' and column_name = 'courts_outdoor') then
    columns_sql := columns_sql || ', "courts_outdoor"';
    values_sql := values_sql || format(', %L', p_court_count);
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'arenas' and column_name = 'is_active') then
    columns_sql := columns_sql || ', "is_active"';
    values_sql := values_sql || ', true';
  end if;

  execute format('insert into public.arenas (%s) values (%s) returning id', columns_sql, values_sql)
    into new_arena_id;

  return new_arena_id;
end;
$$;

revoke all on function public.super_admin_create_arena(text, text, text, text, text, integer) from public, anon;
grant execute on function public.super_admin_create_arena(text, text, text, text, text, integer) to authenticated;

create or replace function public.super_admin_set_arena_active(p_arena_id bigint, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;

  update public.arenas set is_active = p_is_active where id = p_arena_id;
  if not found then
    raise exception 'Arena not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.super_admin_set_arena_active(bigint, boolean) from public, anon;
grant execute on function public.super_admin_set_arena_active(bigint, boolean) to authenticated;

create or replace function public.super_admin_assign_arena_manager(p_arena_id bigint, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
  select id into target_user_id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if target_user_id is null then
    raise exception 'No Supabase user found for that email' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.arenas where id = p_arena_id) then
    raise exception 'Arena not found' using errcode = 'P0002';
  end if;

  insert into public.arena_admins (arena_id, user_id)
  values (p_arena_id, target_user_id)
  on conflict (arena_id, user_id) do nothing;
  perform public.record_super_admin_action(
    'arena_manager.assigned', 'arena', p_arena_id::text,
    jsonb_build_object('user_id', target_user_id, 'email', lower(trim(p_email)))
  );
end;
$$;

revoke all on function public.super_admin_assign_arena_manager(bigint, text) from public, anon;
grant execute on function public.super_admin_assign_arena_manager(bigint, text) to authenticated;

create or replace function public.super_admin_remove_arena_manager(p_arena_id bigint, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_count integer;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;

  delete from public.arena_admins where arena_id = p_arena_id and user_id = p_user_id;
  get diagnostics removed_count = row_count;
  if removed_count = 0 then
    raise exception 'Arena manager assignment not found' using errcode = 'P0002';
  end if;
  perform public.record_super_admin_action(
    'arena_manager.removed', 'arena', p_arena_id::text,
    jsonb_build_object('user_id', p_user_id)
  );
end;
$$;

revoke all on function public.super_admin_remove_arena_manager(bigint, uuid) from public, anon;
grant execute on function public.super_admin_remove_arena_manager(bigint, uuid) to authenticated;

create or replace function public.super_admin_revoke_kiosk_device(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  device_arena_id bigint;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;

  update public.arena_kiosk_devices
  set revoked_at = coalesce(revoked_at, now())
  where id = p_device_id
  returning arena_id into device_arena_id;
  if not found then
    raise exception 'Kiosk device not found' using errcode = 'P0002';
  end if;
  perform public.record_super_admin_action(
    'kiosk_device.revoked', 'kiosk_device', p_device_id::text,
    jsonb_build_object('arena_id', device_arena_id)
  );
end;
$$;

revoke all on function public.super_admin_revoke_kiosk_device(uuid) from public, anon;
grant execute on function public.super_admin_revoke_kiosk_device(uuid) to authenticated;

create or replace function public.super_admin_send_announcement(p_title text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification_id uuid;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
  if nullif(trim(p_title), '') is null or nullif(trim(p_body), '') is null
    or length(trim(p_title)) > 120 or length(trim(p_body)) > 1000 then
    raise exception 'Announcement title/body is required and must be within its length limit'
      using errcode = '22023';
  end if;

  insert into public.notifications (user_id, type, title, body, message, is_read)
  values (null, 'system_announcement', trim(p_title), trim(p_body), trim(p_body), false)
  returning id into notification_id;
  perform public.record_super_admin_action(
    'announcement.sent', 'notification', notification_id::text,
    jsonb_build_object('title', trim(p_title))
  );
  return notification_id;
end;
$$;

revoke all on function public.super_admin_send_announcement(text, text) from public, anon;
grant execute on function public.super_admin_send_announcement(text, text) to authenticated;

create index if not exists super_admin_audit_log_created_idx
  on public.super_admin_audit_log (created_at desc);

alter table public.notifications alter column user_id drop not null;

notify pgrst, 'reload schema';
commit;
