-- One PIN entry for new challenges and saved matches. Apply after 074.
begin;

create or replace function public.resolve_kiosk_pin(
  p_pin text, p_device_token text, p_client_key text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  new_match_id uuid;
  saved_match_id uuid;
  tries integer;
  result jsonb;
begin
  if p_client_key is null or p_device_token is null or p_device_token !~ '^[a-f0-9]{64}$'
    or p_pin is null or p_pin !~ '^[0-9]{4}$'
  then return jsonb_build_object('error', 'Zadaj platný 4-miestny PIN.'); end if;

  select id into new_match_id from public.live_matches
    where match_pin = p_pin and not is_pin_activated and challenge_id is not null
      and finished_at is null and ended_early_at is null;
  select game.id into saved_match_id
    from public.live_match_pauses paused
    join public.live_matches game on game.id = paused.match_id
    where paused.pin = p_pin and game.finished_at is null and game.ended_early_at is null
      and game.team_a_sets < 2 and game.team_b_sets < 2
      and not (game.set_format = 'pro_set' and greatest(game.team_a_sets, game.team_b_sets) >= 1);

  if saved_match_id is not null and (new_match_id is null or new_match_id = saved_match_id) then
    -- The existing resume RPC checks and counts this attempt before any mutation.
    result := public.resume_paused_live_match(p_pin, p_device_token, p_client_key);
    if result ? 'error' then return result; end if;
    return result || jsonb_build_object('kind', 'resume');
  end if;

  -- New, invalid and ambiguous PINs share the existing five-attempt IP budget.
  delete from public.live_match_resume_attempts where window_started < now() - interval '1 day';
  insert into public.live_match_resume_attempts as a(client_key, attempts)
    values (p_client_key, 1)
    on conflict (client_key) do update set
      attempts = case when a.window_started < now() - interval '10 minutes' then 1 else a.attempts + 1 end,
      window_started = case when a.window_started < now() - interval '10 minutes' then now() else a.window_started end
    returning attempts into tries;
  if tries > 5 then return jsonb_build_object('error', 'Prilis vela pokusov. Skus znova o 10 minut.'); end if;
  if saved_match_id is not null and new_match_id is not null then
    -- Legacy PIN namespaces may overlap. Never open an arbitrary match.
    return jsonb_build_object('error', 'Tento PIN patrí viacerým zápasom. Kontaktuj správcu arény.');
  end if;
  if new_match_id is not null then
    return jsonb_build_object('kind', 'new');
  end if;
  return jsonb_build_object('error', 'PIN nie je platný alebo bol zápas ukončený.');
end;
$$;
revoke all on function public.resolve_kiosk_pin(text, text, text) from public, anon, authenticated;
grant execute on function public.resolve_kiosk_pin(text, text, text) to service_role;

notify pgrst, 'reload schema';
commit;