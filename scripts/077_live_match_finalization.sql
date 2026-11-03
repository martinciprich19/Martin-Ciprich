-- Apply after 076. Live-scored results remain correctable until exit/rematch.
begin;

alter table public.live_matches add column if not exists result_finalized_at timestamptz;
grant select (result_finalized_at) on public.live_matches to anon, authenticated;

create or replace function public.guard_finished_live_match()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.result_finalized_at is not null then
      raise exception 'Novy zapas nemoze byt definitivne ukonceny.';
    end if;
    return new;
  end if;
  if (old.result_finalized_at is not null or old.official_result_id is not null
      or old.ended_early_at is not null)
    -- Generated columns are not populated in NEW during a BEFORE trigger.
    and (to_jsonb(new) - array['resume_pin', 'status', 'is_tiebreak'])
      is distinct from (to_jsonb(old) - array['resume_pin', 'status', 'is_tiebreak']) then
    raise exception 'Vysledok je definitivne ulozeny. Zapas uz nemoze byt zmeneny.';
  end if;
  if new.result_finalized_at is distinct from old.result_finalized_at
    and current_user in ('anon', 'authenticated') then
    raise exception 'Pouzi funkciu na definitivne ukoncenie zapasu.';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_finished_live_match on public.live_matches;
create trigger guard_finished_live_match before insert or update on public.live_matches
  for each row execute function public.guard_finished_live_match();

-- The single finished-row guard now protects every score/statistics field.
drop trigger if exists guard_finished_set_statistics on public.live_matches;
drop trigger if exists guard_finished_service_games on public.live_matches;
drop trigger if exists guard_finished_tiebreak on public.live_matches;
drop trigger if exists guard_finished_point_history on public.live_matches;

create or replace function public.guard_live_scoring_rules()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.scoring_type is distinct from old.scoring_type
    or new.set_format is distinct from old.set_format
    or new.third_set_format is distinct from old.third_set_format)
    and (old.started_at is not null or old.team_a_game_score + old.team_b_game_score
      + old.team_a_games + old.team_b_games + old.team_a_sets + old.team_b_sets > 0) then
    raise exception 'Pravidla zapasu nie je mozne menit po zaciatku zapasu.';
  end if;
  return new;
end;
$$;

drop trigger if exists zz_submit_finished_qr_live_match on public.live_matches;
create trigger zz_submit_finished_qr_live_match before update on public.live_matches
  for each row when (new.result_finalized_at is not null and old.result_finalized_at is null)
  execute function public.submit_finished_qr_live_match();

drop trigger if exists expire_finished_match_pin on public.live_matches;
create trigger expire_finished_match_pin after update on public.live_matches
  for each row when (new.result_finalized_at is not null or new.ended_early_at is not null
    or new.official_result_id is not null)
  execute function public.expire_finished_match_pin();

create or replace function public.finalize_live_match(p_match_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  game public.live_matches%rowtype;
  result public.matches%rowtype;
begin
  -- Same global lock order as rating replay, before locking any result/profile rows.
  perform pg_advisory_xact_lock(hashtext('spl.recalculate_player_stats'));
  select * into game from public.live_matches where id = p_match_id for update;
  if not found then raise exception 'Zapas sa nenasiel.'; end if;
  if not public.can_manage_live_match(game.id) then
    raise exception 'Nemas opravnenie ukoncit tento zapas.';
  end if;
  if game.result_finalized_at is not null then return game.id; end if;
  if game.official_result_id is not null then
    -- Older results keep their original approval workflow.
    return game.id;
  end if;
  if game.paused_at is not null or game.ended_early_at is not null
    or game.finished_at is null or game.started_at is null
    or greatest(game.team_a_sets, game.team_b_sets) <> (case when game.set_format = 'pro_set' then 1 else 2 end) then
    raise exception 'Najprv riadne dohraj zapas.';
  end if;
  update public.live_matches set result_finalized_at = clock_timestamp()
    where id = game.id returning * into game;
  if game.qr_created_by is not null or game.challenge_id is not null then
    select * into result from public.matches where id::text = game.official_result_id for update;
    if not found or result.status <> 'pending' then
      raise exception 'Oficialny vysledok sa nepodarilo pripravit.';
    end if;
    update public.matches set status = 'confirmed' where id = result.id;
    -- Existing confirmed-result triggers recalculate seasonal/career ELO exactly once.
    delete from public.notifications where match_id = result.id::text and type = 'match_result';
  end if;
  return game.id;
end;
$$;
revoke all on function public.finalize_live_match(uuid) from public;
grant execute on function public.finalize_live_match(uuid) to anon, authenticated;

-- Preserve the existing pairing/country/idempotency logic in the same transaction.
do $$
begin
  if to_regprocedure('public.create_finalized_live_match_rematch(uuid,uuid,text,smallint[])') is null then
    alter function public.create_live_match_rematch(uuid, uuid, text, smallint[])
      rename to create_finalized_live_match_rematch;
  end if;
end;
$$;
revoke all on function public.create_finalized_live_match_rematch(uuid, uuid, text, smallint[])
  from public, anon, authenticated;
create or replace function public.create_live_match_rematch(
  p_previous_match_id uuid, p_next_match_id uuid, p_device_token text, p_team_slots smallint[]
)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  perform public.finalize_live_match(p_previous_match_id);
  return public.create_finalized_live_match_rematch(
    p_previous_match_id, p_next_match_id, p_device_token, p_team_slots);
end;
$$;
revoke all on function public.create_live_match_rematch(uuid, uuid, text, smallint[]) from public;
grant execute on function public.create_live_match_rematch(uuid, uuid, text, smallint[]) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
