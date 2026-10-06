alter table public.proffiles
  add column if not exists avatar_url text default null;

alter table public.proffiles
  alter column avatar_url set default null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'player-avatars',
  'player-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Player avatars are publicly readable" on storage.objects;
create policy "Player avatars are publicly readable"
  on storage.objects for select
  using (bucket_id = 'player-avatars');

drop policy if exists "Players upload their own avatar" on storage.objects;
create policy "Players upload their own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'player-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Players update their own avatar" on storage.objects;
create policy "Players update their own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'player-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'player-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Players delete their own avatar" on storage.objects;
create policy "Players delete their own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'player-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.create_proffile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.proffiles (
    full_name,
    email,
    phone,
    elo_rating,
    matches_played,
    matches_won,
    region,
    level,
    dominant_hand,
    avatar_url
  )
  values (
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      'Hráč'
    ),
    coalesce(new.email, ''),
    '',
    1000,
    0,
    0,
    coalesce(new.raw_user_meta_data ->> 'region', ''),
    coalesce(new.raw_user_meta_data ->> 'level', ''),
    coalesce(new.raw_user_meta_data ->> 'dominant_hand', 'right'),
    null
  )
  on conflict do nothing;

  return new;
end;
$$;
