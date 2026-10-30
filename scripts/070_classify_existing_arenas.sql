-- Run the ENTIRE file in the Supabase SQL Editor after migration 068.
-- Explicit assignments for the two arenas reviewed in the application.
-- No country inference from names, and no historical match changes.
do $$
declare
  assignment record;
  matches_found integer;
  classified_ids text[] := array[]::text[];
  classified_id text;
begin
  lock table public.arenas in share row exclusive mode;
  lock table public.proffiles in share row exclusive mode;

  for assignment in
    select * from (values
      ('Flevopadel', 'Lelystad', 'NL', 'NL-FL'),
      ('Zilinska arena', 'zilina', 'SK', 'SK-ZI')
    ) as assignments(arena_name, arena_city, country_code, subdivision_code)
  loop
    select count(*) into matches_found from public.arenas a
    where lower(trim(a.name)) = lower(assignment.arena_name)
      and lower(trim(a.city)) = lower(assignment.arena_city);
    if matches_found <> 1 then
      raise exception 'Expected exactly one arena named % in %, found %. No changes applied.',
        assignment.arena_name, assignment.arena_city, matches_found;
    end if;
    if not exists (
      select 1 from public.league_subdivisions s
      where s.country_code = assignment.country_code and s.code = assignment.subdivision_code
    ) then
      raise exception 'Missing subdivision %. Apply migration 068 first.', assignment.subdivision_code;
    end if;
    select a.id::text into classified_id from public.arenas a
    where lower(trim(a.name)) = lower(assignment.arena_name)
      and lower(trim(a.city)) = lower(assignment.arena_city);
    classified_ids := array_append(classified_ids, classified_id);

    update public.arenas a
    set country_code = assignment.country_code,
        subdivision_code = assignment.subdivision_code,
        region = subdivision.name
    from public.league_subdivisions subdivision
    where subdivision.country_code = assignment.country_code
      and subdivision.code = assignment.subdivision_code
      and a.id::text = classified_id
      and (a.country_code, a.subdivision_code, a.region)
        is distinct from (assignment.country_code, assignment.subdivision_code, subdivision.name);
  end loop;

-- A reclassified venue cannot remain the home club of another national league.
-- Clear only incompatible links to these two venues; never move player membership.
with classified_arenas as (
  select a.id, a.country_code from public.arenas a
  where a.id::text = any(classified_ids)
), incompatible_links as (
  select p.id,
    exists (select 1 from classified_arenas a
      where a.id = p.home_venue_id and a.country_code <> p.country_code) as clear_home,
    exists (select 1 from classified_arenas a
      where a.id = p.auto_venue_id and a.country_code <> p.country_code) as clear_auto
  from public.proffiles p
)
update public.proffiles p
set home_venue_id = case when links.clear_home then null else p.home_venue_id end,
    auto_venue_id = case when links.clear_auto then null else p.auto_venue_id end
from incompatible_links links
where p.id = links.id and (links.clear_home or links.clear_auto);

end;
$$;

-- Check the result: Flevopadel = NL / NL-FL; Zilinska arena = SK / SK-ZI.
select id, name, city, country_code, subdivision_code, region
from public.arenas
order by country_code, name;
