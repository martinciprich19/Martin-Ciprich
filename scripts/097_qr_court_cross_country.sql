-- Apply after 096. QR matches on a paired court may use that court regardless
-- of the players' national league; roster membership is still validated.
begin;

create or replace function public.create_qr_court_match_with_settings(
  p_live_match_id uuid, p_team_a_player1_id bigint, p_team_a_player2_id bigint,
  p_team_b_player1_id bigint, p_team_b_player2_id bigint, p_arena_name text,
  p_device_token text, p_scoring_type text, p_set_format text, p_third_set_format text,
  p_court_id bigint
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare match_id uuid; arena_name text;
begin
  select a.name into arena_name
    from public.arena_courts c join public.arenas a on a.id = c.arena_id
    where c.id = p_court_id and c.is_active and a.is_active
    for update of c;
  if not found then raise exception 'Kurt nie je dostupný.' using errcode = '22023'; end if;
  match_id := public.create_qr_device_match_with_settings(
    p_live_match_id, p_team_a_player1_id, p_team_a_player2_id,
    p_team_b_player1_id, p_team_b_player2_id, arena_name,
    p_device_token, p_scoring_type, p_set_format, p_third_set_format
  );
  update public.live_matches set court_id = p_court_id where id = match_id;
  return match_id;
end;
$$;
revoke all on function public.create_qr_court_match_with_settings(
  uuid, bigint, bigint, bigint, bigint, text, text, text, text, text, bigint
) from public;
grant execute on function public.create_qr_court_match_with_settings(
  uuid, bigint, bigint, bigint, bigint, text, text, text, text, text, bigint
) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
