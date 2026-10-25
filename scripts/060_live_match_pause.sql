-- Apply after 059. Run this entire file in the Supabase SQL Editor.
begin;

alter table public.live_matches
  add column if not exists paused_at timestamptz,
  add column if not exists paused_seconds double precision not null default 0
    check (paused_seconds >= 0),
  add column if not exists resume_pin text check (resume_pin ~ '^[0-9]{4}$'),
  add column if not exists status text generated always as (
    case
      when finished_at is not null then 'finished'
      when paused_at is not null then 'paused'
      else 'in_progress'
    end
  ) stored;
-- Keep the resume PIN out of public scoreboard SELECTs.
do $$
declare col record;
begin
  if has_table_privilege('authenticated', 'public.live_matches', 'SELECT') then
    revoke select on public.live_matches from authenticated;
    for col in select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'live_matches' and column_name <> 'resume_pin'
    loop
      execute format('grant select (%I) on public.live_matches to authenticated', col.column_name);
    end loop;
  end if;
end;
$$;
revoke select (resume_pin) on public.live_matches from anon, authenticated;
grant select (paused_at, paused_seconds, status) on public.live_matches to anon, authenticated;

create table if not exists public.live_match_pauses (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.live_matches(id) on delete cascade,
  pin text check (pin ~ '^[0-9]{4}$'),
  dispatch_token text not null,
  device_token_hash text,
  created_at timestamptz not null default now(),
  resumed_at timestamptz
);
create unique index if not exists live_match_pauses_active_pin
  on public.live_match_pauses(pin) where pin is not null;
create unique index if not exists live_match_pauses_active_match
  on public.live_match_pauses(match_id) where resumed_at is null;
alter table public.live_match_pauses enable row level security;
revoke all on public.live_match_pauses from public, anon, authenticated;

create table if not exists public.live_match_pause_emails (
  id uuid primary key default gen_random_uuid(),
  pause_id uuid not null references public.live_match_pauses(id) on delete cascade,
  recipient text not null,
  sent_at timestamptz,
  unique (pause_id, recipient)
);
alter table public.live_match_pause_emails enable row level security;
revoke all on public.live_match_pause_emails from public, anon, authenticated;

create table if not exists public.live_match_resume_attempts (
  client_key text primary key,
  window_started timestamptz not null default now(),
  attempts integer not null default 0
);
alter table public.live_match_resume_attempts enable row level security;
revoke all on public.live_match_resume_attempts from public, anon, authenticated;

create or replace function public.has_resumed_match_access(p_match_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.live_match_pauses p
    where p.match_id = p_match_id and p.resumed_at is not null
      and p.device_token_hash = encode(sha256(convert_to(
        coalesce(nullif(current_setting('request.headers', true), '')::jsonb
          ->> 'x-riva-qr-device', ''), 'UTF8')), 'hex')
      and not exists (
        select 1 from public.live_match_pauses newer
        where newer.match_id = p.match_id and newer.created_at > p.created_at
      )
  );
$$;
revoke all on function public.has_resumed_match_access(uuid) from public;
grant execute on function public.has_resumed_match_access(uuid) to anon, authenticated;

