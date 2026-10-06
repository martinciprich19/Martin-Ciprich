-- 030: Fix player ID mapping in submit_match_result.
--
-- The deployed submit_match_result differed from 027. It ran without an auth
-- check and filled the wrong columns. The live matches table also has legacy
-- team1_player1_id / team2_player1_id columns. This migration replaces every
-- overload with one function that has explicit per-slot parameters, and makes
-- it fail loudly if any trigger changes the player columns.
--
-- Column semantics used by the app:
--   player1_id       = team1_player1_id = team 1, player 1
--   team1_player2_id                    = team 1, player 2
--   player2_id       = team2_player1_id = team 2, player 1
--   team2_player2_id                    = team 2, player 2

alter table public.matches
  add column if not exists team1_player1_id bigint references public.proffiles(id),
  add column if not exists team2_player1_id bigint references public.proffiles(id);

-- Repair existing rows: the canonical columns are player1_id / player2_id.
update public.matches set team1_player1_id = player1_id
  where player1_id is not null and team1_player1_id is distinct from player1_id;
update public.matches set team2_player1_id = player2_id
  where player2_id is not null and team2_player1_id is distinct from player2_id;

-- List user triggers on matches. Check these NOTICEs in the SQL editor output;
-- any trigger that rewrites player columns should be dropped.
do $$
declare t record;
begin
  for t in
    select tg.tgname, pg_get_triggerdef(tg.oid) as def
    from pg_trigger tg
    where tg.tgrelid = 'public.matches'::regclass and not tg.tgisinternal
  loop
    raise notice 'matches trigger: % -> %', t.tgname, t.def;
  end loop;
end $$;

-- Drop all existing overloads so PostgREST can't pick an old one.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_match_result'
  loop
    execute format('drop function %s', f.signature);
  end loop;
end $$;

create function public.submit_match_result(
  p_team1_player1_id bigint,
  p_team1_player2_id bigint,
  p_team2_player1_id bigint,
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
  participant_ids bigint[] := array[p_team1_player1_id, p_team1_player2_id, p_team2_player1_id, p_team2_player2_id];
  set_record jsonb;
  first_score integer;
  second_score integer;
  team1_sets integer := 0;
  team2_sets integer := 0;
  team1_games integer := 0;
  team2_games integer := 0;
  saved public.matches%rowtype;
begin
  if auth.uid() is null then raise exception 'Prihlásenie je potrebné.'; end if;
  if p_team1_player1_id is null or p_team1_player2_id is null
    or p_team2_player1_id is null or p_team2_player2_id is null then
    raise exception 'Vyber všetkých štyroch hráčov.';
  end if;
  if (select count(distinct participant) from unnest(participant_ids) as participant) <> 4
    or (select count(*) from public.proffiles where id = any(participant_ids)) <> 4 then
    raise exception 'Vyber štyroch rôznych registrovaných hráčov.';
  end if;
  select id into current_profile_id from public.proffiles
    where lower(email) = lower(auth.jwt() ->> 'email') limit 1;
  if current_profile_id is null or not (current_profile_id = any(participant_ids)) then
    raise exception 'Výsledok môže zadať iba účastník zápasu.';
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
    player1_id, team1_player1_id, team1_player2_id,
    player2_id, team2_player1_id, team2_player2_id,
    winner_id, match_date, status, player1_sets_won, player2_sets_won,
    player1_games_won, player2_games_won, result_sets, arena_name, submitted_by
  ) values (
    p_team1_player1_id, p_team1_player1_id, p_team1_player2_id,
    p_team2_player1_id, p_team2_player1_id, p_team2_player2_id,
    case when team1_sets = 2 then p_team1_player1_id else p_team2_player1_id end,
    p_match_date, 'pending', team1_sets, team2_sets,
    team1_games, team2_games, p_sets, trim(p_arena_name), current_profile_id
  ) returning * into saved;

  -- The returned row includes changes made by BEFORE triggers. If a trigger
  -- rewrote any player slot, abort instead of saving wrong players.
  if saved.player1_id is distinct from p_team1_player1_id
    or saved.team1_player1_id is distinct from p_team1_player1_id
    or saved.team1_player2_id is distinct from p_team1_player2_id
    or saved.player2_id is distinct from p_team2_player1_id
    or saved.team2_player1_id is distinct from p_team2_player1_id
    or saved.team2_player2_id is distinct from p_team2_player2_id then
    raise exception 'Hráči zápasu boli pri ukladaní zmenení (skontroluj triggery na tabuľke matches).';
  end if;

  return saved.id::text;
end;
$$;

revoke all on function public.submit_match_result(bigint, bigint, bigint, bigint, timestamptz, text, jsonb) from public, anon;
grant execute on function public.submit_match_result(bigint, bigint, bigint, bigint, timestamptz, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
