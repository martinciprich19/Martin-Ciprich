-- Apply after 097. Authorized arena admins and Super Admins can finalize QR
-- results on shared devices without changing player membership or match scoring.
begin;

create or replace function public.can_manage_live_match(p_match_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.live_matches game where game.id = p_match_id and (
      public.has_qr_device_access(game.id)
      or (game.qr_created_by is null and game.challenge_id is null)
      or (game.challenge_id is not null and game.is_pin_activated
        and exists (select 1 from public.challenges c
          where c.id::text = game.challenge_id and c.status = 'accepted'))
      or (auth.uid() is not null and exists (
        select 1 from public.proffiles p where p.id = game.qr_created_by
          and lower(p.email) = lower(auth.jwt() ->> 'email')
      ))
      or (game.qr_created_by is not null and public.is_super_admin())
      or (game.qr_created_by is not null and auth.uid() is not null and exists (
        select 1
        from public.arena_admins manager
        left join public.arena_courts court
          on court.id = game.court_id and court.arena_id = manager.arena_id
        left join public.arenas arena
          on arena.id = manager.arena_id
          and lower(trim(arena.name)) = lower(trim(game.qr_arena_name))
        where manager.user_id = auth.uid()
          and (court.id is not null or arena.id is not null)
      ))
    )
  );
$$;
revoke all on function public.can_manage_live_match(uuid) from public;
grant execute on function public.can_manage_live_match(uuid) to anon, authenticated;

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
  if not public.can_manage_live_match(new.id) then
    raise exception 'Vysledok moze odoslat iba zariadenie zapasu alebo opravneny spravca areny.';
  end if;
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
    approved_profile_ids, qr_live_match_id
  ) values (
    new.team_a_player1_id, new.team_a_player1_id, new.team_a_player2_id,
    new.team_b_player1_id, new.team_b_player1_id, new.team_b_player2_id,
    case when a_sets = 2 then new.team_a_player1_id else new.team_b_player1_id end,
    new.started_at, 'pending', a_sets, b_sets, a_games, b_games,
    result_sets, new.qr_arena_name, new.qr_created_by, '{}', new.id
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
