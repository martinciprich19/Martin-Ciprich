-- Apply after 047 and the official match approval migrations (032 and 029 or later).
-- Four scans create an official live match. Finishing submits a pending result;
-- the existing respond_to_match_result workflow applies ELO after all four approvals.
begin;

alter table public.live_matches
  add column if not exists team_a_player1_id bigint references public.proffiles(id),
  add column if not exists team_a_player2_id bigint references public.proffiles(id),
  add column if not exists team_b_player1_id bigint references public.proffiles(id),
  add column if not exists team_b_player2_id bigint references public.proffiles(id),
  add column if not exists qr_created_by bigint references public.proffiles(id),
  add column if not exists qr_arena_name text,
  add column if not exists official_result_id text;

create unique index if not exists live_matches_official_result_unique
  on public.live_matches(official_result_id) where official_result_id is not null;

drop policy if exists "Anyone can read quick games" on public.live_matches;
create policy "Anyone can read quick games" on public.live_matches
  for select to anon, authenticated
  using (challenge_id is null and match_pin is null and not is_pin_activated and qr_created_by is null);
drop policy if exists "Anyone can create quick games" on public.live_matches;
create policy "Anyone can create quick games" on public.live_matches
  for insert to anon, authenticated
  with check (challenge_id is null and match_pin is null and not is_pin_activated and qr_created_by is null);
drop policy if exists "Anyone can update quick game scores" on public.live_matches;
create policy "Anyone can update quick game scores" on public.live_matches
  for update to anon, authenticated
  using (challenge_id is null and match_pin is null and not is_pin_activated and qr_created_by is null)
  with check (challenge_id is null and match_pin is null and not is_pin_activated and qr_created_by is null);

drop policy if exists "QR participants can read live matches" on public.live_matches;
create policy "QR participants can read live matches" on public.live_matches
  for select to authenticated using (
    qr_created_by is not null and exists (
      select 1 from public.proffiles p
      where lower(p.email) = lower(auth.jwt() ->> 'email')
        and p.id in (team_a_player1_id, team_a_player2_id, team_b_player1_id, team_b_player2_id)
    )
  );
drop policy if exists "QR organizer can score live matches" on public.live_matches;
create policy "QR organizer can score live matches" on public.live_matches
  for update to authenticated
  using (exists (
    select 1 from public.proffiles p
    where p.id = qr_created_by and lower(p.email) = lower(auth.jwt() ->> 'email')
  ))
  with check (exists (
    select 1 from public.proffiles p
    where p.id = qr_created_by and lower(p.email) = lower(auth.jwt() ->> 'email')
  ));

-- Metadata is assigned by the creation RPC only, not by scoreboard clients.
create or replace function public.guard_qr_live_match_metadata()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated') and (
      new.qr_created_by is not null or new.team_a_player1_id is not null
      or new.team_a_player2_id is not null or new.team_b_player1_id is not null
      or new.team_b_player2_id is not null or new.qr_arena_name is not null
      or new.official_result_id is not null
    ) then
      raise exception 'QR zapas vytvor cez create_qr_live_match.';
    end if;
  elsif new.qr_created_by is distinct from old.qr_created_by
    or new.team_a_player1_id is distinct from old.team_a_player1_id
    or new.team_a_player2_id is distinct from old.team_a_player2_id
    or new.team_b_player1_id is distinct from old.team_b_player1_id
    or new.team_b_player2_id is distinct from old.team_b_player2_id
    or new.qr_arena_name is distinct from old.qr_arena_name
    or new.official_result_id is distinct from old.official_result_id then
    raise exception 'Ucastnikov ani odoslany vysledok QR zapasu nie je mozne menit.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_qr_live_match_metadata() from public;
drop trigger if exists guard_qr_live_match_metadata on public.live_matches;
create trigger guard_qr_live_match_metadata before insert or update on public.live_matches
  for each row execute function public.guard_qr_live_match_metadata();

