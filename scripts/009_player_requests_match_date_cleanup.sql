alter table public.player_requests
  add column if not exists match_date timestamptz;

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
    and match_date < now() - interval '1 day';

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
