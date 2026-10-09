-- Run in the Supabase SQL editor before using "Moje dvojice" deletion.
-- Only a pair member may delete it. Challenges and results reference players,
-- not the pair, and are intentionally preserved.
begin;

create or replace function public.delete_my_pair(p_pair_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Prihlásenie je potrebné na odstránenie dvojice.';
  end if;

  select id into current_profile_id
  from public.proffiles
  where lower(email) = lower(auth.jwt() ->> 'email')
  limit 1;

  if current_profile_id is null then
    raise exception 'Profil prihláseného používateľa sa nenašiel.';
  end if;

  delete from public.pairs
  where id::text = p_pair_id
    and current_profile_id in (player_1_id, player_2_id);

  if not found then
    raise exception 'Dvojica sa nenašla alebo nie si jej členom.';
  end if;
end;
$$;

revoke all on function public.delete_my_pair(text) from public, anon;
grant execute on function public.delete_my_pair(text) to authenticated;
revoke delete on public.pairs from anon, authenticated;

commit;
