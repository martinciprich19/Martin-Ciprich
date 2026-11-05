-- Apply after 035 and 079. Corrections participate in chronological rating replay.
begin;
create table public.elo_adjustments (
  id uuid primary key,
  player_id bigint not null references public.proffiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null references auth.users(id),
  reason text not null check(length(trim(reason)) between 3 and 500),
  season_start date not null,
  season_delta integer not null,
  career_delta integer not null,
  before_season integer not null,
  after_season integer not null,
  before_career integer not null,
  after_career integer not null,
  check(season_delta<>0 or career_delta<>0)
);
create index elo_adjustments_player_time_idx on public.elo_adjustments(player_id,created_at,id);
alter table public.elo_adjustments enable row level security;
revoke all on public.elo_adjustments from public,anon,authenticated;
grant select on public.elo_adjustments to authenticated;
create policy elo_adjustments_super_read on public.elo_adjustments for select to authenticated
  using((select public.is_super_admin()));

create or replace function public.recalculate_player_stats()
returns void language plpgsql security definer set search_path = public as $$
declare
  m record;
  team1_ids bigint[]; team2_ids bigint[];
  team1_won boolean; team1_score integer;
  career_team1 numeric; career_team2 numeric; season_team1 numeric; season_team2 numeric;
  career_delta integer; season_delta integer;
  match_season date; replay_season date;
  current_season date := public.spl_season_start(now());
  previous_flag text := coalesce(current_setting('spl.recalculating_stats',true),'');
  previous_stats_flag text := coalesce(current_setting('spl.match_stats_update',true),'');
begin
  perform pg_advisory_xact_lock(hashtext('spl.recalculate_player_stats'));
  perform set_config('spl.recalculating_stats','on',true);
  create temp table if not exists spl_rating_replay (
    id bigint primary key, base integer not null, career integer not null,
    career_highest integer not null, season integer not null, played integer not null, won integer not null
  ) on commit drop;
  truncate spl_rating_replay;
  insert into spl_rating_replay(id,base,career,career_highest,season,played,won)
    select id,coalesce(starting_elo,1000),coalesce(starting_elo,1000),coalesce(starting_elo,1000),coalesce(starting_elo,1000),0,0
    from public.proffiles;
  for m in
    select id as match_id,player1_id,team1_player2_id,player2_id,team2_player2_id,winner_id,
      match_date as event_at,elo_applied,elo_delta_team1,elo_delta_team2,career_elo_delta_team1,career_elo_delta_team2,
      null::bigint as correction_player,null::integer as correction_season,null::integer as correction_career,
      0 as kind,id::text as event_id
    from public.matches where status in ('confirmed','approved') and winner_id is not null
    union all
    select null,null,null,null,null,null,a.created_at,null,null,null,null,null,
      a.player_id,a.season_delta,a.career_delta,1,a.id::text from public.elo_adjustments a
    order by event_at nulls last,kind,match_id,event_id
  loop
    if m.kind=0 then
      team1_ids := array_remove(array[m.player1_id,m.team1_player2_id],null);
      team2_ids := array_remove(array[m.player2_id,m.team2_player2_id],null);
      if cardinality(team1_ids)=0 or cardinality(team2_ids)=0 then continue; end if;
    end if;
    match_season := public.spl_season_start(coalesce(m.event_at,now()));
    if replay_season is distinct from match_season then
      update spl_rating_replay set season=base where season is distinct from base;
      replay_season := match_season;
    end if;
    if m.kind=1 then
      update spl_rating_replay set season=season+m.correction_season,
        career=career+m.correction_career,
        career_highest=greatest(career_highest,career+m.correction_career)
        where id=m.correction_player;
      continue;
    end if;
    team1_won := m.winner_id=any(team1_ids);
    team1_score := case when team1_won then 1 else 0 end;
    select avg(career),avg(season) into career_team1,season_team1 from spl_rating_replay where id=any(team1_ids);
    select avg(career),avg(season) into career_team2,season_team2 from spl_rating_replay where id=any(team2_ids);
    career_delta := round(32*(team1_score-1/(1+power(10::numeric,(coalesce(career_team2,1000)-coalesce(career_team1,1000))/400))));
    season_delta := round(32*(team1_score-1/(1+power(10::numeric,(coalesce(season_team2,1000)-coalesce(season_team1,1000))/400))));
    update spl_rating_replay set
      career=career+case when id=any(team1_ids) then career_delta else -career_delta end,
      career_highest=greatest(career_highest,career+case when id=any(team1_ids) then career_delta else -career_delta end),
      season=season+case when id=any(team1_ids) then season_delta else -season_delta end,
      played=played+1,won=won+case when (id=any(team1_ids))=team1_won then 1 else 0 end
      where id=any(team1_ids||team2_ids);
    if not m.elo_applied or m.elo_delta_team1 is distinct from season_delta or m.elo_delta_team2 is distinct from -season_delta
      or m.career_elo_delta_team1 is distinct from career_delta or m.career_elo_delta_team2 is distinct from -career_delta then
      update public.matches set elo_applied=true,elo_delta_team1=season_delta,elo_delta_team2=-season_delta,
        career_elo_delta_team1=career_delta,career_elo_delta_team2=-career_delta where id=m.match_id;
    end if;
  end loop;
  if replay_season is distinct from current_season then
    update spl_rating_replay set season=base where season is distinct from base;
  end if;
  update public.matches set elo_applied=false,elo_delta_team1=null,elo_delta_team2=null,career_elo_delta_team1=null,career_elo_delta_team2=null
    where elo_applied and not(status in ('confirmed','approved') and winner_id is not null);
  perform set_config('spl.match_stats_update','on',true);
  update public.proffiles p set elo_rating=r.season,career_elo=r.career,highest_elo=r.career_highest,
    matches_played=r.played,matches_won=r.won,elo_season_start=current_season
    from spl_rating_replay r where p.id=r.id
      and (p.elo_rating,p.career_elo,p.highest_elo,p.matches_played,p.matches_won,p.elo_season_start)
        is distinct from (r.season,r.career,r.career_highest,r.played,r.won,current_season);
  perform set_config('spl.match_stats_update',previous_stats_flag,true);
  perform set_config('spl.recalculating_stats',previous_flag,true);
