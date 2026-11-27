-- Apply after the existing pairs and QR match migrations.
begin;

create or replace function public.get_qr_pair_players(p_pair_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_array(
    jsonb_build_object('id', player1.id::text, 'name', player1.full_name),
    jsonb_build_object('id', player2.id::text, 'name', player2.full_name)
  )
  from public.pairs as pair
  join public.proffiles as player1 on player1.id = pair.player_1_id
  join public.proffiles as player2 on player2.id = pair.player_2_id
  where pair.id::text = p_pair_id
    and pair.player_1_id <> pair.player_2_id
    and nullif(trim(player1.full_name), '') is not null
    and nullif(trim(player2.full_name), '') is not null
  limit 1;
$$;

revoke all on function public.get_qr_pair_players(text) from public;
grant execute on function public.get_qr_pair_players(text) to anon, authenticated;

commit;
