-- Repair the deployed on_auth_user_created trigger's incompatible profile insert.
-- Requires the player profile and national league schema (through 069).
begin;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger t
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where t.tgrelid = 'auth.users'::regclass
      and t.tgname = 'on_auth_user_created' and not t.tgisinternal
      and n.nspname = 'public' and p.proname = 'handle_new_user'
      and p.pronargs = 0 and t.tgenabled <> 'D'
  ) then
    raise exception 'Očakávaný registračný spúšťač sa nenašiel alebo nie je aktívny; oprava bola zastavená.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'proffiles'
      and column_name = 'id' and data_type = 'bigint' and is_identity = 'YES'
  ) then
    raise exception 'Profil nemá očakávané automaticky generované číselné ID; oprava bola zastavená.';
  end if;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(trim(new.email), '') is null then
    raise exception 'Na vytvorenie hráčskeho profilu je potrebný e-mail.';
  end if;

  if exists (select 1 from public.proffiles p where lower(p.email) = lower(new.email)) then
    raise exception 'Pre tento e-mail už existuje hráčsky profil; kontaktuj podporu.';
  end if;

  insert into public.proffiles (
    full_name, email, phone, elo_rating, highest_elo, matches_played, matches_won,
    region, level, dominant_hand, home_venue_id
  ) values (
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Hráč'),
    new.email,
    '',
    1000, 1000, 0, 0,
    coalesce(new.raw_user_meta_data ->> 'region', ''),
    coalesce(new.raw_user_meta_data ->> 'level', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'dominant_hand', ''), 'right'),
    nullif(new.raw_user_meta_data ->> 'home_venue_id', '')::bigint
  );
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

commit;
