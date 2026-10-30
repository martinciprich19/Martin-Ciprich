-- Apply the entire file in the Supabase SQL Editor after migrations 071 and 057.
-- Kiosks can activate a match for a selected court. Public scoreboards are read-only.
begin;

do $$
begin
  if to_regclass('public.arena_courts') is null
    or to_regclass('public.live_matches') is null
    or to_regclass('public.challenges') is null then
    raise exception 'Missing arena court or live match tables. Apply migrations 004, 048, 057, 060 and 071 first.';
  end if;
  if to_regprocedure('public.activate_live_match_pin_with_settings(text,text,text,text)') is null then
    raise exception 'Missing public.activate_live_match_pin_with_settings(text,text,text,text). Apply migration 057 first.';
  end if;
end;
$$;

alter table public.live_matches
  add column if not exists court_id bigint
    references public.arena_courts(id) on delete set null;

create index if not exists live_matches_court_active_idx
  on public.live_matches (court_id, started_at desc)
  where court_id is not null and finished_at is null and ended_early_at is null;

create or replace function public.activate_live_match_pin_for_court(
  p_match_pin text,
  p_scoring_type text,
  p_set_format text,
  p_third_set_format text,
  p_court_id bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  activated_id uuid;
  selected_arena_id bigint;
  selected_country text;
  challenge_arena_id text;
begin
  if p_court_id is null then
    raise exception 'Vyber kurt pre tento kiosk.';
  end if;

  select court.arena_id, arena.country_code
    into selected_arena_id, selected_country
  from public.arena_courts court
  join public.arenas arena on arena.id = court.arena_id
  where court.id = p_court_id
    and court.is_active
    and arena.is_active;

  if not found then
    raise exception 'Kurt nie je dostupný. Kontaktuj správcu arény.';
  end if;

  activated_id := public.activate_live_match_pin_with_settings(
    p_match_pin, p_scoring_type, p_set_format, p_third_set_format
  );

  select challenge.arena_id::text into challenge_arena_id
  from public.live_matches game
  left join public.challenges challenge on challenge.id::text = game.challenge_id
  where game.id = activated_id
    and game.country_code = selected_country;

  if not found then
    raise exception 'Zápas nepatrí do krajiny vybraného kurtu.';
  end if;

  if challenge_arena_id is not null and challenge_arena_id <> selected_arena_id::text then
    raise exception 'Výzva bola vytvorená pre inú arénu.';
  end if;

  update public.live_matches
  set court_id = p_court_id
  where id = activated_id;

  return activated_id;
end;
$$;

revoke all on function public.activate_live_match_pin_for_court(text, text, text, text, bigint) from public;
grant execute on function public.activate_live_match_pin_for_court(text, text, text, text, bigint) to anon, authenticated;

drop function if exists public.get_court_scoreboard(bigint);
create or replace function public.get_court_scoreboard(p_court_id bigint)
returns table (
  court_id bigint,
  court_name text,
  match_id uuid,
  team_a_player1_name text,
  team_a_player2_name text,
  team_b_player1_name text,
  team_b_player2_name text,
  team_a_game_score smallint,
  team_b_game_score smallint,
  advantage_team text,
  tiebreak_score jsonb,
  team_a_games integer,
  team_b_games integer,
  team_a_sets integer,
  team_b_sets integer,
  started_at timestamptz,
  paused_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    court.id,
    court.name,
    game.id,
    game.team_a_player1_name,
    game.team_a_player2_name,
    game.team_b_player1_name,
    game.team_b_player2_name,
    game.team_a_game_score,
    game.team_b_game_score,
    game.advantage_team,
    game.tiebreak_score,
    game.team_a_games,
    game.team_b_games,
    game.team_a_sets,
    game.team_b_sets,
    game.started_at,
    game.paused_at
  from public.arena_courts court
  join public.arenas arena on arena.id = court.arena_id and arena.is_active
  left join lateral (
    select live.*
    from public.live_matches live
    where live.court_id = court.id
      and live.started_at is not null
      and live.initial_server_chosen
      and live.finished_at is null
      and live.ended_early_at is null
      and (live.challenge_id is null or live.is_pin_activated)
    order by live.started_at desc
    limit 1
  ) game on true
  where court.id = p_court_id
    and court.is_active;
$$;

revoke all on function public.get_court_scoreboard(bigint) from public;
grant execute on function public.get_court_scoreboard(bigint) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
