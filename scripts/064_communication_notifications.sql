-- Run this entire file in the Supabase SQL Editor.
-- Uses numeric profile recipients, as in the existing league notifications.
begin;

alter table public.notifications
  add column if not exists sender_profile_id bigint references public.proffiles(id) on delete set null,
  add column if not exists source_message_id text,
  add column if not exists source_friendship_id text;

create unique index if not exists notifications_source_message_unique
  on public.notifications(source_message_id) where source_message_id is not null;
create unique index if not exists notifications_source_friendship_unique
  on public.notifications(source_friendship_id) where source_friendship_id is not null;

-- sender_id can be UUID in older installations. Keep the numeric profile
-- identity separately for chat navigation without changing existing sender IDs.
create or replace function public.notify_friend_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sender_name text;
begin
  if new.status <> 'pending' or new.user_id = new.friend_id then return new; end if;
  select coalesce(nullif(trim(full_name), ''), 'Hrac') into sender_name
    from public.proffiles where id = new.user_id;
  if not found then raise exception 'Odosielatel ziadosti sa nenasiel.'; end if;
  insert into public.notifications(user_id, sender_profile_id, type, message, is_read, source_friendship_id)
    values (new.friend_id, new.user_id, 'friend_request',
      sender_name || ' ti poslal(a) ziadost o priatelstvo.', false, new.id::text)
    on conflict (source_friendship_id) where source_friendship_id is not null do nothing;
  return new;
end;
$$;
revoke all on function public.notify_friend_request() from public;
drop trigger if exists notify_friend_request on public.friendships;
create trigger notify_friend_request after insert on public.friendships
  for each row execute function public.notify_friend_request();

create or replace function public.notify_chat_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sender_name text;
begin
  if new.sender_id = new.receiver_id then return new; end if;
  select coalesce(nullif(trim(full_name), ''), 'Hrac') into sender_name
    from public.proffiles where id = new.sender_id;
  if not found then raise exception 'Odosielatel spravy sa nenasiel.'; end if;
  insert into public.notifications(user_id, sender_profile_id, type, message, is_read, source_message_id)
    values (new.receiver_id, new.sender_id, 'message',
      sender_name || ' ti poslal(a) novu spravu.', false, new.id::text)
    on conflict (source_message_id) where source_message_id is not null do nothing;
  return new;
end;
$$;
revoke all on function public.notify_chat_message() from public;
drop trigger if exists notify_chat_message on public.messages;
create trigger notify_chat_message after insert on public.messages
  for each row execute function public.notify_chat_message();

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
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['notifications', 'messages', 'friendships'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = table_name) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
