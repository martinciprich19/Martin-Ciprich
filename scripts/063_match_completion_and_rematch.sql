-- Apply after 062. Run the entire file in the Supabase SQL Editor.
begin;

alter table public.notifications add column if not exists match_id text;
create unique index if not exists notifications_match_result_recipient
  on public.notifications(user_id, match_id) where type = 'match_result' and match_id is not null;

create or replace function public.notify_match_result_participants()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' then
    insert into public.notifications(user_id, type, message, is_read, match_id)
      select distinct participant,
        'match_result',
        'Zapas bol odohrany. Potvrd vysledok ' || new.player1_sets_won || ':' ||
          new.player2_sets_won || ' v profile v casti Vysledky. ELO sa zapocita az po potvrdeni vsetkymi hracmi.',
        false, new.id::text
      from unnest(array[new.player1_id, new.team1_player2_id,
        new.player2_id, new.team2_player2_id]) participant
      where participant is not null
      on conflict (user_id, match_id) where type = 'match_result' and match_id is not null do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_match_result_participants() from public;
drop trigger if exists notify_match_result_participants on public.matches;
create trigger notify_match_result_participants after insert or update of status on public.matches
  for each row execute function public.notify_match_result_participants();

-- QR and activated challenge matches submit immediately on the winning point.
-- The result and all four notifications are committed together, not on exit.
create or replace function public.submit_finished_qr_live_match()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  set_score jsonb;
  set_index integer := 0;
  a integer;
  b integer;
  a_sets integer := 0;
  b_sets integer := 0;
  a_games integer := 0;
  b_games integer := 0;
  result_sets jsonb := '[]'::jsonb;
  saved public.matches%rowtype;
  challenge public.challenges%rowtype;
  deciding_super_tiebreak boolean;
  pro_set boolean;
