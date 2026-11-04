-- Apply after 080. Administrators claim codes without signing in on the target device.
begin;
alter table public.arena_kiosk_devices
  add column if not exists device_role text not null default 'kiosk'
    check (device_role in ('kiosk', 'scoreboard'));
grant select (device_role) on public.arena_kiosk_devices to authenticated;
create unique index if not exists one_device_per_court_role
  on public.arena_kiosk_devices(court_id, device_role)
  where revoked_at is null and court_id is not null;

create table public.device_pairing_requests (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  code_hash text not null unique,
  expires_at timestamptz not null default now() + interval '10 minutes',
  claimed_at timestamptz
);
create table public.device_pairing_attempts (
  client_key text primary key,
  attempts integer not null,
  window_started timestamptz not null default now()
);
alter table public.device_pairing_requests enable row level security;
alter table public.device_pairing_attempts enable row level security;
revoke all on public.device_pairing_requests, public.device_pairing_attempts from public, anon, authenticated;

create function public.reserve_device_pairing_attempt(p_client_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare attempts_count integer;
begin
  delete from public.device_pairing_attempts where window_started < now() - interval '1 day';
  insert into public.device_pairing_attempts as a(client_key, attempts) values(p_client_key,1)
    on conflict(client_key) do update set
      attempts = case when a.window_started < now() - interval '10 minutes' then 1 else a.attempts+1 end,
      window_started = case when a.window_started < now() - interval '10 minutes' then now() else a.window_started end
    returning attempts into attempts_count;
  if attempts_count > 10 then raise exception 'Príliš veľa pokusov. Počkaj 10 minút.' using errcode='P0001'; end if;
end;
$$;
revoke all on function public.reserve_device_pairing_attempt(text) from public, anon, authenticated;

create function public.create_device_pairing_request(p_token text, p_code text, p_client_key text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare expiry timestamptz;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_code is null
    or p_code !~ '^[A-F0-9]{8}$' or nullif(p_client_key,'') is null then
    raise exception 'Neplatná požiadavka párovania.' using errcode='22023';
  end if;
  perform public.reserve_device_pairing_attempt('create:' || p_client_key);
  delete from public.device_pairing_requests where expires_at < now() - interval '1 day';
  insert into public.device_pairing_requests(token_hash, code_hash)
    values(encode(sha256(convert_to(p_token,'UTF8')),'hex'), encode(sha256(convert_to(p_code,'UTF8')),'hex'))
    returning expires_at into expiry;
  return expiry;
end;
$$;
revoke all on function public.create_device_pairing_request(text,text,text) from public, anon, authenticated;
grant execute on function public.create_device_pairing_request(text,text,text) to service_role;

create function public.claim_device_pairing(
  p_code text, p_arena_id bigint, p_court_id bigint, p_name text, p_role text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pairing public.device_pairing_requests%rowtype; device_id uuid;
begin
  if not public.is_arena_admin(p_arena_id) then raise exception 'Nemáš oprávnenie pre túto arénu.' using errcode='42501'; end if;
  -- Return errors rather than raising after the rate counter so failed attempts persist.
  perform public.reserve_device_pairing_attempt('claim:' || auth.uid()::text);
  if p_code is null or p_code !~ '^[A-F0-9]{8}$' or p_role is null or p_role not in ('kiosk','scoreboard')
    or p_name is null or length(trim(p_name)) not between 1 and 80 then
    return jsonb_build_object('error','Vyplň kód, názov zariadenia a jeho režim.');
  end if;
  select * into pairing from public.device_pairing_requests
    where code_hash=encode(sha256(convert_to(p_code,'UTF8')),'hex') for update;
  if not found or pairing.claimed_at is not null or pairing.expires_at <= now() then
    return jsonb_build_object('error','Kód neexistuje, vypršal alebo už bol použitý.');
  end if;
  perform c.id from public.arena_courts c join public.arenas a on a.id=c.arena_id
    where c.id=p_court_id and c.arena_id=p_arena_id and c.is_active and a.is_active for update of c;
  if not found then return jsonb_build_object('error','Vyber aktívny kurt tejto arény.'); end if;
  if exists(select 1 from public.arena_kiosk_devices where court_id=p_court_id and device_role=p_role and revoked_at is null) then
    return jsonb_build_object('error','Tento kurt už má zariadenie v danom režime. Najprv odvolaj pôvodné zariadenie.');
  end if;
  insert into public.arena_kiosk_devices(arena_id,court_id,name,device_role,token_hash,authorized_by)
    values(p_arena_id,p_court_id,trim(p_name),p_role,pairing.token_hash,auth.uid()) returning id into device_id;
  update public.device_pairing_requests set claimed_at=now() where id=pairing.id;
  if public.is_super_admin() then
    perform public.record_super_admin_action('device.paired','kiosk_device',device_id::text,
      jsonb_build_object('court_id',p_court_id,'role',p_role));
  end if;
  return jsonb_build_object('paired',true);
end;
$$;
revoke all on function public.claim_device_pairing(text,bigint,bigint,text,text) from public, anon;
grant execute on function public.claim_device_pairing(text,bigint,bigint,text,text) to authenticated;

create function public.get_paired_device_context(p_token text)
returns table(court_id bigint, available boolean, device_role text)
language sql stable security definer set search_path = '' as $$
  select context.court_id, context.available, device.device_role
    from public.get_kiosk_device_context(p_token) context
    join public.arena_kiosk_devices device
      on device.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
$$;
revoke all on function public.get_paired_device_context(text) from public;
grant execute on function public.get_paired_device_context(text) to anon, authenticated;

create function public.create_qr_court_match_with_settings(
  p_live_match_id uuid, p_team_a_player1_id bigint, p_team_a_player2_id bigint,
  p_team_b_player1_id bigint, p_team_b_player2_id bigint, p_arena_name text,
  p_device_token text, p_scoring_type text, p_set_format text, p_third_set_format text,
  p_court_id bigint
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare match_id uuid; arena_name text; arena_country text;
begin
  select a.name, a.country_code into arena_name, arena_country
    from public.arena_courts c join public.arenas a on a.id=c.arena_id
    where c.id=p_court_id and c.is_active and a.is_active for update of c;
  if not found then raise exception 'Kurt nie je dostupný.' using errcode='22023'; end if;
  match_id := public.create_qr_device_match_with_settings(
    p_live_match_id,p_team_a_player1_id,p_team_a_player2_id,p_team_b_player1_id,p_team_b_player2_id,
    arena_name,p_device_token,p_scoring_type,p_set_format,p_third_set_format);
  if not exists(select 1 from public.live_matches where id=match_id and country_code=arena_country) then
    raise exception 'Hráči nepatria do krajiny tohto kurtu.' using errcode='22023';
  end if;
  update public.live_matches set court_id=p_court_id where id=match_id;
  return match_id;
end;
$$;
revoke all on function public.create_qr_court_match_with_settings(uuid,bigint,bigint,bigint,bigint,text,text,text,text,text,bigint) from public;
grant execute on function public.create_qr_court_match_with_settings(uuid,bigint,bigint,bigint,bigint,text,text,text,text,text,bigint) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
