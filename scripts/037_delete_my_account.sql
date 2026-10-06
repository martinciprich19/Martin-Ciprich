-- 037: "Vymazať účet a dáta" – permanent self-service account deletion.
--
-- public.delete_my_account() runs for the logged-in player only and, in one transaction:
--   1. deletes the player's personal data (messages, friendships, notifications, pairs,
--      pair invitations, challenges, player requests, match listings, …),
--   2. cancels pending matches the player took part in (they can never be fully confirmed),
--   3. keeps confirmed/rejected matches for the other players' history and ELO, but
--      anonymizes the player as "Vymazaný hráč". A player without any matches is
--      deleted from proffiles completely,
--   4. deletes the Supabase Auth user, so the e-mail can register again.
-- If any step fails, nothing is deleted.
--
-- Tables are looked up at runtime, so tables/columns that don't exist are skipped and
-- columns holding either the profile id (bigint) or the auth user id (uuid) are matched.

begin;

alter table public.proffiles
  add column if not exists deleted_at timestamptz;

create or replace function public.delete_my_account()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_profile_id bigint;
  personal record;
  v_has_matches boolean;
begin
  if v_caller_id is null or v_caller_email = '' then
    raise exception 'Na vymazanie účtu musíš byť prihlásený.' using errcode = '42501';
  end if;

  select p.id into v_profile_id
  from public.proffiles as p
  where lower(p.email) = v_caller_email
  for update;

  -- Personal data: every row in these tables that points to the player is removed.
  for personal in
    select c.table_name, c.column_name
    from information_schema.columns as c
    join (values
      ('messages', 'sender_id'), ('messages', 'receiver_id'),
      ('friendships', 'user_id'), ('friendships', 'friend_id'),
      ('friendships', 'requester_id'), ('friendships', 'addressee_id'),
      ('notifications', 'user_id'), ('notifications', 'profile_id'),
      ('notification_read_receipts', 'user_profile_id'),
      ('pair_invitations', 'inviter_id'), ('pair_invitations', 'invitee_id'),
      ('pairs', 'player_1_id'), ('pairs', 'player_2_id'),
      ('challenges', 'challenger_1_id'), ('challenges', 'challenger_2_id'),
      ('challenges', 'challenged_1_id'), ('challenges', 'challenged_2_id'),
      ('pair_challenges', 'created_by'),
      ('player_requests', 'user_id'), ('player_requests', 'profile_id'),
      ('match_listings', 'user_id'), ('match_listings', 'profile_id')
    ) as target(table_name, column_name)
      on target.table_name = c.table_name and target.column_name = c.column_name
    where c.table_schema = 'public'
  loop
    execute format(
      'delete from public.%I where %I::text = any($1)',
      personal.table_name, personal.column_name
    ) using array_remove(array[v_profile_id::text, v_caller_id::text], null);
  end loop;

  if v_profile_id is not null then
    update public.matches
      set status = 'cancelled'
      where status = 'pending'
        and v_profile_id in (player1_id, player2_id, team1_player2_id, team2_player2_id);

    select exists (
      select 1 from public.matches
      where v_profile_id in (player1_id, player2_id, team1_player2_id, team2_player2_id)
         or submitted_by = v_profile_id or rejected_by = v_profile_id
    ) into v_has_matches;

    if v_has_matches then
      update public.proffiles
        set full_name = 'Vymazaný hráč',
            email = format('deleted-%s@deleted.spl.invalid', id),
            phone = '',
            bio = '',
            region = '',
            level = '',
            avatar_url = null,
            home_venue_id = null,
            auto_venue_id = null,
            phone_visibility = 'never',
            deleted_at = now()
        where id = v_profile_id;
      if exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'proffiles' and column_name = 'settings') then
        execute 'update public.proffiles set settings = ''{}''::jsonb where id = $1' using v_profile_id;
      end if;
    else
      delete from public.proffiles where id = v_profile_id;
    end if;
  end if;

  delete from auth.users where id = v_caller_id;
  return 'deleted';
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

commit;

notify pgrst, 'reload schema';