begin
  pro_set := new.set_format = 'pro_set';
  if (new.qr_created_by is null and new.challenge_id is null)
    or new.official_result_id is not null or new.ended_early_at is not null
    or (pro_set and new.team_a_sets < 1 and new.team_b_sets < 1)
    or (not pro_set and new.team_a_sets < 2 and new.team_b_sets < 2) then
    return new;
  end if;
  if not public.can_manage_live_match(new.id) then
    raise exception 'Vysledok moze odoslat iba zariadenie zapasu alebo prihlaseny organizator.';
  end if;
  if new.challenge_id is not null then
    select * into challenge from public.challenges where id::text = new.challenge_id;
    if not found or challenge.status <> 'accepted' or not new.is_pin_activated then
      raise exception 'Vyzva nie je aktivovana na odohranie zapasu.';
    end if;
    new.team_a_player1_id := challenge.challenger_1_id;
    new.team_a_player2_id := challenge.challenger_2_id;
    new.team_b_player1_id := challenge.challenged_1_id;
    new.team_b_player2_id := challenge.challenged_2_id;
  end if;
  if (select count(distinct id) from unnest(array[new.team_a_player1_id, new.team_a_player2_id,
    new.team_b_player1_id, new.team_b_player2_id]) id where id is not null) <> 4 then
    raise exception 'Vysledok musi mat styroch roznych registrovanych hracov.';
  end if;
  if jsonb_typeof(new.completed_sets) <> 'array'
    or (pro_set and jsonb_array_length(new.completed_sets) <> 1)
    or (not pro_set and jsonb_array_length(new.completed_sets) not in (2, 3)) then
    raise exception 'Pocet ukoncenych setov nesuhlasi s formatom zapasu.';
  end if;
  for set_score in select value from jsonb_array_elements(new.completed_sets) loop
    set_index := set_index + 1;
    if a_sets >= (case when pro_set then 1 else 2 end)
      or b_sets >= (case when pro_set then 1 else 2 end)
      or jsonb_typeof(set_score) <> 'array' or jsonb_array_length(set_score) <> 2
      or coalesce(set_score ->> 0, '') !~ '^[0-9]+$'
      or coalesce(set_score ->> 1, '') !~ '^[0-9]+$' then
      raise exception 'Neplatne vysledky setov.';
    end if;
    a := (set_score ->> 0)::integer;
    b := (set_score ->> 1)::integer;
    deciding_super_tiebreak := not pro_set and set_index = 3
      and new.third_set_format = 'super_tiebreak' and a_sets = 1 and b_sets = 1;
    if deciding_super_tiebreak then
      if greatest(a, b) < 10 or abs(a - b) < 2 then
        raise exception 'Super tajbrejk musi skoncit najmenej 10 bodmi a rozdielom dvoch.';
      end if;
    elsif pro_set then
      if not ((greatest(a, b) = 8 and least(a, b) <= 6)
        or (greatest(a, b) = 9 and least(a, b) in (7, 8))) then
        raise exception 'Neplatny vysledok Pro-Setu.';
      end if;
    elsif new.set_format = 'seven_games_no_tiebreak' then
      if greatest(a, b) <> 7 or least(a, b) > 6 then
        raise exception 'Set bez tajbrejku musi skoncit vysledkom 7:0 az 7:6.';
      end if;
    elsif not ((greatest(a, b) = 6 and least(a, b) <= 4)
      or (greatest(a, b) = 7 and least(a, b) in (5, 6))) then
      raise exception 'Neplatny vysledok klasickeho setu.';
    end if;
    a_sets := a_sets + case when a > b then 1 else 0 end;
    b_sets := b_sets + case when b > a then 1 else 0 end;
    if not deciding_super_tiebreak then
      a_games := a_games + a;
      b_games := b_games + b;
    end if;
    result_sets := result_sets || jsonb_build_array(jsonb_build_object('team1Score', a, 'team2Score', b));
  end loop;
  if a_sets <> new.team_a_sets or b_sets <> new.team_b_sets
    or greatest(a_sets, b_sets) <> (case when pro_set then 1 else 2 end)
    or new.started_at is null or new.finished_at is null then
    raise exception 'Konecny vysledok alebo cas zapasu je neplatny.';
  end if;
  insert into public.matches (
    player1_id, team1_player1_id, team1_player2_id,
    player2_id, team2_player1_id, team2_player2_id,
    winner_id, match_date, status, player1_sets_won, player2_sets_won,
    player1_games_won, player2_games_won, result_sets, arena_name, submitted_by, approved_profile_ids
  ) values (
    new.team_a_player1_id, new.team_a_player1_id, new.team_a_player2_id,
    new.team_b_player1_id, new.team_b_player1_id, new.team_b_player2_id,
    case when a_sets > b_sets then new.team_a_player1_id else new.team_b_player1_id end,
    new.started_at, 'pending', a_sets, b_sets, a_games, b_games,
    result_sets, new.qr_arena_name, coalesce(new.qr_created_by, new.team_a_player1_id), '{}'
  ) returning * into saved;
  if array[saved.player1_id, saved.team1_player2_id, saved.player2_id, saved.team2_player2_id]
    is distinct from array[new.team_a_player1_id, new.team_a_player2_id, new.team_b_player1_id, new.team_b_player2_id]
    or saved.team1_player1_id is distinct from new.team_a_player1_id
    or saved.team2_player1_id is distinct from new.team_b_player1_id then
    raise exception 'Ucastnici oficialneho vysledku boli pri ukladani zmeneni.';
  end if;
  new.official_result_id := saved.id::text;
  return new;
end;
$$;
revoke all on function public.submit_finished_qr_live_match() from public;

create table if not exists public.live_match_rematches (
  previous_match_id uuid primary key references public.live_matches(id) on delete cascade,
  next_match_id uuid not null unique references public.live_matches(id) on delete cascade,
  device_token_hash text not null
);
alter table public.live_match_rematches enable row level security;
revoke all on public.live_match_rematches from public, anon, authenticated;

