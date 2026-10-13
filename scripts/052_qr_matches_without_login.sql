-- Apply after 048, 050 and 051. QR scanning does not authenticate players:
-- all four must still approve the pending result in their own profiles.
begin;

alter table public.live_matches
  add column if not exists qr_device_token_hash text;

create or replace function public.has_qr_device_access(p_match_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.live_matches m
    where m.id = p_match_id and m.qr_device_token_hash is not null
      and m.qr_device_token_hash = encode(sha256(convert_to(
        coalesce(nullif(current_setting('request.headers', true), '')::jsonb
          ->> 'x-riva-qr-device', ''), 'UTF8')), 'hex')
  );
$$;
revoke all on function public.has_qr_device_access(uuid) from public;
grant execute on function public.has_qr_device_access(uuid) to anon, authenticated;

-- Public viewing matches the activated PIN scoreboard. Only the creating device
-- has the random write capability; knowing a match ID is not enough to score it.
drop policy if exists "Anyone can read device QR matches" on public.live_matches;
create policy "Anyone can read device QR matches" on public.live_matches
  for select to anon, authenticated using (qr_device_token_hash is not null);
drop policy if exists "QR device can score its match" on public.live_matches;
create policy "QR device can score its match" on public.live_matches
  for update to anon, authenticated
  using (public.has_qr_device_access(id))
  with check (public.has_qr_device_access(id));

create or replace function public.guard_qr_device_metadata()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated') and new.qr_device_token_hash is not null then
      raise exception 'QR zapas vytvor cez create_qr_device_match.';
    end if;
  elsif new.qr_device_token_hash is distinct from old.qr_device_token_hash then
    raise exception 'Kluc zariadenia QR zapasu nie je mozne menit.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_qr_device_metadata() from public;
drop trigger if exists guard_qr_device_metadata on public.live_matches;
create trigger guard_qr_device_metadata before insert or update on public.live_matches
  for each row execute function public.guard_qr_device_metadata();

create or replace function public.create_qr_device_match(
  p_live_match_id uuid,
  p_team_a_player1_id bigint, p_team_a_player2_id bigint,
  p_team_b_player1_id bigint, p_team_b_player2_id bigint,
  p_arena_name text, p_device_token text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  ids bigint[] := array[p_team_a_player1_id, p_team_a_player2_id, p_team_b_player1_id, p_team_b_player2_id];
  token_hash text;
  existing public.live_matches%rowtype;
begin
  if p_device_token is null or p_device_token !~ '^[a-f0-9]{64}$' then
    raise exception 'Neplatny kluc zariadenia.';
  end if;
  if p_live_match_id is null or nullif(trim(p_arena_name), '') is null
    or length(trim(p_arena_name)) > 200 then
    raise exception 'Vypln arenu (najviac 200 znakov) a platne ID zapasu.';
  end if;
  if array_position(ids, null) is not null
    or (select count(distinct id) from unnest(ids) id) <> 4
    or (select count(*) from public.proffiles where id = any(ids)) <> 4 then
    raise exception 'Naskenuj styroch roznych registrovanych hracov.';
  end if;
  token_hash := encode(sha256(convert_to(p_device_token, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtext(p_live_match_id::text));
  select * into existing from public.live_matches where id = p_live_match_id;
  if found then
    if existing.qr_device_token_hash = token_hash
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
    qr_created_by, qr_arena_name, qr_device_token_hash, serving_team, initial_server_chosen
  )
  select p_live_match_id, a1.id, a2.id, b1.id, b2.id,
    coalesce(nullif(trim(a1.full_name), ''), 'Hrac ' || a1.id),
    coalesce(nullif(trim(a2.full_name), ''), 'Hrac ' || a2.id),
    coalesce(nullif(trim(b1.full_name), ''), 'Hrac ' || b1.id),
    coalesce(nullif(trim(b2.full_name), ''), 'Hrac ' || b2.id),
    a1.id, trim(p_arena_name), token_hash, null, false
  from public.proffiles a1, public.proffiles a2, public.proffiles b1, public.proffiles b2
  where a1.id = p_team_a_player1_id and a2.id = p_team_a_player2_id
    and b1.id = p_team_b_player1_id and b2.id = p_team_b_player2_id;
  return p_live_match_id;
end;
$$;
revoke all on function public.create_qr_device_match(uuid, bigint, bigint, bigint, bigint, text, text) from public;
grant execute on function public.create_qr_device_match(uuid, bigint, bigint, bigint, bigint, text, text) to anon, authenticated;

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
  if not public.has_qr_device_access(new.id) and not (
    auth.uid() is not null and exists (
      select 1 from public.proffiles p where p.id = new.qr_created_by
        and lower(p.email) = lower(auth.jwt() ->> 'email')
    )
  ) then raise exception 'Vysledok moze odoslat iba zariadenie zapasu alebo prihlaseny organizator.'; end if;
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

create or replace function public.live_match_player_avatars(p_match_id uuid)
returns table(player_slot integer, avatar_url text)
language plpgsql security definer set search_path = public as $$
declare
  game public.live_matches%rowtype;
  roster bigint[];
begin
  select * into game from public.live_matches where id = p_match_id;
  if not found then raise exception 'Zapas sa nenasiel.'; end if;
  if game.qr_created_by is not null then
    roster := array[game.team_a_player1_id, game.team_a_player2_id,
      game.team_b_player1_id, game.team_b_player2_id];
    if game.qr_device_token_hash is null and (
      coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null or not exists (
        select 1 from public.proffiles p where p.id = any(roster)
          and lower(p.email) = lower(auth.jwt() ->> 'email')
      )
    ) then raise exception 'K zapasu nemas pristup.'; end if;
  elsif game.challenge_id is not null then
    select array[c.challenger_1_id, c.challenger_2_id, c.challenged_1_id, c.challenged_2_id]
      into roster from public.challenges c where c.id::text = game.challenge_id;
    if roster is null then raise exception 'Vyzva zapasu sa nenasla.'; end if;
    if not game.is_pin_activated and not exists (
      select 1 from public.proffiles p where p.id = any(roster)
        and auth.role() = 'authenticated'
        and auth.uid() is not null and lower(p.email) = lower(auth.jwt() ->> 'email')
    ) then raise exception 'K zapasu nemas pristup.'; end if;
  else
    return;
  end if;
  return query
    select (r.ordinality - 1)::integer, p.avatar_url
    from unnest(roster) with ordinality r(id, ordinality)
    left join public.proffiles p on p.id = r.id
    order by r.ordinality;
end;
$$;
revoke all on function public.live_match_player_avatars(uuid) from public;
grant execute on function public.live_match_player_avatars(uuid) to anon, authenticated;

-- Never grant SELECT on the hash: it is only inspected inside definer functions.
notify pgrst, 'reload schema';
commit;
