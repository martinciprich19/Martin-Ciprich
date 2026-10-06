alter table public.proffiles
  add column if not exists home_venue_id bigint references public.arenas(id) on delete set null,
  add column if not exists auto_venue_id bigint references public.arenas(id) on delete set null;

alter table public.matches
  add column if not exists arena_id bigint references public.arenas(id) on delete set null;

drop function if exists public.refresh_my_auto_venue();
drop function if exists public.recalculate_auto_venue_for_user(uuid);

create or replace function public.recalculate_auto_venue_for_user(target_auth_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  target_email text;
  target_profile_id bigint;
  selected_venue_id bigint;
begin
  select lower(u.email)
    into target_email
    from auth.users u
   where u.id = target_auth_user_id;

  if target_email is null then
    return null;
  end if;

  select p.id
    into target_profile_id
    from public.proffiles p
   where lower(p.email) = target_email
   limit 1;

  if target_profile_id is null then
    return null;
  end if;

  select m.arena_id
    into selected_venue_id
    from public.matches m
   where m.status = 'approved'
     and m.arena_id is not null
     and (
       target_auth_user_id::text = any(coalesce(m.team_a::text[], '{}'::text[]))
       or target_auth_user_id::text = any(coalesce(m.team_b::text[], '{}'::text[]))
     )
   group by m.arena_id
   order by count(*) desc, max(m.played_at) desc, m.arena_id
   limit 1;

  update public.proffiles
     set auto_venue_id = selected_venue_id
   where id = target_profile_id
     and auto_venue_id is distinct from selected_venue_id;

  return selected_venue_id;
end;
$$;

create or replace function public.refresh_my_auto_venue()
returns bigint
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  return public.recalculate_auto_venue_for_user(auth.uid());
end;
$$;

revoke all on function public.recalculate_auto_venue_for_user(uuid) from public, anon, authenticated;
revoke all on function public.refresh_my_auto_venue() from public, anon;
grant execute on function public.refresh_my_auto_venue() to authenticated;

create or replace function public.refresh_auto_venues_after_match_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  affected_user_ids text[] := '{}'::text[];
  affected_user_id text;
begin
  if tg_op <> 'INSERT' then
    affected_user_ids := affected_user_ids
      || coalesce(old.team_a::text[], '{}'::text[])
      || coalesce(old.team_b::text[], '{}'::text[]);
  end if;

  if tg_op <> 'DELETE' then
    affected_user_ids := affected_user_ids
      || coalesce(new.team_a::text[], '{}'::text[])
      || coalesce(new.team_b::text[], '{}'::text[]);
  end if;

  for affected_user_id in select distinct unnest(affected_user_ids)
  loop
    if affected_user_id is not null then
      perform public.recalculate_auto_venue_for_user(affected_user_id::uuid);
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function public.refresh_auto_venues_after_match_change() from public, anon, authenticated;

drop trigger if exists matches_refresh_auto_venues on public.matches;
create trigger matches_refresh_auto_venues
  after insert or update or delete on public.matches
  for each row execute function public.refresh_auto_venues_after_match_change();

create or replace function public.create_proffile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.proffiles (
    full_name, email, phone, elo_rating, matches_played, matches_won,
    region, level, dominant_hand, home_venue_id
  )
  values (
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Hráč'),
    coalesce(new.email, ''),
    '',
    1000,
    0,
    0,
    coalesce(new.raw_user_meta_data ->> 'region', ''),
    coalesce(new.raw_user_meta_data ->> 'level', ''),
    coalesce(new.raw_user_meta_data ->> 'dominant_hand', 'right'),
    nullif(new.raw_user_meta_data ->> 'home_venue_id', '')::bigint
  )
  on conflict do nothing;

  return new;
end;
$$;
