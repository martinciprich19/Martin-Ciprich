-- Apply after 049 and 036. Legacy email* keys now control push categories.
begin;
create or replace function public.set_my_push_category(p_key text,p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Prihlásenie je potrebné.' using errcode='42501'; end if;
  if p_key is null or p_key not in ('emailChallenges','emailMessages','emailTournaments') or p_enabled is null then
    raise exception 'Neplatná kategória notifikácií.' using errcode='22023';
  end if;
  update public.proffiles set settings=jsonb_set(coalesce(settings,'{}'::jsonb),array[p_key],to_jsonb(p_enabled))
    where lower(email)=lower((select email from auth.users where id=auth.uid()));
  if not found then raise exception 'Hráčsky profil sa nenašiel.' using errcode='22023'; end if;
end;
$$;
revoke all on function public.set_my_push_category(text,boolean) from public,anon;
grant execute on function public.set_my_push_category(text,boolean) to authenticated;

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
revoke all on function public.push_notification_tokens(text) from public,anon,authenticated;
grant execute on function public.push_notification_tokens(text) to service_role;
notify pgrst,'reload schema';
commit;