-- The existing QR final-result trigger must recognize a resumed device too.
create or replace function public.has_qr_device_access(p_match_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_resumed_match_access(p_match_id) or exists (
    select 1 from public.live_matches m
    where m.id = p_match_id and m.qr_device_token_hash is not null
      and m.qr_device_token_hash = encode(sha256(convert_to(
        coalesce(nullif(current_setting('request.headers', true), '')::jsonb
          ->> 'x-riva-qr-device', ''), 'UTF8')), 'hex')
  );
$$;
revoke all on function public.has_qr_device_access(uuid) from public;
grant execute on function public.has_qr_device_access(uuid) to anon, authenticated;

drop policy if exists "Resumed device can read match" on public.live_matches;
create policy "Resumed device can read match" on public.live_matches
  for select to anon, authenticated using (public.has_resumed_match_access(id));
drop policy if exists "Resumed device can score match" on public.live_matches;
create policy "Resumed device can score match" on public.live_matches
  for update to anon, authenticated using (public.has_resumed_match_access(id))
  with check (public.has_resumed_match_access(id));

create or replace function public.guard_paused_live_match()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated') and (new.paused_at is not null or new.paused_seconds <> 0 or new.resume_pin is not null) then
      raise exception 'Neplatny stav prerusenia noveho zapasu.';
    end if;
    return new;
  end if;
  if current_user in ('anon', 'authenticated') and (
    old.paused_at is not null
    or new.paused_at is distinct from old.paused_at
    or new.paused_seconds is distinct from old.paused_seconds
    or new.resume_pin is distinct from old.resume_pin
  ) then
    raise exception 'Zapas je preruseny. Pokracuj zadanim PIN-u.';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_paused_live_match() from public;
drop trigger if exists guard_paused_live_match on public.live_matches;
create trigger guard_paused_live_match before insert or update on public.live_matches
  for each row execute function public.guard_paused_live_match();

create or replace function public.pause_live_match(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  game public.live_matches%rowtype;
  paused public.live_match_pauses%rowtype;
  candidate text;
  attempts integer := 0;
begin
  select * into game from public.live_matches where id = p_match_id for update;
  if not found then raise exception 'Zapas sa nenasiel.'; end if;
  if not (
    public.has_qr_device_access(game.id)
    or (game.qr_created_by is null and game.challenge_id is null)
    or (game.challenge_id is not null and game.is_pin_activated
      and exists (select 1 from public.challenges c
        where c.id::text = game.challenge_id and c.status = 'accepted'))
    or (auth.uid() is not null and exists (
      select 1 from public.proffiles p where p.id = game.qr_created_by
        and lower(p.email) = lower(auth.jwt() ->> 'email')
    ))
  ) then raise exception 'Nemas opravnenie prerusit tento zapas.'; end if;
  if game.finished_at is not null or game.team_a_sets >= 2 or game.team_b_sets >= 2
    or (game.set_format = 'pro_set' and greatest(game.team_a_sets, game.team_b_sets) >= 1)
  then raise exception 'Ukonceny zapas nie je mozne prerusit.'; end if;

  select * into paused from public.live_match_pauses
    where match_id = game.id and resumed_at is null;
  if not found then
    -- Serialize PIN allocation across all concurrent pause requests.
    perform pg_advisory_xact_lock(604060);
    loop
      candidate := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 10000))::text, 4, '0');
      exit when not exists (select 1 from public.live_match_pauses where pin = candidate);
      attempts := attempts + 1;
      if attempts >= 1000 then raise exception 'Nie je dostupny volny PIN. Skus neskor.'; end if;
    end loop;
    insert into public.live_match_pauses(match_id, pin, dispatch_token)
      values (game.id, candidate, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
      returning * into paused;
    update public.live_matches set paused_at = clock_timestamp(), resume_pin = paused.pin where id = game.id;
    insert into public.live_match_pause_emails(pause_id, recipient)
      select distinct paused.id, lower(trim(p.email))
      from public.proffiles p
      where nullif(trim(p.email), '') is not null and (
        p.id in (game.team_a_player1_id, game.team_a_player2_id,
                 game.team_b_player1_id, game.team_b_player2_id)
        or exists (select 1 from public.challenges c
          where c.id::text = game.challenge_id and p.id in (
            c.challenger_1_id, c.challenger_2_id, c.challenged_1_id, c.challenged_2_id))
      );
  end if;
  return jsonb_build_object('pin', paused.pin, 'dispatchToken', paused.dispatch_token,
    'pauseId', paused.id, 'recipients', (select count(*) from public.live_match_pause_emails where pause_id = paused.id));
end;
$$;
revoke all on function public.pause_live_match(uuid) from public;
grant execute on function public.pause_live_match(uuid) to anon, authenticated;

-- Called only by the server; failed attempts persist rather than rolling back.
create or replace function public.resume_paused_live_match(
  p_pin text, p_device_token text, p_client_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  paused public.live_match_pauses%rowtype;
  tries integer;
begin
  if p_client_key is null or p_device_token !~ '^[a-f0-9]{64}$'
    or p_device_token is null or p_pin is null or p_pin !~ '^[0-9]{4}$'
  then return jsonb_build_object('error', 'Neplatne udaje pre pokracovanie.'); end if;
  delete from public.live_match_resume_attempts where window_started < now() - interval '1 day';
  insert into public.live_match_resume_attempts as a(client_key, attempts)
    values (p_client_key, 1)
    on conflict (client_key) do update set
      attempts = case when a.window_started < now() - interval '10 minutes' then 1 else a.attempts + 1 end,
      window_started = case when a.window_started < now() - interval '10 minutes' then now() else a.window_started end
    returning attempts into tries;
  if tries > 5 then return jsonb_build_object('error', 'Prilis vela pokusov. Skus znova o 10 minut.'); end if;
  select * into paused from public.live_match_pauses
    where device_token_hash = encode(sha256(convert_to(p_device_token, 'UTF8')), 'hex')
      and resumed_at is not null
    order by created_at desc limit 1;
  if found and not exists (select 1 from public.live_match_pauses
    where match_id = paused.match_id and created_at > paused.created_at)
  then return jsonb_build_object('matchId', paused.match_id); end if;
  select * into paused from public.live_match_pauses where pin = p_pin and resumed_at is null for update;
  if not found then return jsonb_build_object('error', 'PIN preruseneho zapasu nie je platny alebo uz bol pouzity.'); end if;
  perform 1 from public.live_matches where id = paused.match_id for update;
  update public.live_match_pauses set pin = null, resumed_at = clock_timestamp(),
    device_token_hash = encode(sha256(convert_to(p_device_token, 'UTF8')), 'hex')
    where id = paused.id;
  update public.live_matches set
    paused_seconds = paused_seconds + greatest(0, extract(epoch from (clock_timestamp() - paused_at))),
    paused_at = null, resume_pin = null
    where id = paused.match_id;
  return jsonb_build_object('matchId', paused.match_id);
end;
$$;
revoke all on function public.resume_paused_live_match(text, text, text) from public, anon, authenticated;
grant execute on function public.resume_paused_live_match(text, text, text) to service_role;

create or replace function public.pending_match_pause_emails(
  p_pause_id uuid, p_dispatch_token text, p_match_id uuid, p_pin text
)
returns table(email_id uuid, recipient text, pin text)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.live_match_pauses
    where id = p_pause_id and dispatch_token = p_dispatch_token and resumed_at is null
      and match_id = p_match_id and live_match_pauses.pin = p_pin)
  then raise exception 'Neplatne alebo uz obnovene prerusenie.'; end if;
  return query select e.id, e.recipient, p.pin from public.live_match_pause_emails e
    join public.live_match_pauses p on p.id = e.pause_id
    where p.id = p_pause_id and p.dispatch_token = p_dispatch_token
      and p.resumed_at is null and e.sent_at is null;
end;
$$;
revoke all on function public.pending_match_pause_emails(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.pending_match_pause_emails(uuid, text, uuid, text) to service_role;

create or replace function public.mark_match_pause_email_sent(p_email_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.live_match_pause_emails set sent_at = now() where id = p_email_id;
$$;
revoke all on function public.mark_match_pause_email_sent(uuid) from public, anon, authenticated;
grant execute on function public.mark_match_pause_email_sent(uuid) to service_role;

create or replace function public.live_statistics_snapshot(game public.live_matches)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_object_agg(key, value) from jsonb_each(to_jsonb(game))
  where key = any(array[
    'scoring_type','set_format','third_set_format',
    'team_a_player1_name','team_a_player2_name','team_b_player1_name','team_b_player2_name',
    'team_a_sets','team_b_sets','completed_sets','set_statistics','statistics_complete',
    'point_history','point_history_complete','paused_seconds',
    'team_a_player1_serve_points_won','team_a_player1_serve_points_lost',
    'team_a_player2_serve_points_won','team_a_player2_serve_points_lost',
    'team_b_player1_serve_points_won','team_b_player1_serve_points_lost',
    'team_b_player2_serve_points_won','team_b_player2_serve_points_lost',
    'team_a_total_points_won','team_b_total_points_won',
    'streak_team','current_point_streak','team_a_longest_point_streak','team_b_longest_point_streak',
    'team_a_break_points','team_a_break_points_converted','team_a_break_points_missed',
    'team_b_break_points','team_b_break_points_converted','team_b_break_points_missed',
    'started_at','finished_at','service_game_statistics'
  ]);
$$;
revoke all on function public.live_statistics_snapshot(public.live_matches) from public;

notify pgrst, 'reload schema';
commit;
