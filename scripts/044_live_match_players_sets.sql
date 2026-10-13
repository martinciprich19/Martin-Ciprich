-- Run after the live_matches / kiosk setup in Supabase SQL Editor.
begin;

alter table public.live_matches
  add column if not exists team_a_player2_name text not null default 'Hráč 2',
  add column if not exists team_b_player2_name text not null default 'Hráč 2',
  add column if not exists serving_player smallint not null default 1 check (serving_player in (1, 2)),
  add column if not exists team_a_games integer not null default 0 check (team_a_games >= 0),
  add column if not exists team_b_games integer not null default 0 check (team_b_games >= 0),
  add column if not exists team_a_sets integer not null default 0 check (team_a_sets >= 0),
  add column if not exists team_b_sets integer not null default 0 check (team_b_sets >= 0);

-- Earlier challenge RPCs store both names together. Resolve them from profiles,
-- never by splitting a display name that could itself contain an ampersand.
create or replace function public.set_live_match_player_names()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.challenge_id is not null then
    select
      coalesce(nullif(trim(a1.full_name), ''), 'Hráč 1'),
      coalesce(nullif(trim(a2.full_name), ''), 'Hráč 2'),
      coalesce(nullif(trim(b1.full_name), ''), 'Hráč 1'),
      coalesce(nullif(trim(b2.full_name), ''), 'Hráč 2')
    into new.team_a_player1_name, new.team_a_player2_name,
      new.team_b_player1_name, new.team_b_player2_name
    from public.challenges c
    join public.proffiles a1 on a1.id = c.challenger_1_id
    join public.proffiles a2 on a2.id = c.challenger_2_id
    join public.proffiles b1 on b1.id = c.challenged_1_id
    join public.proffiles b2 on b2.id = c.challenged_2_id
    where c.id::text = new.challenge_id;
    if not found then
      raise exception 'Players for live challenge % were not found.', new.challenge_id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.set_live_match_player_names() from public;
drop trigger if exists live_match_player_names on public.live_matches;
create trigger live_match_player_names
  before insert or update of challenge_id on public.live_matches
  for each row execute function public.set_live_match_player_names();

update public.live_matches set challenge_id = challenge_id
where challenge_id is not null;

grant select (
  team_a_player2_name, team_b_player2_name, serving_player,
  team_a_games, team_b_games, team_a_sets, team_b_sets
) on public.live_matches to anon, authenticated;

grant update (
  serving_player, team_a_games, team_b_games, team_a_sets, team_b_sets
) on public.live_matches to anon, authenticated;

notify pgrst, 'reload schema';
commit;
