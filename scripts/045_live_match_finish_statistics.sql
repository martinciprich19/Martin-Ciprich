-- Apply after 044_live_match_players_sets.sql. No official results / ELO writes.
begin;

alter table public.live_matches
  add column if not exists team_a_player1_points integer not null default 0 check (team_a_player1_points >= 0),
  add column if not exists team_a_player2_points integer not null default 0 check (team_a_player2_points >= 0),
  add column if not exists team_b_player1_points integer not null default 0 check (team_b_player1_points >= 0),
  add column if not exists team_b_player2_points integer not null default 0 check (team_b_player2_points >= 0),
  add column if not exists completed_sets jsonb not null default '[]'::jsonb check (jsonb_typeof(completed_sets) = 'array'),
  add column if not exists statistics_complete boolean not null default false;

-- Older rallies cannot be reconstructed. Only previously unstarted rows have full statistics.
update public.live_matches
set statistics_complete = true
where team_a_game_score = 0 and team_b_game_score = 0
  and team_a_games = 0 and team_b_games = 0
  and team_a_sets = 0 and team_b_sets = 0;

alter table public.live_matches alter column statistics_complete set default true;

create or replace function public.guard_finished_live_match()
returns trigger language plpgsql set search_path = public as $$
begin
  if (old.team_a_sets >= 2 or old.team_b_sets >= 2) and (
    new.team_a_game_score is distinct from old.team_a_game_score
    or new.team_b_game_score is distinct from old.team_b_game_score
    or new.team_a_games is distinct from old.team_a_games
    or new.team_b_games is distinct from old.team_b_games
    or new.team_a_sets is distinct from old.team_a_sets
    or new.team_b_sets is distinct from old.team_b_sets
    or new.team_a_player1_points is distinct from old.team_a_player1_points
    or new.team_a_player2_points is distinct from old.team_a_player2_points
    or new.team_b_player1_points is distinct from old.team_b_player1_points
    or new.team_b_player2_points is distinct from old.team_b_player2_points
    or new.completed_sets is distinct from old.completed_sets
    or new.serving_team is distinct from old.serving_team
    or new.serving_player is distinct from old.serving_player
  ) then
    raise exception 'Zapas je ukonceny. Skore ani statistiky uz nie je mozne menit.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_finished_live_match on public.live_matches;
create trigger guard_finished_live_match before update on public.live_matches
for each row execute function public.guard_finished_live_match();

grant select (
  team_a_player1_points, team_a_player2_points,
  team_b_player1_points, team_b_player2_points, completed_sets, statistics_complete
) on public.live_matches to anon, authenticated;
grant update (
  team_a_player1_points, team_a_player2_points,
  team_b_player1_points, team_b_player2_points, completed_sets
) on public.live_matches to anon, authenticated;

notify pgrst, 'reload schema';
commit;
