-- Apply after 063_match_completion_and_rematch.sql.
begin;

alter table public.live_match_rematches
  add column if not exists team_slots smallint[] not null
  default array[0, 1, 2, 3]::smallint[];
update public.live_match_rematches set team_slots = array[0, 1, 2, 3]::smallint[]
  where team_slots is null;
alter table public.live_match_rematches
  alter column team_slots set default array[0, 1, 2, 3]::smallint[],
  alter column team_slots set not null;

drop function if exists public.create_live_match_rematch(uuid, uuid, text);

create or replace function public.create_live_match_rematch(
  p_previous_match_id uuid,
  p_next_match_id uuid,
  p_device_token text,
  p_team_slots smallint[]
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  game public.live_matches%rowtype;
  replay public.live_match_rematches%rowtype;
  token_hash text;
  roster_ids bigint[];
  roster_names text[];
begin
  if p_next_match_id is null or p_device_token is null or p_device_token !~ '^[a-f0-9]{64}$' then
    raise exception 'Neplatny kluc alebo ID noveho zapasu.';
  end if;
  if p_team_slots is null or coalesce(array_ndims(p_team_slots), 0) <> 1
    or coalesce(array_length(p_team_slots, 1), 0) <> 4
    or (select array_agg(slot order by slot) from unnest(p_team_slots) slot)
      is distinct from array[0::smallint, 1::smallint, 2::smallint, 3::smallint] then
    raise exception 'Vyber styroch roznych hracov do dvojic.';
  end if;

  select * into game from public.live_matches where id = p_previous_match_id for update;
  if not found then raise exception 'Predchadzajuci zapas sa nenasiel.'; end if;
  if not public.can_manage_live_match(game.id) then
    raise exception 'Nemas opravnenie vytvorit dalsi zapas.';
  end if;
  if game.ended_early_at is not null or game.finished_at is null
    or not ((game.set_format = 'pro_set' and greatest(game.team_a_sets, game.team_b_sets) >= 1)
      or greatest(game.team_a_sets, game.team_b_sets) >= 2) then
    raise exception 'Najprv riadne dohraj predchadzajuci zapas.';
  end if;
  if (game.qr_created_by is not null or game.challenge_id is not null) and not exists (
    select 1 from public.matches m where m.id::text = game.official_result_id
      and (m.status in ('confirmed', 'approved') or not exists (
        select 1 from unnest(array[game.team_a_player1_id, game.team_a_player2_id,
          game.team_b_player1_id, game.team_b_player2_id]) participant
        where participant is null or (
          not (participant::text = any(coalesce(m.approved_profile_ids::text[], '{}'::text[]))) and not exists (
            select 1 from public.notifications n where n.match_id = game.official_result_id
              and n.type = 'match_result' and n.user_id::text = participant::text
          )
        )
      ))
  ) then raise exception 'Vysledok a notifikacie pre vsetkych hracov este nie su ulozene.'; end if;

  token_hash := encode(sha256(convert_to(p_device_token, 'UTF8')), 'hex');
  select * into replay from public.live_match_rematches where previous_match_id = game.id;
  if found then
    if replay.next_match_id = p_next_match_id and replay.device_token_hash = token_hash
      and replay.team_slots = p_team_slots then
      return replay.next_match_id;
    end if;
    raise exception 'Dalsi zapas uz bol vytvoreny na inom zariadeni alebo s inym rozdelenim dvojic.';
  end if;
  if exists (select 1 from public.live_matches where id = p_next_match_id) then
    raise exception 'ID noveho zapasu uz bolo pouzite.';
  end if;

  roster_ids := array[game.team_a_player1_id, game.team_a_player2_id,
    game.team_b_player1_id, game.team_b_player2_id];
  roster_names := array[game.team_a_player1_name, game.team_a_player2_name,
    game.team_b_player1_name, game.team_b_player2_name];
  if game.qr_created_by is not null or game.challenge_id is not null then
    if (select count(distinct player_id) from unnest(roster_ids) player_id) <> 4
      or array_position(roster_ids, null) is not null then
      raise exception 'Predchadzajuci ligovy zapas nema styroch registrovanych hracov.';
    end if;
    perform public.create_qr_device_match(
      p_next_match_id,
      roster_ids[p_team_slots[1] + 1],
      roster_ids[p_team_slots[2] + 1],
      roster_ids[p_team_slots[3] + 1],
      roster_ids[p_team_slots[4] + 1],
      coalesce(nullif(game.qr_arena_name, ''), 'Zapas z vyzvy'),
      p_device_token
    );
    update public.live_matches set scoring_type = game.scoring_type,
      set_format = game.set_format, third_set_format = game.third_set_format
      where id = p_next_match_id;
  else
    insert into public.live_matches(id, team_a_player1_name, team_a_player2_name,
      team_b_player1_name, team_b_player2_name, scoring_type, set_format, third_set_format,
      serving_team, initial_server_chosen)
    values (p_next_match_id,
      roster_names[p_team_slots[1] + 1], roster_names[p_team_slots[2] + 1],
      roster_names[p_team_slots[3] + 1], roster_names[p_team_slots[4] + 1],
      game.scoring_type, game.set_format, game.third_set_format, null, false);
  end if;
  insert into public.live_match_rematches(previous_match_id, next_match_id, device_token_hash, team_slots)
    values (game.id, p_next_match_id, token_hash, p_team_slots);
  return p_next_match_id;
end;
$$;

revoke all on function public.create_live_match_rematch(uuid, uuid, text, smallint[]) from public;
grant execute on function public.create_live_match_rematch(uuid, uuid, text, smallint[]) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
