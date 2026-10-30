-- Database preparation for Slovak and Dutch national leagues.
-- Run the ENTIRE file in Supabase SQL Editor after migrations through 067.
-- Existing rows remain Slovak. No results, ELO, passwords or RLS policies change.
-- Deploy country-aware application queries BEFORE enabling Dutch registration.
begin;

create table if not exists public.league_countries (
  code text primary key check (code in ('SK', 'NL')),
  name text not null,
  default_language text not null check (default_language in ('sk', 'nl', 'en'))
);

insert into public.league_countries(code, name, default_language) values
  ('SK', 'Slovensko', 'sk'),
  ('NL', 'Nederland', 'nl')
on conflict (code) do update
  set name = excluded.name, default_language = excluded.default_language;

create table if not exists public.league_subdivisions (
  code text primary key,
  country_code text not null references public.league_countries(code),
  name text not null,
  unique (country_code, code),
  unique (country_code, name)
);

insert into public.league_subdivisions(code, country_code, name) values
  ('SK-BL', 'SK', 'Bratislavský kraj'),
  ('SK-TA', 'SK', 'Trnavský kraj'),
  ('SK-TC', 'SK', 'Trenčiansky kraj'),
  ('SK-NI', 'SK', 'Nitriansky kraj'),
  ('SK-ZI', 'SK', 'Žilinský kraj'),
  ('SK-BC', 'SK', 'Banskobystrický kraj'),
  ('SK-PV', 'SK', 'Prešovský kraj'),
  ('SK-KI', 'SK', 'Košický kraj'),
  ('NL-DR', 'NL', 'Drenthe'),
  ('NL-FL', 'NL', 'Flevoland'),
  ('NL-FR', 'NL', 'Fryslân'),
  ('NL-GE', 'NL', 'Gelderland'),
  ('NL-GR', 'NL', 'Groningen'),
  ('NL-LI', 'NL', 'Limburg'),
  ('NL-NB', 'NL', 'Noord-Brabant'),
  ('NL-NH', 'NL', 'Noord-Holland'),
  ('NL-OV', 'NL', 'Overijssel'),
  ('NL-UT', 'NL', 'Utrecht'),
  ('NL-ZE', 'NL', 'Zeeland'),
  ('NL-ZH', 'NL', 'Zuid-Holland')
on conflict (code) do update
  set country_code = excluded.country_code, name = excluded.name;

alter table public.league_countries enable row level security;
alter table public.league_subdivisions enable row level security;
revoke all on public.league_countries, public.league_subdivisions from public, anon, authenticated;
grant select on public.league_countries, public.league_subdivisions to anon, authenticated;
drop policy if exists league_countries_read on public.league_countries;
create policy league_countries_read on public.league_countries for select to anon, authenticated using (true);
drop policy if exists league_subdivisions_read on public.league_subdivisions;
create policy league_subdivisions_read on public.league_subdivisions for select to anon, authenticated using (true);

-- Constant defaults preserve existing records without firing their UPDATE guards.
-- Optional legacy/feature tables are extended only when present; no replacement
-- tournaments or marketplace schema is invented by this migration.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'proffiles', 'arenas', 'pairs', 'challenges', 'matches', 'live_matches',
    'player_requests', 'match_listings', 'teams', 'pair_challenges', 'tournaments'
  ] loop
    if to_regclass(format('public.%I', table_name)) is null then
      if table_name = any(array['proffiles', 'arenas', 'pairs', 'challenges', 'matches', 'live_matches']) then
        raise exception 'Missing required table public.%. Apply the earlier migrations first.', table_name;
      end if;
      raise notice 'Optional table public.% is absent; skipped.', table_name;
      continue;
    end if;
    execute format('alter table public.%I add column if not exists country_code text not null default ''SK'' references public.league_countries(code)', table_name);
    execute format('create index if not exists %I on public.%I(country_code)', table_name || '_country_code_idx', table_name);
    -- Some live-match columns use column-level SELECT grants.
    -- This adds access only to the non-sensitive country field, not other columns.
    execute format('grant select (country_code) on public.%I to anon, authenticated', table_name);
  end loop;
end;
$$;

alter table public.proffiles
  add column if not exists preferred_language text not null default 'sk'
    check (preferred_language in ('sk', 'nl', 'en'));
