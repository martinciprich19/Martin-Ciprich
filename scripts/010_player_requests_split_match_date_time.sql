alter table public.player_requests
  add column if not exists match_date date,
  add column if not exists match_time timestamptz;

do $$
declare
  match_date_type text;
  match_time_type text;
begin
  select data_type
    into match_time_type
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'player_requests'
     and column_name = 'match_time';

  if match_time_type in ('time without time zone', 'time with time zone') then
    alter table public.player_requests
      alter column match_time type timestamptz
      using ((match_date::date + match_time::time)::timestamptz);
  end if;

  select data_type
    into match_date_type
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'player_requests'
     and column_name = 'match_date';

  if match_date_type is null then
    alter table public.player_requests add column match_date date;
  elsif match_date_type in ('timestamp with time zone', 'timestamp without time zone') then
    update public.player_requests
       set match_time = coalesce(match_time, match_date::timestamptz)
     where match_date is not null
       and match_time is null;

    alter table public.player_requests
      alter column match_date type date using match_date::date;
  end if;
end;
$$;

create extension if not exists pg_cron;

create or replace function public.delete_expired_player_requests()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count bigint;
begin
  delete from public.player_requests
   where match_date is not null
     and match_date < current_date - 1;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.delete_expired_player_requests() from public, anon, authenticated;

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'delete-expired-player-requests';

select cron.schedule(
  'delete-expired-player-requests',
  '0 * * * *',
  'select public.delete_expired_player_requests();'
);
