-- Apply after 098. Exposes only the pre-match team win probability for
-- registered matches; profile ELO values remain private.
begin;

create or replace function public.live_match_win_probability(p_match_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  game public.live_matches%rowtype;
  saved_result public.matches%rowtype;
  roster bigint[];
  profile_count integer;
  team1_elo numeric;
  team2_elo numeric;
  probability numeric;
begin
  select * into game
  from public.live_matches
  where id = p_match_id;

  if not found or (game.qr_created_by is null and game.challenge_id is null) then
    return null;
  end if;

  roster := array[
    game.team_a_player1_id, game.team_a_player2_id,
    game.team_b_player1_id, game.team_b_player2_id
  ];

  if array_position(roster, null) is not null and game.challenge_id is not null then
    select array[
      c.challenger_1_id, c.challenger_2_id, c.challenged_1_id, c.challenged_2_id
    ] into roster
    from public.challenges c
    where c.id::text = game.challenge_id;
  end if;

  if array_position(roster, null) is not null then
    return null;
  end if;

  if game.official_result_id is not null then
    select * into saved_result
    from public.matches
    where id::text = game.official_result_id;

    if found and saved_result.status = 'confirmed'
      and saved_result.elo_delta_team1 is not null
      and saved_result.winner_id is not null then
      probability := case
        when saved_result.winner_id = saved_result.player1_id then 1
        else 0
      end - saved_result.elo_delta_team1::numeric / 32;
      return least(0.99, greatest(0.01, probability));
    end if;
  end if;

  select count(*),
    avg(coalesce(p.elo_rating, 1000)) filter (where p.id = roster[1] or p.id = roster[2]),
    avg(coalesce(p.elo_rating, 1000)) filter (where p.id = roster[3] or p.id = roster[4])
  into profile_count, team1_elo, team2_elo
  from public.proffiles p
  where p.id = any(roster);

  if profile_count <> 4 then
    return null;
  end if;

  probability := 1 / (1 + power(10::numeric, (team2_elo - team1_elo) / 400));
  return least(0.99, greatest(0.01, probability));
end;
$$;

revoke all on function public.live_match_win_probability(uuid) from public;
grant execute on function public.live_match_win_probability(uuid) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
