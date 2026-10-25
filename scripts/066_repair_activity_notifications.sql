-- Run the entire file in Supabase SQL Editor.
-- Requires the application's numeric profile schema, pair invitations and push setup (049).
-- Includes the communication triggers from 064; running 064 separately is not necessary.
begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notifications'
      and column_name = 'user_id' and data_type in ('bigint', 'integer', 'smallint')
  ) then
    raise exception 'notifications.user_id musi byt ciselne ID profilu, ako v ligovej scheme aplikacie. Oprava bola zastavena bez zmeny dat.';
  end if;
end;
$$;

alter table public.notifications
  add column if not exists title text,
  add column if not exists body text,
  add column if not exists sender_profile_id bigint references public.proffiles(id) on delete set null,
  add column if not exists source_message_id text,
  add column if not exists source_friendship_id text,
  add column if not exists source_pair_invitation_id text,
  add column if not exists source_activity_key text,
  add column if not exists challenge_id text;

create unique index if not exists notifications_source_message_unique
  on public.notifications(source_message_id) where source_message_id is not null;
create unique index if not exists notifications_source_friendship_unique
  on public.notifications(source_friendship_id) where source_friendship_id is not null;
create unique index if not exists notifications_source_pair_invitation_unique
  on public.notifications(source_pair_invitation_id) where source_pair_invitation_id is not null;
create unique index if not exists notifications_source_activity_recipient_unique
  on public.notifications(user_id, source_activity_key) where source_activity_key is not null;

-- All four actions write a private notification in the same transaction.
-- Never use sender_id: legacy installations can store auth UUIDs there.
create or replace function public.notify_activity_recipient()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sender bigint;
  recipients bigint[];
  recipient bigint;
  sender_name text;
  notification_type text;
  notification_title text;
  notification_message text;
  source_key text;
  linked_challenge public.notifications.challenge_id%type;
begin
  case tg_table_name
    when 'friendships' then
      if new.status is distinct from 'pending' or new.user_id = new.friend_id then return new; end if;
      sender := new.user_id;
      recipients := array[new.friend_id];
      notification_type := 'friend_request';
      notification_title := 'Žiadosť o priateľstvo';
    when 'messages' then
      if new.sender_id = new.receiver_id then return new; end if;
      sender := new.sender_id;
      recipients := array[new.receiver_id];
      notification_type := 'message';
      notification_title := 'Nová správa';
    when 'pair_invitations' then
      if new.status is distinct from 'pending' then return new; end if;
      sender := new.inviter_id;
      recipients := array[new.invitee_id];
      notification_type := 'pair_invitation';
      notification_title := 'Pozvanie do dvojice';
    when 'challenges' then
      if new.status is distinct from 'pending' then return new; end if;
      sender := new.challenger_1_id;
      recipients := array[new.challenger_2_id, new.challenged_1_id, new.challenged_2_id];
      notification_type := 'challenge_request';
      notification_title := 'Nová výzva na zápas';
      linked_challenge := new.id::text;
    else
      raise exception 'Nepodporovany zdroj notifikacie: %', tg_table_name;
  end case;
  if sender is null or array_position(recipients, null) is not null then
    raise exception 'Aktivita neobsahuje platneho odosielatela alebo prijemcu.';
  end if;
  select coalesce(nullif(trim(full_name), ''), 'Hráč') into sender_name
    from public.proffiles where id = sender;
  if not found then raise exception 'Odosielatel notifikacie sa nenasiel.'; end if;
  source_key := tg_table_name || ':' || new.id::text;

  foreach recipient in array recipients loop
    if recipient = sender then
      raise exception 'Odosielatel nesmie byt prijemcom vlastnej ziadosti.';
    end if;
    notification_message := sender_name || case notification_type
      when 'friend_request' then ' ti poslal(a) žiadosť o priateľstvo.'
      when 'message' then ' ti poslal(a) novú správu.'
      when 'pair_invitation' then ' ťa pozýva vytvoriť dvojicu.'
      else ' ťa pozýva na zápas. Potvrď alebo odmietni účasť vo výzve.'
    end;
    insert into public.notifications(
      user_id, sender_profile_id, type, title, body, message, is_read,
      source_message_id, source_friendship_id, source_pair_invitation_id,
      source_activity_key, challenge_id
    ) values (
      recipient, sender, notification_type, notification_title, notification_message,
      notification_message, false,
      case when tg_table_name = 'messages' then new.id::text end,
      case when tg_table_name = 'friendships' then new.id::text end,
      case when tg_table_name = 'pair_invitations' then new.id::text end,
      source_key, linked_challenge
    ) on conflict (user_id, source_activity_key) where source_activity_key is not null do nothing;
  end loop;
  return new;
end;
$$;
revoke all on function public.notify_activity_recipient() from public, anon, authenticated;

drop trigger if exists notify_friend_request on public.friendships;
create trigger notify_friend_request after insert on public.friendships
  for each row execute function public.notify_activity_recipient();
drop trigger if exists notify_chat_message on public.messages;
create trigger notify_chat_message after insert on public.messages
  for each row execute function public.notify_activity_recipient();
drop trigger if exists notify_pair_invitation on public.pair_invitations;
create trigger notify_pair_invitation after insert on public.pair_invitations
  for each row execute function public.notify_activity_recipient();
drop trigger if exists notify_pair_challenge_recipients_after_insert on public.challenges;
create trigger notify_pair_challenge_recipients_after_insert after insert on public.challenges
  for each row execute function public.notify_activity_recipient();

create or replace function public.mark_messages_as_read(p_sender_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  current_profile_id bigint;
begin
  if auth.uid() is null then raise exception 'Prihlasenie je potrebne na oznacenie sprav ako precitanych.'; end if;
  select id into current_profile_id from public.proffiles
    where lower(email) = lower(auth.jwt() ->> 'email') limit 1;
  if current_profile_id is null then raise exception 'Profil prihlaseneho pouzivatela sa nenasiel.'; end if;
  update public.messages set is_read = true
    where receiver_id = current_profile_id and sender_id = p_sender_id and is_read = false;
  update public.notifications set is_read = true
    where user_id = current_profile_id
      and (sender_profile_id = p_sender_id or sender_id::text = p_sender_id::text)
      and type in ('message', 'new_message', 'direct_message') and is_read = false;
end;
$$;
revoke all on function public.mark_messages_as_read(bigint) from public;
grant execute on function public.mark_messages_as_read(bigint) to authenticated;

do $$
declare
  source_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach source_table in array array['notifications', 'messages', 'friendships', 'pair_invitations', 'challenges'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = source_table) then
        execute format('alter publication supabase_realtime add table public.%I', source_table);
      end if;
    end loop;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;

-- All four rows should be present after installation. This does not send alerts.
select event_object_table as source_table, trigger_name
from information_schema.triggers
where trigger_schema = 'public'
  and trigger_name in ('notify_friend_request', 'notify_chat_message',
    'notify_pair_invitation', 'notify_pair_challenge_recipients_after_insert')
order by event_object_table;
