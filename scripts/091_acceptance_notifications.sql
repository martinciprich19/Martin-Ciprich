-- Apply after 066 (activity notifications) and 090 (push preferences).
begin;

create or replace function public.notify_friendship_accepted()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  accepter_name text;
begin
  if old.status is distinct from 'pending' or new.status is distinct from 'accepted' then
    return new;
  end if;

  select coalesce(nullif(trim(full_name), ''), 'Hráč') into accepter_name
    from public.proffiles where id = new.friend_id;
  if not found then raise exception 'Profil používateľa, ktorý prijal žiadosť, sa nenašiel.'; end if;

  insert into public.notifications(
    user_id, sender_profile_id, type, title, body, message, is_read, source_activity_key
  ) values (
    new.user_id, new.friend_id, 'friend_request_accepted',
    'Žiadosť o priateľstvo prijatá',
    accepter_name || ' prijal(a) tvoju žiadosť o priateľstvo.',
    accepter_name || ' prijal(a) tvoju žiadosť o priateľstvo.',
    false, 'friendship_accepted:' || new.id::text
  ) on conflict (user_id, source_activity_key) where source_activity_key is not null do nothing;

  return new;
end;
$$;
revoke all on function public.notify_friendship_accepted() from public, anon, authenticated;

drop trigger if exists notify_friendship_accepted_after_update on public.friendships;
create trigger notify_friendship_accepted_after_update
  after update of status on public.friendships
  for each row execute function public.notify_friendship_accepted();

create or replace function public.notify_opponents_pair_accepted()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  accepted_pair text;
begin
  if old.status is distinct from 'pending'
    or new.status not in ('pending', 'accepted')
    or (old.challenged_1_accepted and old.challenged_2_accepted)
    or not (new.challenged_1_accepted and new.challenged_2_accepted) then
    return new;
  end if;

  select string_agg(coalesce(nullif(trim(full_name), ''), 'Hráč'), ' & ' order by id)
    into accepted_pair
    from public.proffiles
    where id in (new.challenged_1_id, new.challenged_2_id);
  if accepted_pair is null then raise exception 'Profily dvojice, ktorá prijala výzvu, sa nenašli.'; end if;

  insert into public.notifications(
    user_id, sender_profile_id, type, title, body, message, is_read, source_activity_key
  )
  select recipient_id, new.challenged_1_id, 'challenge_team_accepted',
    'Súperova dvojica prijala výzvu',
    accepted_pair || ' prijali vašu výzvu na zápas.',
    accepted_pair || ' prijali vašu výzvu na zápas.',
    false, 'challenge_pair_accepted:' || new.id::text
  from (values (new.challenger_1_id), (new.challenger_2_id)) as recipients(recipient_id)
  where recipient_id is not null
  on conflict (user_id, source_activity_key) where source_activity_key is not null do nothing;

  return new;
end;
$$;
revoke all on function public.notify_opponents_pair_accepted() from public, anon, authenticated;

drop trigger if exists notify_opponents_pair_accepted_after_update on public.challenges;
create trigger notify_opponents_pair_accepted_after_update
  after update of status, challenged_1_accepted, challenged_2_accepted on public.challenges
  for each row execute function public.notify_opponents_pair_accepted();

-- Keep acceptance alerts subject to the same challenge push preference and master opt-out.
create or replace function public.push_notification_tokens(p_notification_id text)
returns setof text language sql security definer set search_path = '' as $$
  select distinct t.token
  from public.notifications n
  join public.user_push_tokens t on (
    to_jsonb(n)->>'user_id' is null
    or to_jsonb(n)->>'user_id'=t.user_id::text
    or exists (
      select 1 from public.proffiles p join auth.users u on lower(p.email)=lower(u.email)
      where p.id::text=to_jsonb(n)->>'user_id' and u.id=t.user_id
    )
  )
  where n.id::text=p_notification_id
    and not exists (
      select 1 from public.proffiles p join auth.users u on lower(p.email)=lower(u.email)
      where u.id=t.user_id and (
        p.settings->'pushAlerts'='false'::jsonb
        or case
          when n.type in ('challenge_request','pair_challenge','challenge_team_accepted') then p.settings->'emailChallenges'='false'::jsonb
          when n.type in ('message','new_message','direct_message') then p.settings->'emailMessages'='false'::jsonb
          when n.type in ('tournament_invitation','tournament_invite','tournament','league_news','news','announcement','system_announcement') then
            coalesce(p.settings->'emailTournaments'<>'true'::jsonb, true)
          else false
        end
      )
    )
  order by t.token;
$$;
revoke all on function public.push_notification_tokens(text) from public, anon, authenticated;
grant execute on function public.push_notification_tokens(text) to service_role;

notify pgrst, 'reload schema';
commit;
