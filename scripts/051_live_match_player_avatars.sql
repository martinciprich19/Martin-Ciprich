-- Apply after 048. Reuses profile avatars; no duplicate image storage.
begin;
create or replace function public.live_match_player_avatars(p_match_id uuid)
returns table(player_slot integer, avatar_url text)
language plpgsql security definer set search_path = public as $$
declare
  game public.live_matches%rowtype;
  roster bigint[];
begin
  select * into game from public.live_matches where id = p_match_id;
  if not found then raise exception 'Zapas sa nenasiel.'; end if;
  if game.qr_created_by is not null then
    roster := array[game.team_a_player1_id, game.team_a_player2_id,
      game.team_b_player1_id, game.team_b_player2_id];
    if coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null or not exists (
      select 1 from public.proffiles p where p.id = any(roster)
        and lower(p.email) = lower(auth.jwt() ->> 'email')
    ) then raise exception 'K zapasu nemas pristup.'; end if;
  elsif game.challenge_id is not null then
    select array[c.challenger_1_id, c.challenger_2_id, c.challenged_1_id, c.challenged_2_id]
      into roster from public.challenges c where c.id::text = game.challenge_id;
    if roster is null then raise exception 'Vyzva zapasu sa nenasla.'; end if;
    if not game.is_pin_activated and not exists (
      select 1 from public.proffiles p where p.id = any(roster)
        and auth.role() = 'authenticated'
        and auth.uid() is not null and lower(p.email) = lower(auth.jwt() ->> 'email')
    ) then raise exception 'K zapasu nemas pristup.'; end if;
  else
    return;
  end if;
  return query
    select (r.ordinality - 1)::integer, p.avatar_url
    from unnest(roster) with ordinality r(id, ordinality)
    left join public.proffiles p on p.id = r.id
    order by r.ordinality;
end;
$$;
revoke all on function public.live_match_player_avatars(uuid) from public;
grant execute on function public.live_match_player_avatars(uuid) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
