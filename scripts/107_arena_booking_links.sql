-- Apply after 079_super_admin_console.sql.
begin;

alter table public.arenas add column if not exists booking_url text;
grant select (booking_url) on public.arenas to anon, authenticated;

create or replace function public.validate_arena_booking_url()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.booking_url is not null and auth.uid() is not null and not public.is_super_admin() then
      raise exception 'Super Admin access required' using errcode = '42501';
    end if;
  elsif new.booking_url is distinct from old.booking_url and auth.uid() is not null and not public.is_super_admin() then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;

  if new.booking_url is not null and (
    length(new.booking_url) > 2048
    or new.booking_url !~* '^https://[^/@[:space:]?#]+([/?#][^[:space:]]*)?$'
    or position(chr(92) in new.booking_url) > 0
  ) then
    raise exception 'Rezervacny odkaz musi byt platna HTTPS adresa bez prihlasovacich udajov.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_arena_booking_url on public.arenas;
create trigger validate_arena_booking_url
  before insert or update of booking_url on public.arenas
  for each row execute function public.validate_arena_booking_url();

create or replace function public.super_admin_set_arena_booking_url(p_arena_id bigint, p_booking_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
  update public.arenas set booking_url = nullif(trim(p_booking_url), '') where id = p_arena_id;
  if not found then
    raise exception 'Arena not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.super_admin_create_arena_with_booking(
  p_name text, p_city text, p_address text, p_country_code text, p_region text,
  p_court_count integer, p_booking_url text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_arena_id bigint;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
  new_arena_id := public.super_admin_create_arena(p_name, p_city, p_address, p_country_code, p_region, p_court_count);
  if nullif(trim(p_booking_url), '') is not null then
    perform public.super_admin_set_arena_booking_url(new_arena_id, p_booking_url);
  end if;
  return new_arena_id;
end;
$$;

revoke all on function public.super_admin_set_arena_booking_url(bigint, text) from public, anon;
grant execute on function public.super_admin_set_arena_booking_url(bigint, text) to authenticated;
revoke all on function public.super_admin_create_arena_with_booking(text, text, text, text, text, integer, text) from public, anon;
grant execute on function public.super_admin_create_arena_with_booking(text, text, text, text, text, integer, text) to authenticated;

commit;
