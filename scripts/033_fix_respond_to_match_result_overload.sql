-- 033: Fix "Could not choose the best candidate function between
--      respond_to_match_result(p_match_id => bigint, ...) and (p_match_id => text, ...)".
--
-- Removes every overload and recreates a single text-based version.
-- Statistics/ELO are applied by the matches triggers from migration 031.

begin;

alter table public.matches
  add column if not exists approved_profile_ids bigint[] not null default '{}',
  add column if not exists rejected_by bigint references public.proffiles(id);

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'respond_to_match_result'
  loop
    execute format('drop function %s', f.signature);
  end loop;
end $$;

create function public.respond_to_match_result(p_match_id text, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id bigint;
  match_record public.matches%rowtype;
  participant_ids bigint[];
  approved_ids bigint[];
begin
  if auth.uid() is null then raise exception 'Prihlásenie je potrebné.'; end if;
  if p_accept is null then raise exception 'Vyber potvrdenie alebo odmietnutie.'; end if;

  select id into current_profile_id from public.proffiles
    where lower(email) = lower(auth.jwt() ->> 'email') limit 1;

  select * into match_record from public.matches where id::text = p_match_id for update;
  if not found then raise exception 'Zápas sa nenašiel.'; end if;

  participant_ids := array_remove(array[
    match_record.player1_id, match_record.team1_player2_id,
    match_record.player2_id, match_record.team2_player2_id
  ], null);

  if current_profile_id is null or not (current_profile_id = any(participant_ids)) then
    raise exception 'Na výsledok môže odpovedať iba účastník zápasu.';
  end if;

  if match_record.status in ('confirmed', 'approved') then return 'confirmed'; end if;
  if match_record.status <> 'pending' then return 'rejected'; end if;

  approved_ids := coalesce(match_record.approved_profile_ids, '{}');

  if not p_accept then
    if current_profile_id = any(approved_ids) then
      raise exception 'Tento výsledok si už potvrdil.';
    end if;
    update public.matches set status = 'rejected', rejected_by = current_profile_id
      where id = match_record.id;
    return 'rejected';
  end if;

  if not (current_profile_id = any(approved_ids)) then
    approved_ids := array_append(approved_ids, current_profile_id);
  end if;

  if not (participant_ids <@ approved_ids) then
    update public.matches set approved_profile_ids = approved_ids where id = match_record.id;
    return 'pending';
  end if;

  if match_record.winner_id is null then
    raise exception 'Zápas nemá určeného víťaza.';
  end if;

  -- Last confirmation: the status change fires the stats trigger (ELO + stats).
  update public.matches set approved_profile_ids = approved_ids, status = 'confirmed'
    where id = match_record.id;
  return 'confirmed';
end;
$$;

revoke all on function public.respond_to_match_result(text, boolean) from public, anon;
grant execute on function public.respond_to_match_result(text, boolean) to authenticated;

commit;

notify pgrst, 'reload schema';