end;
$$;
revoke all on function public.recalculate_player_stats() from public,anon,authenticated;

create function public.super_admin_adjust_elo(
  p_id uuid,p_player_id bigint,p_expected_season integer,p_expected_career integer,
  p_target_season integer,p_target_career integer,p_reason text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare player public.proffiles%rowtype; existing public.elo_adjustments%rowtype;
  new_season integer; new_career integer;
begin
  if auth.uid() is null or not public.is_super_admin() then
    raise exception 'Super Admin access required' using errcode='42501';
  end if;
  if p_id is null or p_player_id is null or p_expected_season is null or p_expected_career is null
    or (p_target_season is null and p_target_career is null) or p_reason is null or length(trim(p_reason)) not between 3 and 500 then
    raise exception 'Vyber hráča, cieľové ELO a uveď dôvod (3 až 500 znakov).' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('spl.recalculate_player_stats'));
  select * into existing from public.elo_adjustments where id=p_id;
  if found then
    if (existing.player_id,existing.before_season,existing.before_career,existing.after_season,existing.after_career,existing.reason,existing.actor_id)
      is distinct from (p_player_id,p_expected_season,p_expected_career,coalesce(p_target_season,p_expected_season),coalesce(p_target_career,p_expected_career),trim(p_reason),auth.uid()) then
      raise exception 'Identifikátor úpravy už bol použitý.' using errcode='22023';
    end if;
    return p_id;
  end if;
  perform public.recalculate_player_stats();
  select * into player from public.proffiles where id=p_player_id for update;
  if not found then raise exception 'Hráč neexistuje.' using errcode='22023'; end if;
  if (player.elo_rating,player.career_elo) is distinct from (p_expected_season,p_expected_career) then
    raise exception 'ELO sa medzičasom zmenilo. Obnov hráča a skontroluj hodnoty.' using errcode='40001';
  end if;
  new_season:=coalesce(p_target_season,player.elo_rating);
  new_career:=coalesce(p_target_career,player.career_elo);
  if (new_season,new_career)=(player.elo_rating,player.career_elo) then
    raise exception 'Nové ELO sa nelíši od aktuálneho.' using errcode='22023';
  end if;
  insert into public.elo_adjustments(id,player_id,actor_id,reason,season_start,season_delta,career_delta,before_season,after_season,before_career,after_career)
  values(p_id,p_player_id,auth.uid(),trim(p_reason),public.spl_season_start(now()),
    new_season-player.elo_rating,new_career-player.career_elo,player.elo_rating,new_season,player.career_elo,new_career);
  perform public.recalculate_player_stats();
  if exists(select 1 from public.proffiles where id=p_player_id
    and (elo_rating,career_elo) is distinct from (new_season,new_career)) then
    raise exception 'Oprava nedosiahla cieľové ELO. Skontroluj budúce alebo chýbajúce dátumy potvrdených zápasov; zmena sa neuložila.' using errcode='22023';
  end if;
  perform public.record_super_admin_action('elo.adjusted','player',p_player_id::text,
    jsonb_build_object('adjustment_id',p_id,'reason',trim(p_reason),'before_season',player.elo_rating,'after_season',new_season,'before_career',player.career_elo,'after_career',new_career));
  return p_id;
end;
$$;
create function public.super_admin_search_elo_players(p_query text)
returns table(id bigint,full_name text,elo_rating integer,career_elo integer)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_super_admin() then raise exception 'Super Admin access required' using errcode='42501'; end if;
  if p_query is null or length(trim(p_query))>100 or (length(trim(p_query))<2 and trim(p_query)!~ '^[0-9]+$') then
    raise exception 'Zadaj aspoň 2 znaky mena alebo presné ID hráča (najviac 100 znakov).' using errcode='22023';
  end if;
  perform public.refresh_season_ratings();
  return query select p.id,p.full_name,p.elo_rating,p.career_elo from public.proffiles p
    where p.id::text=trim(p_query) or position(lower(trim(p_query)) in lower(p.full_name))>0
    order by p.full_name,p.id limit 30;
end;
$$;
revoke all on function public.super_admin_adjust_elo(uuid,bigint,integer,integer,integer,integer,text) from public,anon;
grant execute on function public.super_admin_adjust_elo(uuid,bigint,integer,integer,integer,integer,text) to authenticated;
revoke all on function public.super_admin_search_elo_players(text) from public,anon;
grant execute on function public.super_admin_search_elo_players(text) to authenticated;
notify pgrst,'reload schema';
commit;
