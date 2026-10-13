-- Apply after 055. A tiebreak is always active at 6:6.
begin;

do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'live_matches'
      and column_name = 'tiebreak_score') then
    alter table public.live_matches add column tiebreak_score jsonb;
    -- Convert the visible legacy fifteens once; never invent earlier deuce rallies.
    with points as (
      select id,
        case team_a_game_score when 15 then 1 when 30 then 2 when 40 then 3 else 0 end
          + case when advantage_team = 'TEAM_A' then 1 else 0 end as a,
        case team_b_game_score when 15 then 1 when 30 then 2 when 40 then 3 else 0 end
          + case when advantage_team = 'TEAM_B' then 1 else 0 end as b,
        (serving_player - 1) * 2 + case when serving_team = 'TEAM_B' then 1 else 0 end as server_index
      from public.live_matches where team_a_games = 6 and team_b_games = 6
        and team_a_sets < 2 and team_b_sets < 2
    ), seeded as (
      select *, (server_index - (((a + b + 1) / 2) % 4) + 4) % 4 as first_index
      from points
    )
    update public.live_matches m set
      tiebreak_score = case when m.serving_team is not null then jsonb_build_object(
        'a', p.a, 'b', p.b,
        'first_team', case when p.first_index % 2 = 0 then 'TEAM_A' else 'TEAM_B' end,
        'first_player', p.first_index / 2 + 1
      ) else null end,
      statistics_complete = case when m.team_a_game_score + m.team_b_game_score > 0
        then false else m.statistics_complete end,
      team_a_game_score = 0, team_b_game_score = 0, advantage_team = null
    from seeded p where m.id = p.id;
  end if;
end;
$$;

alter table public.live_matches add column if not exists is_tiebreak boolean
  generated always as (team_a_games = 6 and team_b_games = 6) stored;
alter table public.live_matches drop constraint if exists live_tiebreak_no_fifteens;
alter table public.live_matches add constraint live_tiebreak_no_fifteens check (
  not is_tiebreak or (team_a_game_score = 0 and team_b_game_score = 0 and advantage_team is null)
);
alter table public.live_matches drop constraint if exists live_tiebreak_shape;
alter table public.live_matches add constraint live_tiebreak_shape check (
  tiebreak_score is null or (
    is_tiebreak and team_a_sets < 2 and team_b_sets < 2
    and team_a_game_score = 0 and team_b_game_score = 0 and advantage_team is null
    and jsonb_typeof(tiebreak_score) = 'object'
    and tiebreak_score ?& array['a','b','first_team','first_player']
    and tiebreak_score - array['a','b','first_team','first_player'] = '{}'::jsonb
    and jsonb_typeof(tiebreak_score -> 'a') = 'number'
    and jsonb_typeof(tiebreak_score -> 'b') = 'number'
    and jsonb_typeof(tiebreak_score -> 'first_team') = 'string'
    and jsonb_typeof(tiebreak_score -> 'first_player') = 'number'
    and tiebreak_score ->> 'a' ~ '^[0-9]+$'
    and tiebreak_score ->> 'b' ~ '^[0-9]+$'
    and tiebreak_score ->> 'first_team' in ('TEAM_A','TEAM_B')
    and tiebreak_score ->> 'first_player' in ('1','2')
    and pg_column_size(tiebreak_score) <= 1024
  )
);
grant select (is_tiebreak, tiebreak_score), insert (tiebreak_score),
  update (tiebreak_score) on public.live_matches to anon, authenticated;

create or replace function public.guard_finished_tiebreak()
returns trigger language plpgsql set search_path = public as $$
begin
  if (old.team_a_sets >= 2 or old.team_b_sets >= 2)
    and new.tiebreak_score is distinct from old.tiebreak_score then
    raise exception 'Zapas je ukonceny. Tajbrejk uz nie je mozne menit.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_finished_tiebreak() from public;
drop trigger if exists guard_finished_tiebreak on public.live_matches;
create trigger guard_finished_tiebreak before update on public.live_matches
  for each row execute function public.guard_finished_tiebreak();

-- Preserve existing authorization and atomic official-result submission.
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
      or (greatest(a, b) = 7 and least(a, b) = 6)
      or (greatest(a, b) >= 7 and abs(a - b) = 2)) then
      raise exception 'Neplatny set. Pri 6:6 rozhoduje tajbrejk a set konci 7:6.';
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
notify pgrst, 'reload schema';
commit;
