create or replace function public.mark_messages_as_read(p_sender_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Prihlásenie je potrebné na označenie správ ako prečítaných.';
  end if;

  select profile.id
  into current_profile_id
  from public.proffiles as profile
  where lower(profile.email) = lower(auth.jwt() ->> 'email')
  limit 1;

  if current_profile_id is null then
    raise exception 'Profil prihláseného používateľa sa nenašiel.';
  end if;

  update public.messages as message
  set is_read = true
  where message.receiver_id = current_profile_id
    and message.sender_id = p_sender_id
    and message.is_read = false;

  update public.notifications as notification
  set is_read = true
  where notification.user_id = current_profile_id
    and notification.sender_id = p_sender_id
    and notification.type in ('message', 'new_message', 'direct_message')
    and notification.is_read = false;
end;
$$;

revoke all on function public.mark_messages_as_read(bigint) from public;
grant execute on function public.mark_messages_as_read(bigint) to authenticated;