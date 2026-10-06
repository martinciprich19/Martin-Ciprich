-- 032: Create public.submit_match_result (self-contained, safe to re-run).
--
-- Fixes: "Could not find the function public.submit_match_result(...) in the schema cache".
-- Adds every column the function and the confirmation RPC need, then creates the
-- function with exactly the parameters the frontend sends.
--
-- Column semantics:
--   player1_id       = team1_player1_id = team 1, player 1
--   team1_player2_id                    = team 1, player 2
--   player2_id       = team2_player1_id = team 2, player 1
--   team2_player2_id                    = team 2, player 2

begin;

alter table public.matches
  add column if not exists player1_id bigint references public.proffiles(id),
  add column if not exists player2_id bigint references public.proffiles(id),
  add column if not exists team1_player1_id bigint references public.proffiles(id),
  add column if not exists team1_player2_id bigint references public.proffiles(id),
  add column if not exists team2_player1_id bigint references public.proffiles(id),
  add column if not exists team2_player2_id bigint references public.proffiles(id),
  add column if not exists winner_id bigint references public.proffiles(id),
  add column if not exists match_date timestamptz,
  add column if not exists status text not null default 'pending',
  add column if not exists player1_sets_won integer,
  add column if not exists player2_sets_won integer,
  add column if not exists player1_games_won integer,
  add column if not exists player2_games_won integer,
  add column if not exists result_sets jsonb,
  add column if not exists arena_name text,
  add column if not exists submitted_by bigint references public.proffiles(id),
  add column if not exists approved_profile_ids bigint[] not null default '{}',
  add column if not exists rejected_by bigint references public.proffiles(id),
  add column if not exists elo_applied boolean not null default false,
  add column if not exists elo_delta_team1 integer,
  add column if not exists elo_delta_team2 integer;

-- Make sure the status check (if any) allows the workflow statuses.
do $$
declare c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
    where con.conrelid = 'public.matches'::regclass and con.contype = 'c' and att.attname = 'status'
  loop
    execute format('alter table public.matches drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.matches add constraint matches_result_status_check
  check (status in ('pending', 'confirmed', 'approved', 'rejected', 'disputed', 'cancelled', 'declined')) not valid;

-- Remove every existing overload so PostgREST resolves exactly one function.
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
  p_arena_name text,
  p_match_date timestamptz,
  p_sets jsonb,
  p_team1_player1_id bigint,
  p_team1_player2_id bigint,
  p_team2_player1_id bigint,
  p_team2_player2_id bigint
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
    player1_games_won, player2_games_won, result_sets, arena_name, submitted_by,
    approved_profile_ids
  ) values (
    p_team1_player1_id, p_team1_player1_id, p_team1_player2_id,
    p_team2_player1_id, p_team2_player1_id, p_team2_player2_id,
    case when team1_sets = 2 then p_team1_player1_id else p_team2_player1_id end,
    p_match_date, 'pending', team1_sets, team2_sets,
    team1_games, team2_games, p_sets, trim(p_arena_name), current_profile_id,
    '{}'
  ) returning * into saved;

  -- Abort if any trigger rewrote a player slot, instead of saving wrong players.
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

revoke all on function public.submit_match_result(text, timestamptz, jsonb, bigint, bigint, bigint, bigint) from public, anon;
grant execute on function public.submit_match_result(text, timestamptz, jsonb, bigint, bigint, bigint, bigint) to authenticated;

commit;

-- Refresh the PostgREST schema cache so the API sees the new function immediately.
notify pgrst, 'reload schema';
