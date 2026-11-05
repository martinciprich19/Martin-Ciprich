-- Apply after 086. Manual receipts, not invoices or bank synchronization.
begin;
create table public.arena_payment_receipts (
  id uuid primary key,
  arena_id bigint not null references public.arenas(id) on delete restrict,
  billing_month text not null check (billing_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  amount_cents integer not null check (amount_cents between 1 and 100000000),
  received_on date not null,
  note text not null check (length(trim(note)) between 3 and 300),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  void_reason text,
  check ((voided_at is null and voided_by is null and void_reason is null) or
    (voided_at is not null and voided_by is not null and void_reason is not null and length(trim(void_reason)) between 3 and 300))
);
create index arena_receipts_month_idx on public.arena_payment_receipts(billing_month, arena_id);
alter table public.arena_payment_receipts enable row level security;
revoke all on public.arena_payment_receipts from public, anon, authenticated;

create function public.super_admin_record_payment(
  p_id uuid, p_arena_id bigint, p_month text, p_cents integer, p_received_on date, p_note text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare existing public.arena_payment_receipts%rowtype;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
  if p_id is null or p_arena_id is null or p_month is null or p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
    or p_cents is null or p_cents not between 1 and 100000000
    or p_received_on is null or p_received_on > (now() at time zone 'Europe/Bratislava')::date
    or p_received_on < date '2000-01-01' or p_note is null or length(trim(p_note)) not between 3 and 300 then
    raise exception 'Skontroluj arénu, mesiac, kladnú sumu, dátum prijatia a poznámku.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select * into existing from public.arena_payment_receipts where id = p_id;
  if found then
    if (existing.arena_id,existing.billing_month,existing.amount_cents,existing.received_on,existing.note,existing.created_by)
      is distinct from (p_arena_id,p_month,p_cents,p_received_on,trim(p_note),auth.uid()) then
      raise exception 'Identifikátor platby už bol použitý.' using errcode = '22023';
    end if;
    return p_id;
  end if;
  if not exists(select 1 from public.arenas where id=p_arena_id) then
    raise exception 'Aréna neexistuje.' using errcode = '22023';
  end if;
  insert into public.arena_payment_receipts(id,arena_id,billing_month,amount_cents,received_on,note,created_by)
    values(p_id,p_arena_id,p_month,p_cents,p_received_on,trim(p_note),auth.uid());
  perform public.record_super_admin_action('payment.recorded','payment',p_id::text,
    jsonb_build_object('arena_id',p_arena_id,'month',p_month,'cents',p_cents,'note',trim(p_note)));
  return p_id;
end;
$$;
create function public.super_admin_void_payment(p_id uuid,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) not between 3 and 300 then
    raise exception 'Uveď dôvod storna (3 až 300 znakov).' using errcode = '22023';
  end if;
  perform id from public.arena_payment_receipts where id=p_id for update;
  if not found then raise exception 'Platba neexistuje.' using errcode = '22023'; end if;
  update public.arena_payment_receipts set voided_at=now(),voided_by=auth.uid(),void_reason=trim(p_reason)
    where id=p_id and voided_at is null;
  if found then
    perform public.record_super_admin_action('payment.voided','payment',p_id::text,jsonb_build_object('reason',trim(p_reason)));
  end if;
end;
$$;
create function public.arena_settlement_report(p_month text,p_arena_id bigint default null,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare month_start timestamptz; month_end timestamptz; result jsonb;
begin
  if auth.uid() is null or not (public.is_super_admin() or (p_arena_id is not null and public.is_arena_admin(p_arena_id))) then
    raise exception 'Nemáš oprávnenie zobraziť vyúčtovanie.' using errcode='42501';
  end if;
  if p_month is null or p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' or p_offset is null or p_offset<0 then
    raise exception 'Neplatný mesiac alebo strana.' using errcode='22023';
  end if;
  month_start := (p_month||'-01')::timestamp at time zone 'Europe/Bratislava';
  month_end := ((p_month||'-01')::timestamp+interval '1 month') at time zone 'Europe/Bratislava';
  with receipts as materialized (
    select * from public.arena_payment_receipts where billing_month=p_month and (p_arena_id is null or arena_id=p_arena_id)
  ), due as (
    select arena_id,sum(owner_share_cents) as cents from public.clicker_rentals
    where created_at>=month_start and created_at<month_end and voided_at is null group by arena_id
  ), paid as (
    select arena_id,sum(amount_cents) as cents from receipts where voided_at is null group by arena_id
  ), summary as (
    select a.id as arena_id,a.name as arena_name,coalesce(due.cents,0) as due_cents,
      coalesce(paid.cents,0) as paid_cents,coalesce(due.cents,0)-coalesce(paid.cents,0) as balance_cents
    from public.arenas a left join due on due.arena_id=a.id left join paid on paid.arena_id=a.id
    where p_arena_id is null or a.id=p_arena_id
  )
  select jsonb_build_object(
    'summary',coalesce((select jsonb_agg(s order by arena_name,arena_id) from summary s),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(r order by created_at desc,id) from
      (select * from receipts order by created_at desc,id limit 100 offset p_offset) r),'[]'::jsonb),
    'total_count',(select count(*) from receipts),'as_of',now()
  ) into result;
  return result;
end;
$$;
revoke all on function public.super_admin_record_payment(uuid,bigint,text,integer,date,text) from public,anon;
revoke all on function public.super_admin_void_payment(uuid,text) from public,anon;
revoke all on function public.arena_settlement_report(text,bigint,integer) from public,anon;
grant execute on function public.super_admin_record_payment(uuid,bigint,text,integer,date,text) to authenticated;
grant execute on function public.super_admin_void_payment(uuid,text) to authenticated;
grant execute on function public.arena_settlement_report(text,bigint,integer) to authenticated;
notify pgrst,'reload schema';
commit;
