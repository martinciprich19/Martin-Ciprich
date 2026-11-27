-- Run after 066 and 069 on the numeric challenge/arena schema.
begin;

do $$
begin
  if to_regprocedure('public.create_challenge(bigint,bigint,bigint,bigint,timestamp with time zone,bigint)') is null then
    raise exception 'Ocakavana funkcia create_challenge s ciselnou arenou sa nenasla. Migracia bola zastavena.';
  end if;
  if not exists (
    select 1 from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where t.tgrelid = 'public.challenges'::regclass
      and not t.tgisinternal and t.tgenabled in ('O', 'A')
      and n.nspname = 'public' and p.proname = 'notify_activity_recipient'
      and (t.tgtype & 4) = 4 and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 0
  ) then
    raise exception 'Chyba aktivny trigger na vytvaranie notifikacii. Najprv spusti migraciu 066.';
  end if;
end;
$$;

-- Only remove triggers calling the identified legacy notification function.
do $$
declare legacy_trigger record;
begin
  for legacy_trigger in
    select t.tgname from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where t.tgrelid = 'public.challenges'::regclass and not t.tgisinternal
      and n.nspname = 'public' and p.proname = 'handle_new_challenge_notification'
  loop
    execute format('drop trigger %I on public.challenges', legacy_trigger.tgname);
  end loop;
end;
$$;

create or replace function public.create_challenge(
  p_challenger_1_id bigint,
  p_challenger_2_id bigint,
  p_challenged_1_id bigint,
  p_challenged_2_id bigint,
  p_match_date timestamptz,
  p_arena_id bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id bigint;
  created_challenge_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Prihlásenie je potrebné na vytvorenie výzvy.';
  end if;

  select profile.id into current_profile_id
  from public.proffiles profile
  where lower(profile.email) = lower(auth.jwt() ->> 'email')
  limit 1;
  if current_profile_id is null or current_profile_id is distinct from p_challenger_1_id then
    raise exception 'Vyzývateľ musí byť prihlásený používateľ.';
  end if;

  if p_challenger_2_id is null or p_challenged_1_id is null or p_challenged_2_id is null
    or (select count(distinct player_id) from unnest(array[
      p_challenger_1_id, p_challenger_2_id, p_challenged_1_id, p_challenged_2_id
    ]) player_id) <> 4 then
    raise exception 'Všetci štyria hráči musia byť rozdielni.';
  end if;
  if p_match_date is null or p_match_date <= now() then
    raise exception 'Termín výzvy musí byť v budúcnosti.';
  end if;
  if not exists (
    select 1 from public.pairs pair
    where (pair.player_1_id = p_challenger_1_id and pair.player_2_id = p_challenger_2_id)
       or (pair.player_1_id = p_challenger_2_id and pair.player_2_id = p_challenger_1_id)
  ) then
    raise exception 'Vyzývajúca dvojica sa nenašla.';
  end if;
  if not exists (
    select 1 from public.pairs pair
    where (pair.player_1_id = p_challenged_1_id and pair.player_2_id = p_challenged_2_id)
       or (pair.player_1_id = p_challenged_2_id and pair.player_2_id = p_challenged_1_id)
  ) then
    raise exception 'Vyzývaná dvojica sa nenašla.';
  end if;

  insert into public.challenges (
    match_date, status, challenger_1_id, challenger_2_id, challenged_1_id,
    challenged_2_id, arena_id, challenger_1_accepted, challenger_2_accepted,
    challenged_1_accepted, challenged_2_accepted
  ) values (
    p_match_date, 'pending', p_challenger_1_id, p_challenger_2_id, p_challenged_1_id,
    p_challenged_2_id, p_arena_id, true, false, false, false
  ) returning id into created_challenge_id;
  return created_challenge_id;
end;
$$;

revoke all on function public.create_challenge(bigint, bigint, bigint, bigint, timestamptz, bigint) from public, anon;
grant execute on function public.create_challenge(bigint, bigint, bigint, bigint, timestamptz, bigint) to authenticated;

update public.notifications canonical
set is_read = false
where canonical.type = 'challenge_request'
  and canonical.challenge_id is not null
  and canonical.source_activity_key = 'challenges:' || canonical.challenge_id::text
  and canonical.is_read
  and exists (
    select 1 from public.notifications old
    where old.user_id = canonical.user_id and not old.is_read
      and old.type = 'challenge_request'
      and old.challenge_id::text = canonical.challenge_id::text
      and old.source_activity_key is null
      and (
        (old.title = 'Nová výzva do zápasu' and old.message = 'Dostali ste novú výzvu. Potvrďte účasť v aplikácii.')
        or (old.title = 'Nová tímová výzva' and old.message = 'Tvoj spoluhráč ťa pridal do novej výzvy. Potvrď účasť.')
      )
  );

update public.notifications canonical
set is_read = false
where canonical.type = 'challenge_request'
  and canonical.challenge_id is not null
  and canonical.source_activity_key = 'challenges:' || canonical.challenge_id::text
  and canonical.is_read
  and exists (
    select 1 from public.notifications old
    where old.user_id = canonical.user_id and not old.is_read
      and old.type = 'challenge' and old.challenge_id is null
      and old.title = 'Nová výzva na zápas'
      and old.message = 'Boli ste vyzvaní na súboj v padele!'
      and old.created_at = canonical.created_at
      and 1 = (
        select count(*) from public.notifications candidate
        where candidate.user_id = old.user_id and candidate.created_at = old.created_at
          and candidate.type = 'challenge_request' and candidate.challenge_id is not null
          and candidate.source_activity_key = 'challenges:' || candidate.challenge_id::text
      )
  );

-- Remove only known duplicates when their canonical activity notification exists.
delete from public.notifications old
where old.type = 'challenge_request'
  and old.challenge_id is not null
  and old.source_activity_key is null
  and (
    (old.title = 'Nová výzva do zápasu' and old.message = 'Dostali ste novú výzvu. Potvrďte účasť v aplikácii.')
    or (old.title = 'Nová tímová výzva' and old.message = 'Tvoj spoluhráč ťa pridal do novej výzvy. Potvrď účasť.')
  )
  and exists (
    select 1 from public.notifications canonical
    where canonical.user_id = old.user_id
      and canonical.challenge_id::text = old.challenge_id::text
      and canonical.source_activity_key = 'challenges:' || old.challenge_id::text
      and canonical.type = 'challenge_request'
  );

-- Unlinked legacy alerts have no trustworthy challenge ID: only remove them
-- when the same recipient has exactly one canonical alert at the same timestamp.
delete from public.notifications old
where old.type = 'challenge' and old.challenge_id is null
  and old.title = 'Nová výzva na zápas'
  and old.message = 'Boli ste vyzvaní na súboj v padele!'
  and 1 = (
    select count(*) from public.notifications canonical
    where canonical.user_id = old.user_id
      and canonical.created_at = old.created_at
      and canonical.challenge_id is not null
      and canonical.source_activity_key = 'challenges:' || canonical.challenge_id::text
      and canonical.type = 'challenge_request'
  );

notify pgrst, 'reload schema';
commit;
