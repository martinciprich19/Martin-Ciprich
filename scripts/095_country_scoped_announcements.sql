-- Apply after 079_super_admin_console.sql. Existing installations with the
-- UUID-returning RPC should first apply 094_repair_super_admin_announcement_id.sql.
-- Null country_code keeps announcements global; SK/NL target profiles by their
-- saved national league, independently of browser language.
begin;

alter table public.notifications
  add column if not exists country_code text;

create or replace function public.current_profile_country_code()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select profile.country_code
  from public.proffiles profile
  join auth.users account on lower(account.email) = lower(profile.email)
  where account.id = auth.uid()
  limit 1;
$$;
revoke all on function public.current_profile_country_code() from public, anon;
grant execute on function public.current_profile_country_code() to authenticated;

drop policy if exists "notifications_read_global" on public.notifications;
create policy "notifications_read_global" on public.notifications
  for select to authenticated
  using (
    user_id is null
    and (country_code is null or country_code = (select public.current_profile_country_code()))
  );

drop function if exists public.super_admin_send_announcement(text, text);
drop function if exists public.super_admin_send_announcement(text, text, text);
create function public.super_admin_send_announcement(
  p_title text,
  p_body text,
  p_country_code text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification_id text;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Super Admin access required' using errcode = '42501';
  end if;
  if nullif(trim(p_title), '') is null or nullif(trim(p_body), '') is null
    or length(trim(p_title)) > 120 or length(trim(p_body)) > 1000 then
    raise exception 'Announcement title/body is required and must be within its length limit'
      using errcode = '22023';
  end if;
  if p_country_code is not null and p_country_code not in ('SK', 'NL') then
    raise exception 'Announcement country must be SK, NL or null for all players'
      using errcode = '22023';
  end if;

  insert into public.notifications (user_id, type, title, body, message, is_read, country_code)
  values (null, 'system_announcement', trim(p_title), trim(p_body), trim(p_body), false, p_country_code)
  returning id::text into notification_id;
  perform public.record_super_admin_action(
    'announcement.sent',
    'notification',
    notification_id,
    jsonb_build_object('title', trim(p_title), 'country_code', p_country_code)
  );
  return notification_id;
end;
$$;
revoke all on function public.super_admin_send_announcement(text, text, text) from public, anon;
grant execute on function public.super_admin_send_announcement(text, text, text) to authenticated;

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

  select profile.id, profile.country_code
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
  where user_id = current_profile_id
    and is_read = false;

  insert into public.notification_read_receipts (user_profile_id, notification_id)
  select current_profile_id, notification.id::text
  from public.notifications notification
  where notification.user_id is null
    and (notification.country_code is null or notification.country_code = current_country_code)
  on conflict (user_profile_id, notification_id) do nothing;
end;
$$;
revoke all on function public.mark_notifications_as_read() from public, anon;
grant execute on function public.mark_notifications_as_read() to authenticated;

-- A country-targeted announcement must not be pushed to another league.
create or replace function public.push_notification_tokens(p_notification_id text)
returns setof text
language sql
security definer
set search_path = ''
as $$
  select distinct token.token
  from public.notifications notification
  join public.user_push_tokens token on (
    to_jsonb(notification)->>'user_id' is null
    or to_jsonb(notification)->>'user_id' = token.user_id::text
    or exists (
      select 1
      from public.proffiles profile
      join auth.users account on lower(profile.email) = lower(account.email)
      where profile.id::text = to_jsonb(notification)->>'user_id'
        and account.id = token.user_id
    )
  )
  where notification.id::text = p_notification_id
    and (
      notification.country_code is null
      or to_jsonb(notification)->>'user_id' is not null
      or exists (
        select 1
        from public.proffiles profile
        join auth.users account on lower(profile.email) = lower(account.email)
        where account.id = token.user_id
          and profile.country_code = notification.country_code
      )
    )
    and not exists (
      select 1
      from public.proffiles profile
      join auth.users account on lower(profile.email) = lower(account.email)
      where account.id = token.user_id
        and (
          profile.settings->'pushAlerts' = 'false'::jsonb
          or case
            when notification.type in ('challenge_request', 'pair_challenge', 'challenge_team_accepted')
              then profile.settings->'emailChallenges' = 'false'::jsonb
            when notification.type in ('message', 'new_message', 'direct_message')
              then profile.settings->'emailMessages' = 'false'::jsonb
            when notification.type in ('tournament_invitation', 'tournament_invite', 'tournament', 'league_news', 'news', 'announcement', 'system_announcement')
              then coalesce(profile.settings->'emailTournaments' <> 'true'::jsonb, true)
            else false
          end
        )
    )
  order by token.token;
$$;
revoke all on function public.push_notification_tokens(text) from public, anon, authenticated;
grant execute on function public.push_notification_tokens(text) to service_role;

notify pgrst, 'reload schema';
commit;
