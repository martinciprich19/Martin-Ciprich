alter table public.proffiles
  add column if not exists phone_visibility text not null default 'accepted_only';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'proffiles_phone_visibility_check'
       and conrelid = 'public.proffiles'::regclass
  ) then
    alter table public.proffiles
      add constraint proffiles_phone_visibility_check
      check (phone_visibility in ('everyone', 'accepted_only', 'friends_only', 'private', 'never'));
  end if;
end;
$$;