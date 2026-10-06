create or replace function public.accept_challenge(p_challenge_id text, p_user_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Prihlásenie je potrebné na potvrdenie výzvy.';
  end if;

  select profile.id
  into current_profile_id
  from public.proffiles as profile
  where lower(profile.email) = lower(auth.jwt() ->> 'email')
  limit 1;

  if current_profile_id is null or current_profile_id <> p_user_id then
    raise exception 'ID používateľa sa nezhoduje s prihláseným profilom.';
  end if;

  return public.respond_to_pair_challenge(p_challenge_id, true);
end;
$$;

revoke all on function public.accept_challenge(text, bigint) from public;
grant execute on function public.accept_challenge(text, bigint) to authenticated;
