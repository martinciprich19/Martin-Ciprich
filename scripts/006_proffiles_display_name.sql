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
    dominant_hand
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
    coalesce(new.raw_user_meta_data ->> 'dominant_hand', 'right')
  )
  on conflict do nothing;

  return new;
end;
$$;