create or replace function public.create_qr_live_match(
  p_live_match_id uuid,
  p_team_a_player1_id bigint, p_team_a_player2_id bigint,
  p_team_b_player1_id bigint, p_team_b_player2_id bigint,
  p_arena_name text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  organizer bigint;
  ids bigint[] := array[p_team_a_player1_id, p_team_a_player2_id, p_team_b_player1_id, p_team_b_player2_id];
  existing public.live_matches%rowtype;
begin
  if auth.uid() is null then raise exception 'Prihlasenie je potrebne.'; end if;
  select id into organizer from public.proffiles
    where lower(email) = lower(auth.jwt() ->> 'email') limit 1;
  if organizer is null or not (organizer = any(ids)) then
    raise exception 'Prihlaseny organizator musi byt jednym zo styroch hracov.';
  end if;
  if array_position(ids, null) is not null
    or (select count(distinct id) from unnest(ids) id) <> 4
    or (select count(*) from public.proffiles where id = any(ids)) <> 4 then
    raise exception 'Naskenuj styroch roznych registrovanych hracov.';
  end if;
  if p_live_match_id is null or nullif(trim(p_arena_name), '') is null then
    raise exception 'Vypln arenu a platne ID zapasu.';
  end if;
  -- Serialize retries for the same client-generated match ID.
  perform pg_advisory_xact_lock(hashtext(p_live_match_id::text));
  select * into existing from public.live_matches where id = p_live_match_id;
  if found then
    if existing.qr_created_by = organizer
      and array[existing.team_a_player1_id, existing.team_a_player2_id,
                existing.team_b_player1_id, existing.team_b_player2_id] = ids
      and existing.qr_arena_name = trim(p_arena_name) then
      return existing.id;
    end if;
    raise exception 'ID zapasu uz bolo pouzite.';
  end if;

  insert into public.live_matches (
    id, team_a_player1_id, team_a_player2_id, team_b_player1_id, team_b_player2_id,
    team_a_player1_name, team_a_player2_name, team_b_player1_name, team_b_player2_name,
    qr_created_by, qr_arena_name, serving_team, initial_server_chosen
  )
  select p_live_match_id, a1.id, a2.id, b1.id, b2.id,
    coalesce(nullif(trim(a1.full_name), ''), 'Hrac ' || a1.id),
    coalesce(nullif(trim(a2.full_name), ''), 'Hrac ' || a2.id),
    coalesce(nullif(trim(b1.full_name), ''), 'Hrac ' || b1.id),
    coalesce(nullif(trim(b2.full_name), ''), 'Hrac ' || b2.id),
    organizer, trim(p_arena_name), null, false
  from public.proffiles a1, public.proffiles a2, public.proffiles b1, public.proffiles b2
  where a1.id = p_team_a_player1_id and a2.id = p_team_a_player2_id
    and b1.id = p_team_b_player1_id and b2.id = p_team_b_player2_id;
  return p_live_match_id;
end;
$$;
revoke all on function public.create_qr_live_match(uuid, bigint, bigint, bigint, bigint, text) from public, anon;
grant execute on function public.create_qr_live_match(uuid, bigint, bigint, bigint, bigint, text) to authenticated;

-- Submit in the same transaction as the final rally. A failed submission rolls back
-- that rally instead of showing a finished match whose result was silently lost.
create or replace function public.submit_finished_qr_live_match()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  set_score jsonb;
  a integer;
  b integer;
  a_sets integer := 0;
  b_sets integer := 0;
  a_games integer := 0;
  b_games integer := 0;
  result_sets jsonb := '[]'::jsonb;
  saved public.matches%rowtype;
begin
  if new.qr_created_by is null or new.official_result_id is not null
    or (new.team_a_sets < 2 and new.team_b_sets < 2) then return new; end if;
  if auth.uid() is null or not exists (
    select 1 from public.proffiles p where p.id = new.qr_created_by
      and lower(p.email) = lower(auth.jwt() ->> 'email')
  ) then raise exception 'Vysledok QR zapasu moze odoslat iba prihlaseny organizator.'; end if;
  if jsonb_array_length(new.completed_sets) not in (2, 3) then
    raise exception 'Zapas musi mat dva alebo tri sety.';
  end if;
  for set_score in select value from jsonb_array_elements(new.completed_sets) loop
    if a_sets = 2 or b_sets = 2 or jsonb_typeof(set_score) <> 'array'
      or jsonb_array_length(set_score) <> 2
      or coalesce(set_score ->> 0, '') !~ '^[0-9]+$'
      or coalesce(set_score ->> 1, '') !~ '^[0-9]+$' then
      raise exception 'Neplatne vysledky setov.';
    end if;
    a := (set_score ->> 0)::integer;
    b := (set_score ->> 1)::integer;
    if not ((greatest(a, b) = 6 and least(a, b) <= 4)
      or (greatest(a, b) >= 7 and abs(a - b) = 2)) then
      raise exception 'Set bez tajbrejku musi skoncit rozdielom dvoch gemov.';
    end if;
    a_sets := a_sets + case when a > b then 1 else 0 end;
    b_sets := b_sets + case when b > a then 1 else 0 end;
    a_games := a_games + a;
    b_games := b_games + b;
    result_sets := result_sets || jsonb_build_array(jsonb_build_object('team1Score', a, 'team2Score', b));
  end loop;
  if a_sets <> new.team_a_sets or b_sets <> new.team_b_sets
    or greatest(a_sets, b_sets) <> 2 or new.started_at is null or new.finished_at is null then
    raise exception 'Konecny vysledok alebo cas zapasu je neplatny.';
  end if;

  insert into public.matches (
    player1_id, team1_player1_id, team1_player2_id,
    player2_id, team2_player1_id, team2_player2_id,
    winner_id, match_date, status, player1_sets_won, player2_sets_won,
    player1_games_won, player2_games_won, result_sets, arena_name, submitted_by,
    approved_profile_ids
  ) values (
    new.team_a_player1_id, new.team_a_player1_id, new.team_a_player2_id,
    new.team_b_player1_id, new.team_b_player1_id, new.team_b_player2_id,
    case when a_sets = 2 then new.team_a_player1_id else new.team_b_player1_id end,
    new.started_at, 'pending', a_sets, b_sets, a_games, b_games,
    result_sets, new.qr_arena_name, new.qr_created_by, '{}'
  ) returning * into saved;
  if saved.player1_id is distinct from new.team_a_player1_id
    or saved.team1_player1_id is distinct from new.team_a_player1_id
    or saved.team1_player2_id is distinct from new.team_a_player2_id
    or saved.player2_id is distinct from new.team_b_player1_id
    or saved.team2_player1_id is distinct from new.team_b_player1_id
    or saved.team2_player2_id is distinct from new.team_b_player2_id then
    raise exception 'Ucastnici oficialneho vysledku boli pri ukladani zmeneni.';
  end if;
  new.official_result_id := saved.id::text;
  return new;
end;
$$;
revoke all on function public.submit_finished_qr_live_match() from public;
drop trigger if exists zz_submit_finished_qr_live_match on public.live_matches;
create trigger zz_submit_finished_qr_live_match before update on public.live_matches
  for each row execute function public.submit_finished_qr_live_match();

grant select (
  team_a_player1_id, team_a_player2_id, team_b_player1_id, team_b_player2_id,
  qr_created_by, qr_arena_name, official_result_id
) on public.live_matches to anon, authenticated;
notify pgrst, 'reload schema';
commit;
