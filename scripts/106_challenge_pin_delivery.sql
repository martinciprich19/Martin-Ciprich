-- Apply after 042, 066, 069 and 105 on the numeric challenge schema.
begin;

do $$
begin
  if to_regprocedure('public.respond_to_pair_challenge(bigint,boolean)') is null
    or to_regprocedure('public.accept_challenge(bigint,bigint)') is null then
    raise exception 'Chybaju ocakavane funkcie prijatia ciselnej vyzvy. Migracia bola zastavena.';
  end if;
end;
$$;

-- Keep the existing RPC signature but use the locked, authenticated workflow
-- that creates the live match and its PIN on the final acceptance.
create or replace function public.accept_challenge(p_challenge_id bigint, p_user_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare current_profile_id bigint;
begin
  if auth.uid() is null then raise exception 'Prihlásenie je potrebné na potvrdenie výzvy.'; end if;
  select id into current_profile_id from public.proffiles
    where lower(email) = lower(auth.jwt() ->> 'email') limit 1;
  if current_profile_id is null or current_profile_id is distinct from p_user_id then
    raise exception 'ID používateľa sa nezhoduje s prihláseným profilom.';
  end if;
  return public.respond_to_pair_challenge(p_challenge_id, true);
end;
$$;
revoke all on function public.accept_challenge(bigint, bigint) from public, anon;
grant execute on function public.accept_challenge(bigint, bigint) to authenticated;

create table if not exists public.challenge_pin_emails (
  id uuid primary key default gen_random_uuid(),
  challenge_id text not null,
  recipient_profile_id bigint not null references public.proffiles(id) on delete cascade,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (challenge_id, recipient_profile_id)
);
alter table public.challenge_pin_emails enable row level security;
revoke all on public.challenge_pin_emails from public, anon, authenticated;
grant select, update on public.challenge_pin_emails to service_role;

create or replace function public.notify_challenge_match_ready()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  challenge public.challenges%rowtype;
  linked_challenge public.notifications.challenge_id%type;
  recipient bigint;
begin
  if new.challenge_id is null or new.match_pin is null then return new; end if;
  select * into challenge from public.challenges where id::text = new.challenge_id;
  if not found or challenge.status <> 'accepted' then
    raise exception 'Potvrdena vyzva pre PIN sa nenasla.';
  end if;
  linked_challenge := challenge.id::text;
  foreach recipient in array array[challenge.challenger_1_id, challenge.challenger_2_id,
    challenge.challenged_1_id, challenge.challenged_2_id] loop
    insert into public.challenge_pin_emails(challenge_id, recipient_profile_id)
      values (challenge.id::text, recipient) on conflict do nothing;
    insert into public.notifications(user_id, type, title, body, message, is_read, challenge_id, source_activity_key)
    values (recipient, 'challenge_match_ready', 'Výzva potvrdená',
      'Všetci hráči potvrdili výzvu. PIN nájdeš v detaile výzvy.',
      'Všetci hráči potvrdili výzvu. PIN nájdeš v detaile výzvy.',
      false, linked_challenge, 'challenge_match_ready:' || challenge.id::text)
    on conflict (user_id, source_activity_key) where source_activity_key is not null do nothing;
  end loop;
  return new;
end;
$$;
revoke all on function public.notify_challenge_match_ready() from public, anon, authenticated;
drop trigger if exists notify_challenge_match_ready on public.live_matches;
create trigger notify_challenge_match_ready after insert on public.live_matches
  for each row execute function public.notify_challenge_match_ready();

-- Explicit participant check: activated scoreboards may have wider read policies.
create or replace function public.get_challenge_match_pin(p_challenge_id bigint)
returns table(pin text, activated boolean)
language sql stable security definer set search_path = public as $$
  select game.match_pin, game.is_pin_activated
  from public.challenges c
  join public.proffiles p on lower(p.email) = lower(auth.jwt() ->> 'email')
  join public.live_matches game on game.challenge_id = c.id::text
  where auth.uid() is not null and c.id = p_challenge_id
    and p.id in (c.challenger_1_id, c.challenger_2_id, c.challenged_1_id, c.challenged_2_id)
    and c.status = 'accepted' and game.match_pin is not null
    and game.ended_early_at is null and game.result_finalized_at is null
    and game.official_result_id is null;
$$;
revoke all on function public.get_challenge_match_pin(bigint) from public, anon;
grant execute on function public.get_challenge_match_pin(bigint) to authenticated;

-- Repair only future challenges confirmed by all four players with no live match.
do $$
declare
  c public.challenges%rowtype;
  team_a text;
  team_b text;
  pin text;
  attempt integer;
begin
  for c in select * from public.challenges
    where status = 'confirmed' and match_date > now()
      and challenger_1_accepted and challenger_2_accepted
      and challenged_1_accepted and challenged_2_accepted
      and not exists (select 1 from public.live_matches m where m.challenge_id = challenges.id::text)
    for update
  loop
    select string_agg(coalesce(nullif(trim(full_name), ''), 'Hráč'), ' & ' order by id)
      into team_a from public.proffiles where id in (c.challenger_1_id, c.challenger_2_id);
    select string_agg(coalesce(nullif(trim(full_name), ''), 'Hráč'), ' & ' order by id)
      into team_b from public.proffiles where id in (c.challenged_1_id, c.challenged_2_id);
    if team_a is null or team_b is null then raise exception 'Profily potvrdenej vyzvy sa nenasli.'; end if;
    update public.challenges set status = 'accepted' where id = c.id;
    for attempt in 1..100 loop
      pin := lpad(floor(random() * 10000)::integer::text, 4, '0');
      insert into public.live_matches(challenge_id, match_pin, team_a_player1_name, team_b_player1_name)
        values (c.id::text, pin, team_a, team_b) on conflict do nothing;
      exit when found;
    end loop;
    if not exists (select 1 from public.live_matches m where m.challenge_id = c.id::text) then
      raise exception 'Nepodarilo sa vytvorit PIN potvrdenej vyzvy.';
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
