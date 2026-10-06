begin;

alter table public.proffiles
  add column if not exists gender text check (gender in ('male', 'female'));

create or replace function public.set_proffile_gender_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.gender is null then
    select case when account.raw_user_meta_data ->> 'gender' in ('male', 'female')
      then account.raw_user_meta_data ->> 'gender' else null end
    into new.gender
    from auth.users as account
    where lower(account.email) = lower(new.email)
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists proffiles_set_gender_on_insert on public.proffiles;
create trigger proffiles_set_gender_on_insert
  before insert on public.proffiles
  for each row execute function public.set_proffile_gender_on_insert();

update public.proffiles as profile
set gender = account.raw_user_meta_data ->> 'gender'
from auth.users as account
where lower(profile.email) = lower(account.email)
  and profile.gender is null
  and account.raw_user_meta_data ->> 'gender' in ('male', 'female');

revoke all on function public.set_proffile_gender_on_insert() from public;

commit;