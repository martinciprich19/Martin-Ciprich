-- Apply after 060 or 061. Run this entire file in the Supabase SQL Editor.
begin;

alter table public.live_matches add column if not exists ended_early_at timestamptz;
grant select (ended_early_at) on public.live_matches to anon, authenticated;

create or replace function public.has_resumed_match_access(p_match_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.live_match_pauses p
    where p.match_id = p_match_id and p.device_token_hash is not null
      and p.device_token_hash = encode(sha256(convert_to(
        coalesce(nullif(current_setting('request.headers', true), '')::jsonb
          ->> 'x-riva-qr-device', ''), 'UTF8')), 'hex')
      and not exists (
        select 1 from public.live_match_pauses newer
        where newer.match_id = p.match_id and newer.created_at > p.created_at
      )
  );
$$;

create or replace function public.can_manage_live_match(p_match_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.live_matches game where game.id = p_match_id and (
      public.has_qr_device_access(game.id)
      or (game.qr_created_by is null and game.challenge_id is null)
      or (game.challenge_id is not null and game.is_pin_activated
        and exists (select 1 from public.challenges c
          where c.id::text = game.challenge_id and c.status = 'accepted'))
      or (auth.uid() is not null and exists (
        select 1 from public.proffiles p where p.id = game.qr_created_by
          and lower(p.email) = lower(auth.jwt() ->> 'email')
      ))
    )
  );
$$;
revoke all on function public.can_manage_live_match(uuid) from public;
grant execute on function public.can_manage_live_match(uuid) to anon, authenticated;

create or replace function public.guard_paused_live_match()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated') and (
      new.paused_at is not null or new.paused_seconds <> 0
      or new.resume_pin is not null or new.ended_early_at is not null
    ) then raise exception 'Neplatny stav noveho zapasu.'; end if;
    return new;
  end if;
  if old.ended_early_at is not null and new is distinct from old then
    raise exception 'Zapas bol natrvalo ukonceny bez vysledku.';
  end if;
  if current_user in ('anon', 'authenticated') and (
    old.paused_at is not null
    or new.paused_at is distinct from old.paused_at
    or new.paused_seconds is distinct from old.paused_seconds
    or new.resume_pin is distinct from old.resume_pin
    or new.ended_early_at is distinct from old.ended_early_at
  ) then raise exception 'Zapas je preruseny alebo ukonceny. Pouzi prislusne tlacidlo.'; end if;
  return new;
end;
$$;

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
  if not public.can_manage_live_match(game.id)
    then raise exception 'Nemas opravnenie prerusit tento zapas.'; end if;
  if game.finished_at is not null or game.team_a_sets >= 2 or game.team_b_sets >= 2
    or (game.set_format = 'pro_set' and greatest(game.team_a_sets, game.team_b_sets) >= 1)
  then raise exception 'Ukonceny zapas nie je mozne prerusit.'; end if;
  select * into paused from public.live_match_pauses
    where match_id = game.id and pin is not null for update;
  if not found then
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
  end if;
  if game.paused_at is null then
    update public.live_match_pauses set resumed_at = null where id = paused.id;
    update public.live_matches set paused_at = clock_timestamp(), resume_pin = paused.pin where id = game.id;
  end if;
  insert into public.live_match_pause_emails(pause_id, recipient)
    select distinct paused.id, lower(trim(p.email))
    from public.proffiles p
    where nullif(trim(p.email), '') is not null and (
      p.id in (game.team_a_player1_id, game.team_a_player2_id,
               game.team_b_player1_id, game.team_b_player2_id)
      or exists (select 1 from public.challenges c
        where c.id::text = game.challenge_id and p.id in (
          c.challenger_1_id, c.challenger_2_id, c.challenged_1_id, c.challenged_2_id))
    ) on conflict (pause_id, recipient) do nothing;
  return jsonb_build_object('pin', paused.pin, 'dispatchToken', paused.dispatch_token,
    'pauseId', paused.id, 'recipients', (select count(*) from public.live_match_pause_emails where pause_id = paused.id));
