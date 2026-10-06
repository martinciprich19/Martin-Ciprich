grant update (is_read) on public.messages to authenticated;

drop policy if exists "message_receivers_mark_read" on public.messages;
create policy "message_receivers_mark_read" on public.messages
  for update to authenticated
  using (
    exists (
      select 1
      from public.proffiles
      where proffiles.id = messages.receiver_id
        and lower(proffiles.email) = lower((select auth.jwt() ->> 'email'))
    )
  )
  with check (
    exists (
      select 1
      from public.proffiles
      where proffiles.id = messages.receiver_id
        and lower(proffiles.email) = lower((select auth.jwt() ->> 'email'))
    )
  );