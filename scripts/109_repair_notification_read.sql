-- Restore read receipts and the authenticated bulk-read RPC. Run in Supabase SQL Editor.
begin;

create table if not exists public.notification_read_receipts (
  user_profile_id bigint not null references public.proffiles(id) on delete cascade,
  notification_id text not null,
  read_at timestamptz not null default now(),
  primary key (user_profile_id, notification_id)
);

alter table public.notification_read_receipts enable row level security;
grant select on public.notification_read_receipts to authenticated;

drop policy if exists "players read own notification receipts" on public.notification_read_receipts;
create policy "players read own notification receipts" on public.notification_read_receipts
  for select to authenticated
  using (
    exists (
      select 1 from public.proffiles profile
      where profile.id = user_profile_id
        and lower(profile.email) = lower(auth.jwt() ->> 'email')
    )
  );

create or replace function public.mark_notifications_as_read()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_profile_id bigint;
  current_country_code text;
begin
  if auth.uid() is null then
    raise exception 'Prihlásenie je potrebné na označenie notifikácií ako prečítaných.';
  end if;

  select profile.id, to_jsonb(profile) ->> 'country_code'
  into current_profile_id, current_country_code
  from public.proffiles profile
  join auth.users account on lower(account.email) = lower(profile.email)
  where account.id = auth.uid()
  limit 1;

  if current_profile_id is null then
    raise exception 'Profil prihláseného používateľa sa nenašiel.';
  end if;

  update public.notifications
  set is_read = true
  where user_id = current_profile_id and is_read = false;

  insert into public.notification_read_receipts (user_profile_id, notification_id)
  select current_profile_id, notification.id::text
  from public.notifications notification
  where notification.user_id is null
    and (to_jsonb(notification) ->> 'country_code' is null
      or to_jsonb(notification) ->> 'country_code' = current_country_code)
  on conflict (user_profile_id, notification_id) do nothing;
end;
$$;

revoke all on function public.mark_notifications_as_read() from public, anon;
grant execute on function public.mark_notifications_as_read() to authenticated;
notify pgrst, 'reload schema';
commit;
