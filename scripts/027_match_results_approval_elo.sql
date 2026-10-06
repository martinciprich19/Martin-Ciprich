begin;

-- Preserve existing rows; add nullable participant columns when the legacy table lacks them.
alter table public.matches
  add column if not exists player1_id bigint,
  add column if not exists player2_id bigint,
  add column if not exists team1_player2_id bigint,
  add column if not exists team2_player2_id bigint,
  add column if not exists winner_id bigint,
  add column if not exists match_date timestamptz,
  add column if not exists status text not null default 'pending';

alter table public.matches
  add column if not exists result_sets jsonb,
  add column if not exists arena_name text,
  add column if not exists submitted_by bigint references public.proffiles(id),
  add column if not exists approved_profile_ids bigint[] not null default '{}',
  add column if not exists rejected_by bigint references public.proffiles(id),
  add column if not exists elo_applied boolean not null default false,
  add column if not exists elo_delta_team1 integer,
  add column if not exists elo_delta_team2 integer;

do $$
declare
  participant_column text;
  participant_columns text[] := array['player1_id', 'player2_id', 'team1_player2_id', 'team2_player2_id', 'winner_id'];
  actual_type text;
begin
  foreach participant_column in array participant_columns loop
    select format_type(attribute.atttypid, attribute.atttypmod)
    into actual_type
    from pg_attribute as attribute
    where attribute.attrelid = 'public.matches'::regclass
      and attribute.attname = participant_column
      and not attribute.attisdropped;
    if actual_type <> 'bigint' then
      raise exception 'public.matches.% má typ %, očakával sa bigint ID z public.proffiles.id', participant_column, actual_type;
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.matches'::regclass and conname = 'matches_player1_id_proffiles_fkey'
  ) then
    alter table public.matches add constraint matches_player1_id_proffiles_fkey
      foreign key (player1_id) references public.proffiles(id) on delete restrict not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.matches'::regclass and conname = 'matches_player2_id_proffiles_fkey'
  ) then
    alter table public.matches add constraint matches_player2_id_proffiles_fkey
      foreign key (player2_id) references public.proffiles(id) on delete restrict not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.matches'::regclass and conname = 'matches_team1_player2_id_proffiles_fkey'
  ) then
    alter table public.matches add constraint matches_team1_player2_id_proffiles_fkey
      foreign key (team1_player2_id) references public.proffiles(id) on delete restrict not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.matches'::regclass and conname = 'matches_team2_player2_id_proffiles_fkey'
  ) then
    alter table public.matches add constraint matches_team2_player2_id_proffiles_fkey
      foreign key (team2_player2_id) references public.proffiles(id) on delete restrict not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.matches'::regclass and conname = 'matches_winner_id_proffiles_fkey'
  ) then
    alter table public.matches add constraint matches_winner_id_proffiles_fkey
      foreign key (winner_id) references public.proffiles(id) on delete restrict not valid;
  end if;
end;
$$;

update public.matches set approved_profile_ids = '{}' where approved_profile_ids is null;
alter table public.matches alter column approved_profile_ids set default '{}';
alter table public.matches alter column approved_profile_ids set not null;
update public.matches set elo_applied = false where elo_applied is null;
update public.matches set elo_applied = true where status in ('approved', 'confirmed');
alter table public.matches alter column elo_applied set default false;
alter table public.matches alter column elo_applied set not null;

do $$
declare
  status_constraint record;
begin
  for status_constraint in
    select constraint_info.conname
    from pg_constraint as constraint_info
    join pg_attribute as attribute_info
      on attribute_info.attrelid = constraint_info.conrelid
      and attribute_info.attnum = any(constraint_info.conkey)
    where constraint_info.conrelid = 'public.matches'::regclass
      and constraint_info.contype = 'c'
      and attribute_info.attname = 'status'
  loop
    execute format('alter table public.matches drop constraint %I', status_constraint.conname);
  end loop;
end;
$$;

alter table public.matches add constraint matches_result_status_check
  check (status in ('pending', 'confirmed', 'approved', 'rejected', 'disputed', 'cancelled', 'declined')) not valid;

alter table public.matches enable row level security;
grant select on public.matches to authenticated;
revoke insert, update, delete on public.matches from anon, authenticated;

