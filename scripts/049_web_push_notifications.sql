-- Apply after 036 (profile settings).
-- user_id is the Supabase auth UUID, not the numeric proffiles.id.
begin;

create table if not exists public.user_push_tokens (
  token text primary key check (length(token) between 20 and 4096),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_test_sent_at timestamptz
);
alter table public.user_push_tokens add column if not exists last_test_sent_at timestamptz;
create index if not exists user_push_tokens_user_idx on public.user_push_tokens(user_id);
alter table public.user_push_tokens enable row level security;
revoke all on public.user_push_tokens from anon, authenticated;
grant select, delete on public.user_push_tokens to authenticated;
grant all on public.user_push_tokens to service_role;

drop policy if exists "Users read own push tokens" on public.user_push_tokens;
create policy "Users read own push tokens" on public.user_push_tokens
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Users delete own push tokens" on public.user_push_tokens;
create policy "Users delete own push tokens" on public.user_push_tokens
  for delete to authenticated using (user_id = (select auth.uid()));

-- Possession of the unguessable FCM token allows an explicit account switch on a
-- shared device. One device must never deliver another account's notifications.
drop function if exists public.register_push_token(text);
create or replace function public.register_push_token(p_token text, p_enable_alerts boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Prihlasenie je potrebne.'; end if;
  if p_token is null or length(p_token) not between 20 and 4096 then
    raise exception 'Neplatny push token.';
  end if;
  insert into public.user_push_tokens(token, user_id)
    values (p_token, auth.uid())
  on conflict (token) do update set
    user_id = excluded.user_id,
    created_at = case when user_push_tokens.user_id = excluded.user_id
      then user_push_tokens.created_at else now() end;
  if p_enable_alerts then
    update public.proffiles
      set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{pushAlerts}', 'true'::jsonb)
      where lower(email) = lower((select email from auth.users where id = auth.uid()));
  end if;
end;
$$;
revoke all on function public.register_push_token(text, boolean) from public, anon;
grant execute on function public.register_push_token(text, boolean) to authenticated;

create or replace function public.reserve_push_test()
returns setof text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Prihlasenie je potrebne.'; end if;
  perform pg_advisory_xact_lock(hashtext('push-test:' || auth.uid()::text));
  if exists (select 1 from public.user_push_tokens where user_id = auth.uid()
    and last_test_sent_at > now() - interval '60 seconds') then
    raise exception 'Dalsi test mozes odoslat o minutu.';
  end if;
  return query update public.user_push_tokens set last_test_sent_at = now()
    where user_id = auth.uid() returning token;
end;
$$;
revoke all on function public.reserve_push_test() from public, anon;
grant execute on function public.reserve_push_test() to authenticated;

-- Supports both the current numeric profile recipient and legacy auth UUIDs.
-- Only the webhook server can resolve recipients; clients cannot read other tokens.
create or replace function public.push_notification_tokens(p_notification_id text)
returns setof text language sql security definer set search_path = public as $$
  select distinct t.token
  from public.notifications n
  join public.user_push_tokens t on (
    to_jsonb(n)->>'user_id' is null
    or to_jsonb(n)->>'user_id' = t.user_id::text
    or exists (
      select 1 from public.proffiles p join auth.users u
        on lower(p.email) = lower(u.email)
      where p.id::text = to_jsonb(n)->>'user_id' and u.id = t.user_id
    )
  )
  where n.id::text = p_notification_id
    and not exists (
      select 1 from public.proffiles p join auth.users u
        on lower(p.email) = lower(u.email)
      where u.id = t.user_id
        and to_jsonb(p)->'settings'->>'pushAlerts' = 'false'
    )
  order by t.token;
$$;
revoke all on function public.push_notification_tokens(text) from public, anon, authenticated;
grant execute on function public.push_notification_tokens(text) to service_role;

notify pgrst, 'reload schema';
commit;
