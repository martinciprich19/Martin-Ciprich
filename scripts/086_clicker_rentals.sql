-- Apply after 080. One rental is one whole clicker set, independent of matches.
begin;

create table public.clicker_rentals (
  id uuid primary key,
  arena_id bigint not null references public.arenas(id) on delete restrict,
  court_id bigint not null references public.arena_courts(id) on delete restrict,
  arena_name text not null,
  court_name text not null,
  duration_minutes integer not null check (duration_minutes in (90, 120)),
  price_cents integer not null,
  owner_share_cents integer not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  void_reason text,
  check ((duration_minutes = 90 and price_cents = 200 and owner_share_cents = 100)
    or (duration_minutes = 120 and price_cents = 250 and owner_share_cents = 125)),
  check ((voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and void_reason is not null and length(trim(void_reason)) between 3 and 300))
);
create index clicker_rentals_arena_created_idx on public.clicker_rentals(arena_id, created_at);
create index clicker_rentals_created_idx on public.clicker_rentals(created_at);
alter table public.clicker_rentals enable row level security;
revoke all on public.clicker_rentals from public, anon, authenticated;

create function public.record_clicker_rental(p_request_id uuid, p_court_id bigint, p_duration_minutes integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c record;
  existing public.clicker_rentals%rowtype;
begin
  select court.id, court.arena_id, court.name as court_name, arena.name as arena_name,
    court.is_active and arena.is_active as available
  into c from public.arena_courts court join public.arenas arena on arena.id = court.arena_id
  where court.id = p_court_id for share of court, arena;
  if auth.uid() is null or not found or not public.is_arena_admin(c.arena_id) then
    raise exception 'Nemáš oprávnenie evidovať prenájom na tomto kurte.' using errcode = '42501';
  end if;
  if p_request_id is null or p_duration_minutes is null or p_duration_minutes not in (90,120) then
    raise exception 'Vyber 90 alebo 120 minút a platný identifikátor.' using errcode = '22023';
  end if;
  -- The same request may be retried after a lost response, never charged twice.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into existing from public.clicker_rentals where id = p_request_id;
  if found then
    if existing.created_by <> auth.uid() or existing.court_id <> p_court_id
      or existing.duration_minutes <> p_duration_minutes then
      raise exception 'Identifikátor prenájmu už bol použitý.' using errcode = '22023';
    end if;
    return existing.id;
  end if;
  if not c.available then
    raise exception 'Prenájom možno pridať len na aktívny kurt v aktívnej aréne.' using errcode = '22023';
  end if;
  insert into public.clicker_rentals
    (id, arena_id, court_id, arena_name, court_name, duration_minutes, price_cents, owner_share_cents, created_by)
  values (p_request_id, c.arena_id, c.id, c.arena_name, c.court_name, p_duration_minutes,
    case when p_duration_minutes = 90 then 200 else 250 end,
    case when p_duration_minutes = 90 then 100 else 125 end, auth.uid());
  return p_request_id;
end;
$$;

create function public.void_clicker_rental(p_rental_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Storno môže vykonať iba Super Admin.' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) not between 3 and 300 then
    raise exception 'Uveď dôvod storna (3 až 300 znakov).' using errcode = '22023';
  end if;
  perform id from public.clicker_rentals where id = p_rental_id for update;
  if not found then
    raise exception 'Prenájom neexistuje.' using errcode = '22023';
  end if;
  update public.clicker_rentals set voided_at = now(), voided_by = auth.uid(), void_reason = trim(p_reason)
  where id = p_rental_id and voided_at is null;
end;
$$;

create function public.clicker_rental_report(p_month text, p_arena_id bigint default null, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  month_start timestamptz;
  month_end timestamptz;
  result jsonb;
begin
  if auth.uid() is null or not (
    public.is_super_admin() or (p_arena_id is not null and public.is_arena_admin(p_arena_id))
  ) then
    raise exception 'Nemáš oprávnenie zobraziť tieto prenájmy.' using errcode = '42501';
  end if;
  if p_month is null or p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then
    raise exception 'Neplatný mesiac (YYYY-MM, roky 2000 až 2099).' using errcode = '22023';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'Neplatná strana histórie.' using errcode = '22023';
  end if;
  month_start := (p_month || '-01')::timestamp at time zone 'Europe/Bratislava';
  month_end := ((p_month || '-01')::timestamp + interval '1 month') at time zone 'Europe/Bratislava';
  with selected as materialized (
    select * from public.clicker_rentals
    where created_at >= month_start and created_at < month_end
      and (p_arena_id is null or arena_id = p_arena_id)
  ), summary as (
    select arena_id, court_id, arena_name, court_name,
      count(*) filter (where duration_minutes = 90 and voided_at is null) as count_90,
      count(*) filter (where duration_minutes = 120 and voided_at is null) as count_120,
      coalesce(sum(price_cents) filter (where voided_at is null), 0) as revenue_cents,
      coalesce(sum(owner_share_cents) filter (where voided_at is null), 0) as owner_cents
    from selected group by arena_id, court_id, arena_name, court_name
  )
  select jsonb_build_object(
    'summary', coalesce((select jsonb_agg(s order by arena_name, court_name) from summary s), '[]'::jsonb),
    'rentals', coalesce((select jsonb_agg(r order by created_at desc, id)
      from (select * from selected order by created_at desc, id limit 100 offset p_offset) r), '[]'::jsonb),
    'total_count', (select count(*) from selected),
    'as_of', now()
  ) into result;
  return result;
end;
$$;

revoke all on function public.record_clicker_rental(uuid, bigint, integer) from public, anon;
revoke all on function public.void_clicker_rental(uuid, text) from public, anon;
revoke all on function public.clicker_rental_report(text, bigint, integer) from public, anon;
grant execute on function public.record_clicker_rental(uuid, bigint, integer) to authenticated;
grant execute on function public.void_clicker_rental(uuid, text) to authenticated;
grant execute on function public.clicker_rental_report(text, bigint, integer) to authenticated;
notify pgrst, 'reload schema';
commit;
