alter table public.challenges
  add column if not exists challenger_2_accepted boolean not null default false;

create or replace function public.notify_pair_challenge_recipients()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  challenger_name text;
begin
  select coalesce(nullif(trim(profile.full_name), ''), 'Hráč')
  into challenger_name
  from public.proffiles as profile
  where profile.id::text = new.challenger_1_id::text
  limit 1;

  insert into public.notifications (user_id, sender_id, type, message, is_read, challenge_id)
  values
    (new.challenged_1_id, new.challenger_1_id, 'challenge_request', challenger_name || ' ťa pozýva na zápas. Potvrď alebo odmietni výzvu.', false, new.id::text),
    (new.challenged_2_id, new.challenger_1_id, 'challenge_request', challenger_name || ' ťa pozýva na zápas. Potvrď alebo odmietni výzvu.', false, new.id::text),
    (new.challenger_2_id, new.challenger_1_id, 'challenge_request', challenger_name || ' ťa pozýva potvrdiť účasť v spoločnej výzve.', false, new.id::text);

  return new;
end;
$$;

insert into public.notifications (user_id, sender_id, type, message, is_read, challenge_id)
select
  recipient.recipient_id,
  challenge.challenger_1_id,
  'challenge_request',
  case
    when recipient.recipient_id::text = challenge.challenger_2_id::text
      then coalesce(nullif(trim(challenger_profile.full_name), ''), 'Hráč') || ' ťa pozýva potvrdiť účasť v spoločnej výzve.'
    else coalesce(nullif(trim(challenger_profile.full_name), ''), 'Hráč') || ' ťa pozýva na zápas. Potvrď alebo odmietni výzvu.'
  end,
  false,
  challenge.id::text
from public.challenges as challenge
join public.proffiles as challenger_profile
  on challenger_profile.id::text = challenge.challenger_1_id::text
cross join lateral (
  values (challenge.challenger_2_id), (challenge.challenged_1_id), (challenge.challenged_2_id)
) as recipient(recipient_id)
where challenge.status = 'pending'
  and not exists (
    select 1
    from public.notifications as existing_notification
    where existing_notification.user_id::text = recipient.recipient_id::text
      and existing_notification.challenge_id = challenge.id::text
      and existing_notification.type in ('challenge_request', 'pair_challenge')
  );

create or replace function public.respond_to_pair_challenge(p_challenge_id text, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile_id bigint;
  challenge_row public.challenges%rowtype;
  next_first_accepted boolean;
  next_second_accepted boolean;
  next_challenger_2_accepted boolean;
  next_status text;
begin
  if auth.uid() is null then
    raise exception 'Prihlásenie je potrebné na odpoveď na výzvu.';
  end if;

  select profile.id
  into current_profile_id
  from public.proffiles as profile
  where lower(profile.email) = lower(auth.jwt() ->> 'email')
  limit 1;

  if current_profile_id is null then
    raise exception 'Profil prihláseného používateľa sa nenašiel.';
  end if;

  select *
  into challenge_row
  from public.challenges as challenge
  where challenge.id::text = p_challenge_id
  for update;

  if not found or challenge_row.status <> 'pending' then
    raise exception 'Čakajúca výzva sa nenašla.';
  end if;

  if current_profile_id::text not in (
    challenge_row.challenger_2_id::text,
    challenge_row.challenged_1_id::text,
    challenge_row.challenged_2_id::text
  ) then
    raise exception 'Na túto výzvu môže odpovedať iba jeden z troch pozvaných hráčov.';
  end if;

  if not p_accept then
    update public.challenges
    set status = 'declined'
    where id::text = p_challenge_id;
    next_status := 'declined';
  else
    next_first_accepted := challenge_row.challenged_1_accepted
      or current_profile_id::text = challenge_row.challenged_1_id::text;
    next_second_accepted := challenge_row.challenged_2_accepted
      or current_profile_id::text = challenge_row.challenged_2_id::text;
    next_challenger_2_accepted := challenge_row.challenger_2_accepted
      or current_profile_id::text = challenge_row.challenger_2_id::text;
    next_status := case
      when next_first_accepted and next_second_accepted and next_challenger_2_accepted then 'accepted'
      else 'pending'
    end;

    update public.challenges
    set challenged_1_accepted = next_first_accepted,
        challenged_2_accepted = next_second_accepted,
        challenger_2_accepted = next_challenger_2_accepted,
        status = next_status
    where id::text = p_challenge_id;
  end if;

  update public.notifications
  set is_read = true
  where challenge_id = p_challenge_id
    and type in ('challenge_request', 'pair_challenge')
    and (not p_accept or user_id::text = current_profile_id::text);

  return next_status;
end;
$$;

revoke all on function public.respond_to_pair_challenge(text, boolean) from public;
grant execute on function public.respond_to_pair_challenge(text, boolean) to authenticated;
