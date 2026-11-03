-- Apply after 066_repair_activity_notifications.sql and 077_live_match_finalization.sql.
-- Match pause PINs are intentionally included in both in-app and push notifications.
begin;

alter table public.notifications
  add column if not exists title text,
  add column if not exists body text,
  add column if not exists match_id text,
  add column if not exists source_activity_key text;

create unique index if not exists notifications_source_activity_recipient_unique
  on public.notifications(user_id, source_activity_key) where source_activity_key is not null;

create or replace function public.notify_finished_match_participants()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  team_one bigint[] := array_remove(array[new.player1_id, new.team1_player2_id], null);
  team_two bigint[] := array_remove(array[new.player2_id, new.team2_player2_id], null);
  winning_team smallint;
  participant bigint;
  participant_won boolean;
  notification_title text;
  notification_message text;
begin
  if new.status not in ('pending', 'confirmed', 'approved') then return new; end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;

  if new.winner_id = any(team_one) then
    winning_team := 1;
  elsif new.winner_id = any(team_two) then
    winning_team := 2;
  elsif new.player1_sets_won > new.player2_sets_won then
    winning_team := 1;
  elsif new.player2_sets_won > new.player1_sets_won then
    winning_team := 2;
  end if;

  for participant in
    select distinct player_id
    from unnest(array[new.player1_id, new.team1_player2_id,
      new.player2_id, new.team2_player2_id]) as players(player_id)
    where player_id is not null
  loop
    participant_won := case
      when winning_team = 1 then participant = any(team_one)
      when winning_team = 2 then participant = any(team_two)
      else null
    end;
    notification_title := case
      when participant_won then 'Výhra v zápase'
      when participant_won is false then 'Prehra v zápase'
      else 'Zápas sa skončil'
    end;
    notification_message := 'Zápas sa skončil ' || new.player1_sets_won || ':' ||
      new.player2_sets_won || case
        when participant_won then ' – tvoj tím vyhral.'
        when participant_won is false then ' – tvoj tím prehral.'
        else '.'
      end;

    insert into public.notifications(
      user_id, type, title, body, message, is_read, match_id, source_activity_key
    ) values (
      participant, 'match_finished', notification_title, notification_message,
      notification_message, false, new.id::text, 'match_finished:' || new.id::text
    ) on conflict (user_id, source_activity_key)
      where source_activity_key is not null do nothing;
  end loop;
  return new;
end;
$$;
revoke all on function public.notify_finished_match_participants() from public, anon, authenticated;

drop trigger if exists notify_finished_match_participants on public.matches;
create trigger notify_finished_match_participants
  after insert or update of status on public.matches
  for each row execute function public.notify_finished_match_participants();

create or replace function public.notify_paused_live_match_participants()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pause public.live_match_pauses%rowtype;
  participant_id bigint;
  notification_message text;
begin
  if old.paused_at is not null or new.paused_at is null then return new; end if;
  if new.resume_pin is null or new.resume_pin !~ '^[0-9]{4}$' then
    raise exception 'Preruseny zapas nema platny PIN na pokracovanie.';
  end if;

  select * into pause
  from public.live_match_pauses
  where match_id = new.id and pin = new.resume_pin and resumed_at is null
  order by created_at desc
  limit 1;
  if not found then raise exception 'PIN preruseneho zapasu sa nenasiel.'; end if;

  notification_message := 'Zápas bol prerušený. PIN na opätovné prihlásenie: ' ||
    pause.pin || '. Zadaj ho v aplikácii RIVA Padel na obnovenie zápasu.';

  for participant_id in
    select distinct player.id
    from public.proffiles player
    where player.id = any(array[
      new.team_a_player1_id, new.team_a_player2_id,
      new.team_b_player1_id, new.team_b_player2_id
    ])
    or (
      new.challenge_id is not null
      and exists (
        select 1 from public.challenges challenge
        where challenge.id::text = new.challenge_id
          and player.id in (
            challenge.challenger_1_id, challenge.challenger_2_id,
            challenge.challenged_1_id, challenge.challenged_2_id
          )
      )
    )
  loop
    insert into public.notifications(
      user_id, type, title, body, message, is_read, source_activity_key
    ) values (
      participant_id, 'match_paused', 'Zápas prerušený',
      notification_message, notification_message, false,
      'live_match_pause:' || pause.id::text
    ) on conflict (user_id, source_activity_key)
      where source_activity_key is not null do nothing;
  end loop;

  return new;
end;
$$;
revoke all on function public.notify_paused_live_match_participants() from public, anon, authenticated;

drop trigger if exists notify_paused_live_match_participants on public.live_matches;
create trigger notify_paused_live_match_participants
  after update of paused_at on public.live_matches
  for each row when (old.paused_at is null and new.paused_at is not null)
  execute function public.notify_paused_live_match_participants();

notify pgrst, 'reload schema';
commit;
