alter table public.messages
  add column if not exists is_read boolean not null default true;

update public.messages
set is_read = true
where is_read is null;

alter table public.messages
  alter column is_read set not null,
  alter column is_read set default false;

create index if not exists messages_receiver_unread_idx
  on public.messages (receiver_id, is_read);

do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['messages', 'friendships'] loop
      if to_regclass(format('public.%I', table_name)) is not null
        and not exists (
          select 1
          from pg_publication_tables
          where pubname = 'supabase_realtime'
            and schemaname = 'public'
            and tablename = table_name
        )
      then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end;
$$;