-- A BEFORE INSERT trigger supplies the country's language for new profiles.
alter table public.proffiles alter column preferred_language drop default;
grant select (preferred_language) on public.proffiles to anon, authenticated;

-- Keep legacy free-text region intact. Canonical subdivision codes are optional
-- until an existing user/venue chooses a known region in the new application.
alter table public.proffiles add column if not exists subdivision_code text;
alter table public.arenas add column if not exists subdivision_code text;
do $$
declare
  table_name text;
begin
  foreach table_name in array array['proffiles', 'arenas'] loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', table_name)::regclass
        and conname = table_name || '_country_subdivision_fk'
    ) then
      execute format('alter table public.%I add constraint %I foreign key (country_code, subdivision_code) references public.league_subdivisions(country_code, code)',
        table_name, table_name || '_country_subdivision_fk');
    end if;
    execute format('update public.%I p set subdivision_code = s.code from public.league_subdivisions s where p.subdivision_code is null and s.country_code = p.country_code and lower(trim(p.region)) = lower(s.name)', table_name);
    execute format('create index if not exists %I on public.%I(country_code, subdivision_code)', table_name || '_country_subdivision_idx', table_name);
    execute format('grant select (subdivision_code) on public.%I to anon, authenticated', table_name);
  end loop;
end;
$$;

-- The existing auth.users trigger inserts a profile without the new fields.
-- Read registration metadata here instead of replacing that trigger or losing
-- its existing name/gender/avatar/home-arena behaviour.
create or replace function public.set_profile_league_on_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  metadata jsonb;
begin
  select u.raw_user_meta_data into metadata from auth.users u
    where lower(u.email) = lower(new.email) limit 1;
  new.country_code := coalesce(nullif(metadata ->> 'country_code', ''), new.country_code, 'SK');
  new.preferred_language := coalesce(nullif(metadata ->> 'preferred_language', ''),
    new.preferred_language,
    (select c.default_language from public.league_countries c where c.code = new.country_code));
  new.subdivision_code := coalesce(nullif(metadata ->> 'subdivision_code', ''), new.subdivision_code);
  return new;
end;
$$;
revoke all on function public.set_profile_league_on_insert() from public, anon, authenticated;
drop trigger if exists a_set_profile_league_on_insert on public.proffiles;
create trigger a_set_profile_league_on_insert before insert on public.proffiles
  for each row execute function public.set_profile_league_on_insert();

create or replace function public.sync_league_subdivision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.country_code is distinct from old.country_code
      and new.subdivision_code is not distinct from old.subdivision_code then
      new.subdivision_code := null;
    elsif new.region is distinct from old.region
      and new.subdivision_code is not distinct from old.subdivision_code then
      new.subdivision_code := null;
    end if;
  end if;
  if new.subdivision_code is null then
    select s.code into new.subdivision_code from public.league_subdivisions s
      where s.country_code = new.country_code and lower(s.name) = lower(trim(new.region));
  else
    select s.name into new.region from public.league_subdivisions s
      where s.country_code = new.country_code and s.code = new.subdivision_code;
    if not found then raise exception 'Subdivision does not belong to the selected country.'; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_league_subdivision() from public, anon, authenticated;
drop trigger if exists b_sync_league_subdivision on public.proffiles;
create trigger b_sync_league_subdivision before insert or update of country_code, subdivision_code, region on public.proffiles
  for each row execute function public.sync_league_subdivision();
drop trigger if exists b_sync_league_subdivision on public.arenas;
create trigger b_sync_league_subdivision before insert or update of country_code, subdivision_code, region on public.arenas
  for each row execute function public.sync_league_subdivision();

comment on column public.proffiles.country_code is 'National league membership, not the currently browsed country. Do not change when switching the directory filter.';
comment on column public.proffiles.preferred_language is 'UI/email language independent of league country: sk, nl or en.';
comment on column public.matches.country_code is 'Country snapshot of the match. Existing results remain SK; never move them when a profile changes country.';

notify pgrst, 'reload schema';
commit;

-- Verification: expect SK=8 and NL=12. Existing profiles should be SK/sk.
select c.code, c.name, c.default_language, count(s.code) as subdivisions
from public.league_countries c
left join public.league_subdivisions s on s.country_code = c.code
group by c.code, c.name, c.default_language
order by c.code;