create or replace function public.create_live_match_rematch(
  p_previous_match_id uuid, p_next_match_id uuid, p_device_token text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  game public.live_matches%rowtype;
  replay public.live_match_rematches%rowtype;
  token_hash text;
begin
  if p_next_match_id is null or p_device_token is null or p_device_token !~ '^[a-f0-9]{64}$' then
    raise exception 'Neplatny kluc alebo ID noveho zapasu.';
  end if;
  select * into game from public.live_matches where id = p_previous_match_id for update;
  if not found then raise exception 'Predchadzajuci zapas sa nenasiel.'; end if;
  if not public.can_manage_live_match(game.id) then
    raise exception 'Nemas opravnenie vytvorit dalsi zapas.';
  end if;
  if game.ended_early_at is not null or game.finished_at is null
    or not ((game.set_format = 'pro_set' and greatest(game.team_a_sets, game.team_b_sets) >= 1)
      or greatest(game.team_a_sets, game.team_b_sets) >= 2) then
    raise exception 'Najprv riadne dohraj predchadzajuci zapas.';
  end if;
  if (game.qr_created_by is not null or game.challenge_id is not null) and not exists (
    select 1 from public.matches m where m.id::text = game.official_result_id
      and (m.status in ('confirmed', 'approved') or not exists (
        select 1 from unnest(array[game.team_a_player1_id, game.team_a_player2_id,
          game.team_b_player1_id, game.team_b_player2_id]) participant
        where participant is null or (
          not (participant::text = any(coalesce(m.approved_profile_ids::text[], '{}'::text[]))) and not exists (
            select 1 from public.notifications n where n.match_id = game.official_result_id
              and n.type = 'match_result' and n.user_id::text = participant::text
          )
        )
      ))
  ) then raise exception 'Vysledok a notifikacie pre vsetkych hracov este nie su ulozene.'; end if;
  token_hash := encode(sha256(convert_to(p_device_token, 'UTF8')), 'hex');
  select * into replay from public.live_match_rematches where previous_match_id = game.id;
  if found then
    if replay.next_match_id = p_next_match_id and replay.device_token_hash = token_hash then
      return replay.next_match_id;
    end if;
    raise exception 'Dalsi zapas uz bol vytvoreny na inom zariadeni alebo v inej karte.';
  end if;
  if exists (select 1 from public.live_matches where id = p_next_match_id) then
    raise exception 'ID noveho zapasu uz bolo pouzite.';
  end if;
  if game.qr_created_by is not null or game.challenge_id is not null then
    perform public.create_qr_device_match(p_next_match_id,
      game.team_a_player1_id, game.team_a_player2_id,
      game.team_b_player1_id, game.team_b_player2_id,
      coalesce(nullif(game.qr_arena_name, ''), 'Zapas z vyzvy'), p_device_token);
    update public.live_matches set scoring_type = game.scoring_type,
      set_format = game.set_format, third_set_format = game.third_set_format
      where id = p_next_match_id;
  else
    insert into public.live_matches(id, team_a_player1_name, team_a_player2_name,
      team_b_player1_name, team_b_player2_name, scoring_type, set_format, third_set_format,
      serving_team, initial_server_chosen)
    values (p_next_match_id, game.team_a_player1_name, game.team_a_player2_name,
      game.team_b_player1_name, game.team_b_player2_name, game.scoring_type, game.set_format,
      game.third_set_format, null, false);
  end if;
  insert into public.live_match_rematches values (game.id, p_next_match_id, token_hash);
  return p_next_match_id;
end;
$$;
revoke all on function public.create_live_match_rematch(uuid, uuid, text) from public;
grant execute on function public.create_live_match_rematch(uuid, uuid, text) to anon, authenticated;

-- Pending results created before this migration also need an approval reminder.
insert into public.notifications(user_id, type, message, is_read, match_id)
  select distinct participant, 'match_result',
    'Potvrd vysledok odohraneho zapasu v profile v casti Vysledky.', false, m.id::text
  from public.matches m cross join lateral unnest(array[m.player1_id, m.team1_player2_id,
    m.player2_id, m.team2_player2_id]) participant
  where m.status = 'pending' and participant is not null
    and not (participant::text = any(coalesce(m.approved_profile_ids::text[], '{}'::text[])))
  on conflict (user_id, match_id) where type = 'match_result' and match_id is not null do nothing;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
notify pgrst, 'reload schema';
commit;