drop policy if exists "profiles read own results" on public.matches;
create policy "profiles read own results" on public.matches
  for select to authenticated using (
    exists (
      select 1 from public.proffiles as profile
      where lower(profile.email) = lower(auth.jwt() ->> 'email')
        and profile.id::text in (
          matches.player1_id::text, matches.player2_id::text,
          matches.team1_player2_id::text, matches.team2_player2_id::text
        )
    )
  );

drop policy if exists "result inserts require RPC" on public.matches;
create policy "result inserts require RPC" on public.matches as restrictive
  for insert to authenticated with check (false);
drop policy if exists "result updates require RPC" on public.matches;
create policy "result updates require RPC" on public.matches as restrictive
  for update to authenticated using (false) with check (false);

create or replace function public.submit_match_result(
  p_player1_id bigint,
  p_team1_player2_id bigint,
  p_player2_id bigint,
  p_team2_player2_id bigint,
  p_match_date timestamptz,
  p_arena_name text,
  p_sets jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id bigint;
  participant_ids bigint[] := array[p_player1_id, p_team1_player2_id, p_player2_id, p_team2_player2_id];
  set_record jsonb;
  first_score integer;
  second_score integer;
  team1_sets integer := 0;
  team2_sets integer := 0;
  team1_games integer := 0;
  team2_games integer := 0;
  result_id text;
begin
  if auth.uid() is null then raise exception 'Prihlásenie je potrebné.'; end if;
  select id into current_profile_id from public.proffiles
    where lower(email) = lower(auth.jwt() ->> 'email') limit 1;
  if current_profile_id is null or not (current_profile_id = any(participant_ids)) then
    raise exception 'Výsledok môže zadať iba účastník zápasu.';
  end if;
  if (select count(distinct participant) from unnest(participant_ids) as participant) <> 4
    or (select count(*) from public.proffiles where id = any(participant_ids)) <> 4 then
    raise exception 'Vyber štyroch rôznych registrovaných hráčov.';
  end if;
  if p_match_date is null or nullif(trim(p_arena_name), '') is null then
    raise exception 'Vyplň dátum zápasu a arénu.';
  end if;
  if p_sets is null or jsonb_typeof(p_sets) <> 'array' then
    raise exception 'Neplatné skóre zápasu.';
  end if;
  if jsonb_array_length(p_sets) not in (2, 3) then
    raise exception 'Zápas musí mať dva alebo tri sety.';
  end if;
  for set_record in select value from jsonb_array_elements(p_sets) loop
    if team1_sets = 2 or team2_sets = 2 then
      raise exception 'Po dvoch víťazných setoch sa ďalší set nehrá.';
    end if;
    if coalesce(jsonb_typeof(set_record -> 'team1Score'), '') <> 'number'
      or coalesce(jsonb_typeof(set_record -> 'team2Score'), '') <> 'number'
      or coalesce(set_record ->> 'team1Score', '') !~ '^[0-7]$'
      or coalesce(set_record ->> 'team2Score', '') !~ '^[0-7]$' then
      raise exception 'Skóre setu musí byť celé číslo od 0 do 7.';
    end if;
    first_score := (set_record ->> 'team1Score')::integer;
    second_score := (set_record ->> 'team2Score')::integer;
    if not (
      (greatest(first_score, second_score) = 6 and least(first_score, second_score) <= 4)
      or (greatest(first_score, second_score) = 7 and least(first_score, second_score) in (5, 6))
    ) then raise exception 'Neplatný výsledok setu.'; end if;
    team1_sets := team1_sets + case when first_score > second_score then 1 else 0 end;
    team2_sets := team2_sets + case when second_score > first_score then 1 else 0 end;
    team1_games := team1_games + first_score;
    team2_games := team2_games + second_score;
  end loop;
  if greatest(team1_sets, team2_sets) <> 2 then
    raise exception 'Zápas musí mať dvojicu s dvoma víťaznými setmi.';
  end if;

  insert into public.matches (
    player1_id, team1_player2_id, player2_id, team2_player2_id,
    winner_id, match_date, status, player1_sets_won, player2_sets_won,
    player1_games_won, player2_games_won, result_sets, arena_name, submitted_by
  ) values (
    p_player1_id, p_team1_player2_id, p_player2_id, p_team2_player2_id,
    case when team1_sets = 2 then p_player1_id else p_player2_id end,
    p_match_date, 'pending', team1_sets, team2_sets,
    team1_games, team2_games, p_sets, trim(p_arena_name), current_profile_id
  ) returning id::text into result_id;
  return result_id;
end;
$$;

create or replace function public.respond_to_match_result(p_match_id text, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id bigint;
  match_record public.matches%rowtype;
  participant_ids bigint[];
  approved_ids bigint[];
  team1_elo numeric;
  team2_elo numeric;
  expected_team1 numeric;
  team1_delta integer;
begin
  if auth.uid() is null then raise exception 'Prihlásenie je potrebné.'; end if;
  if p_accept is null then raise exception 'Vyber potvrdenie alebo odmietnutie.'; end if;
  select id into current_profile_id from public.proffiles
    where lower(email) = lower(auth.jwt() ->> 'email') limit 1;
  select * into match_record from public.matches where id::text = p_match_id for update;
  if not found then raise exception 'Zápas sa nenašiel.'; end if;
  participant_ids := array[match_record.player1_id, match_record.team1_player2_id, match_record.player2_id, match_record.team2_player2_id];
  if current_profile_id is null or not (current_profile_id = any(participant_ids)) then
    raise exception 'Na výsledok môže odpovedať iba účastník zápasu.';
  end if;
  if match_record.status in ('confirmed', 'approved') then return match_record.status; end if;
  if match_record.status <> 'pending' then raise exception 'Na tento výsledok už nemožno odpovedať.'; end if;
  if match_record.elo_applied then raise exception 'Body tohto zápasu už boli započítané.'; end if;
  if not p_accept then
    update public.matches set status = 'rejected', rejected_by = current_profile_id where id::text = p_match_id;
    return 'rejected';
  end if;

  approved_ids := match_record.approved_profile_ids;
  if not (current_profile_id = any(approved_ids)) then
    approved_ids := array_append(approved_ids, current_profile_id);
  end if;
  update public.matches set approved_profile_ids = approved_ids where id::text = p_match_id;
  if not (participant_ids <@ approved_ids) then return 'pending'; end if;
  if match_record.result_sets is null then
    raise exception 'Starý výsledok bez jednotlivých setov musí byť zadaný znovu.';
  end if;

  perform id from public.proffiles where id = any(participant_ids) order by id for update;
  select avg(coalesce(elo_rating, 1000)) into team1_elo from public.proffiles
    where id in (match_record.player1_id, match_record.team1_player2_id);
  select avg(coalesce(elo_rating, 1000)) into team2_elo from public.proffiles
    where id in (match_record.player2_id, match_record.team2_player2_id);
  expected_team1 := 1 / (1 + power(10::numeric, (team2_elo - team1_elo) / 400));
  team1_delta := round(32 * ((case when match_record.winner_id in (match_record.player1_id, match_record.team1_player2_id) then 1 else 0 end) - expected_team1));

  update public.proffiles as profile
  set elo_rating = coalesce(profile.elo_rating, 1000) + case when profile.id in (match_record.player1_id, match_record.team1_player2_id) then team1_delta else -team1_delta end,
      highest_elo = greatest(coalesce(profile.highest_elo, profile.elo_rating, 1000), coalesce(profile.elo_rating, 1000) + case when profile.id in (match_record.player1_id, match_record.team1_player2_id) then team1_delta else -team1_delta end),
      matches_played = coalesce(profile.matches_played, 0) + 1,
      matches_won = coalesce(profile.matches_won, 0) + case when
        (profile.id in (match_record.player1_id, match_record.team1_player2_id)) =
        (match_record.winner_id in (match_record.player1_id, match_record.team1_player2_id)) then 1 else 0 end
  where profile.id = any(participant_ids);

  update public.matches set status = 'confirmed', elo_applied = true,
    elo_delta_team1 = team1_delta, elo_delta_team2 = -team1_delta
    where id::text = p_match_id;
  return 'confirmed';
end;
$$;

revoke all on function public.submit_match_result(bigint, bigint, bigint, bigint, timestamptz, text, jsonb) from public;
revoke all on function public.respond_to_match_result(text, boolean) from public;
grant execute on function public.submit_match_result(bigint, bigint, bigint, bigint, timestamptz, text, jsonb) to authenticated;
grant execute on function public.respond_to_match_result(text, boolean) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matches'
  ) then alter publication supabase_realtime add table public.matches; end if;
end;
$$;

notify pgrst, 'reload schema';

commit;