end;
$$;

create or replace function public.resume_paused_live_match(
  p_pin text, p_device_token text, p_client_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  paused public.live_match_pauses%rowtype;
  game public.live_matches%rowtype;
  target_id uuid;
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
  select match_id into target_id from public.live_match_pauses where pin = p_pin;
  if not found then return jsonb_build_object('error', 'PIN zapasu nie je platny alebo bol zapas ukonceny.'); end if;
  -- Match first, pause second: the same lock order as pause and termination.
  select * into game from public.live_matches where id = target_id for update;
  select * into paused from public.live_match_pauses where match_id = target_id and pin = p_pin for update;
  if not found or game.finished_at is not null or game.team_a_sets >= 2 or game.team_b_sets >= 2
    or (game.set_format = 'pro_set' and greatest(game.team_a_sets, game.team_b_sets) >= 1)
  then return jsonb_build_object('error', 'PIN zapasu nie je platny alebo bol zapas ukonceny.'); end if;
  update public.live_match_pauses set resumed_at = clock_timestamp(),
    device_token_hash = encode(sha256(convert_to(p_device_token, 'UTF8')), 'hex')
    where id = paused.id;
  if game.paused_at is not null then
    update public.live_matches set
      paused_seconds = paused_seconds + greatest(0, extract(epoch from (clock_timestamp() - paused_at))),
      paused_at = null
      where id = game.id;
  end if;
  return jsonb_build_object('matchId', game.id);
end;
$$;

create or replace function public.end_live_match(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  game public.live_matches%rowtype;
  ended timestamptz := clock_timestamp();
begin
  select * into game from public.live_matches where id = p_match_id for update;
  if not found then raise exception 'Zapas sa nenasiel.'; end if;
  if not public.can_manage_live_match(game.id)
    then raise exception 'Nemas opravnenie ukoncit tento zapas.'; end if;
  if game.finished_at is not null then return jsonb_build_object('matchId', game.id); end if;
  if game.team_a_sets >= 2 or game.team_b_sets >= 2
    or (game.set_format = 'pro_set' and greatest(game.team_a_sets, game.team_b_sets) >= 1)
  then raise exception 'Zapas uz ma konecny vysledok.'; end if;
  update public.live_matches set
    ended_early_at = ended, started_at = coalesce(started_at, ended), finished_at = ended,
    paused_seconds = paused_seconds + case when paused_at is null then 0
      else greatest(0, extract(epoch from (ended - paused_at))) end,
    paused_at = null, resume_pin = null
    where id = game.id;
  return jsonb_build_object('matchId', game.id);
end;
$$;
revoke all on function public.end_live_match(uuid) from public;
grant execute on function public.end_live_match(uuid) to anon, authenticated;

-- Run as the owner so invalidation also works for anonymous scoring updates.
create or replace function public.expire_finished_match_pin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.finished_at is not null or new.team_a_sets >= 2 or new.team_b_sets >= 2
    or (new.set_format = 'pro_set' and greatest(new.team_a_sets, new.team_b_sets) >= 1)
  then
    update public.live_match_pauses set pin = null, resumed_at = coalesce(resumed_at, clock_timestamp())
      where match_id = new.id and pin is not null;
    update public.live_matches set resume_pin = null
      where id = new.id and resume_pin is not null;
  end if;
  return new;
end;
$$;
revoke all on function public.expire_finished_match_pin() from public;
drop trigger if exists expire_finished_match_pin on public.live_matches;
create trigger expire_finished_match_pin after update on public.live_matches
  for each row execute function public.expire_finished_match_pin();

-- Retire any still-reserved PINs for matches completed before this migration.
update public.live_match_pauses p set pin = null, resumed_at = coalesce(p.resumed_at, now())
  from public.live_matches m where p.match_id = m.id and p.pin is not null and (
    m.finished_at is not null or m.team_a_sets >= 2 or m.team_b_sets >= 2
    or (m.set_format = 'pro_set' and greatest(m.team_a_sets, m.team_b_sets) >= 1));

notify pgrst, 'reload schema';
commit;
