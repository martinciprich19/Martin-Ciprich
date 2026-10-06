grant select on public.challenges to authenticated;

drop policy if exists "profiles read participating challenges" on public.challenges;
create policy "profiles read participating challenges" on public.challenges
  for select to authenticated
  using (
    exists (
      select 1
      from public.proffiles as profile
      where lower(profile.email) = lower(auth.jwt() ->> 'email')
        and profile.id::text in (
          challenges.challenger_1_id::text,
          challenges.challenger_2_id::text,
          challenges.challenged_1_id::text,
          challenges.challenged_2_id::text
        )
    )
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'challenges'
    ) then
    alter publication supabase_realtime add table public.challenges;
  end if;
end;
$$;