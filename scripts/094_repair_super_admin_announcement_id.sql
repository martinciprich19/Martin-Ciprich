-- Migration 079 originally assumed notifications.id was UUID. The application
-- schema uses bigint, so preserve the notification ID as text in the RPC result.
begin;

drop function if exists public.super_admin_send_announcement(text, text);

create function public.super_admin_send_announcement(p_title text, p_body text)
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

  insert into public.notifications (user_id, type, title, body, message, is_read)
  values (null, 'system_announcement', trim(p_title), trim(p_body), trim(p_body), false)
  returning id::text into notification_id;
  perform public.record_super_admin_action(
    'announcement.sent', 'notification', notification_id,
    jsonb_build_object('title', trim(p_title))
  );
  return notification_id;
end;
$$;

revoke all on function public.super_admin_send_announcement(text, text) from public, anon;
grant execute on function public.super_admin_send_announcement(text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
