create or replace function public.create_challenge(
  p_challenger_1_id bigint,
  p_challenger_2_id bigint,
  p_challenged_1_id bigint,
  p_challenged_2_id bigint,
  p_match_date timestamptz,
  p_arena_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id bigint;
  created_challenge_id text;
begin
  if auth.uid() is null then
    raise exception 'Prihlásenie je potrebné na vytvorenie výzvy.';
  end if;

  select profile.id
  into current_profile_id
  from public.proffiles as profile
  where lower(profile.email) = lower(auth.jwt() ->> 'email')
  limit 1;

  if current_profile_id is null or current_profile_id <> p_challenger_1_id then
    raise exception 'Vyzývateľ musí byť prihlásený používateľ.';
  end if;

  if p_challenger_1_id = p_challenger_2_id
    or p_challenger_1_id = p_challenged_1_id
    or p_challenger_1_id = p_challenged_2_id
    or p_challenger_2_id = p_challenged_1_id
    or p_challenger_2_id = p_challenged_2_id
    or p_challenged_1_id = p_challenged_2_id then
    raise exception 'Všetci štyria hráči musia byť rozdielni.';
  end if;

  if p_match_date is null or p_match_date <= now() then
    raise exception 'Termín výzvy musí byť v budúcnosti.';
  end if;

  if not exists (
    select 1
    from public.pairs as pair
    where (pair.player_1_id = p_challenger_1_id and pair.player_2_id = p_challenger_2_id)
      or (pair.player_1_id = p_challenger_2_id and pair.player_2_id = p_challenger_1_id)
  ) then
    raise exception 'Vyzývajúca dvojica sa nenašla.';
  end if;

  if not exists (
    select 1
    from public.pairs as pair
    where (pair.player_1_id = p_challenged_1_id and pair.player_2_id = p_challenged_2_id)
      or (pair.player_1_id = p_challenged_2_id and pair.player_2_id = p_challenged_1_id)
  ) then
    raise exception 'Vyzývaná dvojica sa nenašla.';
  end if;

  insert into public.challenges (
    challenger_1_id,
    challenger_2_id,
    challenged_1_id,
    challenged_2_id,
    arena_id,
    match_date,
    status
  )
  values (
    p_challenger_1_id,
    p_challenger_2_id,
    p_challenged_1_id,
    p_challenged_2_id,
    p_arena_id,
    p_match_date,
    'pending'
  )
  returning id::text into created_challenge_id;

  return created_challenge_id;
end;
$$;

revoke all on function public.create_challenge(bigint, bigint, bigint, bigint, timestamptz, uuid) from public;
grant execute on function public.create_challenge(bigint, bigint, bigint, bigint, timestamptz, uuid) to authenticated;
