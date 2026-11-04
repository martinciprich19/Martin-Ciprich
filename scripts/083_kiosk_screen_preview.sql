-- Apply after 081. Private, on-demand snapshots from the assigned Android tablet.
begin;
create table public.kiosk_screen_previews (
  device_id uuid primary key references public.arena_kiosk_devices(id) on delete cascade,
  requested_at timestamptz not null default now(),
  captured_at timestamptz,
  image_base64 text
);
alter table public.kiosk_screen_previews enable row level security;
revoke all on public.kiosk_screen_previews from public, anon, authenticated;

create function public.kiosk_preview_device(p_token text)
returns uuid language sql stable security definer set search_path = '' as $$
  select d.id from public.arena_kiosk_devices d
  join public.get_paired_device_context(p_token) c on c.court_id = d.court_id
  where d.token_hash = encode(sha256(convert_to(p_token,'UTF8')),'hex')
    and d.revoked_at is null and d.device_role = 'kiosk'
    and c.device_role = 'kiosk' and c.available;
$$;
revoke all on function public.kiosk_preview_device(text) from public, anon, authenticated;

create function public.kiosk_preview_requested(p_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.kiosk_screen_previews
    where device_id = public.kiosk_preview_device(p_token)
      and requested_at > now() - interval '10 seconds');
$$;
create function public.publish_kiosk_preview(p_token text, p_image text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_device_id uuid;
begin
  v_device_id := public.kiosk_preview_device(p_token);
  if v_device_id is null then
    raise exception 'Neautorizované zariadenie.' using errcode='42501';
  end if;
  if p_image is null or length(p_image) not between 100 and 550000
    or p_image !~ '^/9j/[A-Za-z0-9+/=]+$' then
    raise exception 'Neplatný obrázok náhľadu.' using errcode='22023';
  end if;
  update public.kiosk_screen_previews set image_base64 = p_image, captured_at = now()
    where device_id = v_device_id
      and requested_at > now() - interval '10 seconds'
      and (captured_at is null or captured_at < now() - interval '1 second');
  if not found then
    raise exception 'Náhľad nie je vyžiadaný alebo je odoslaný príliš často.' using errcode='55000';
  end if;
end;
$$;
create function public.request_kiosk_preview(p_court_id bigint)
returns table(device_name text, captured_at timestamptz, image_base64 text)
language plpgsql security definer set search_path = '' as $$
declare device public.arena_kiosk_devices%rowtype;
begin
  if not exists(select 1 from public.arena_courts c
    where c.id=p_court_id and public.is_arena_admin(c.arena_id)) then
    raise exception 'Nemáš oprávnenie pre tento kurt.' using errcode='42501';
  end if;
  select d.* into device from public.arena_kiosk_devices d
    join public.arena_courts c on c.id=d.court_id and c.is_active
    join public.arenas a on a.id=d.arena_id and a.is_active
    where d.court_id=p_court_id and d.device_role='kiosk' and d.revoked_at is null
      and exists(select 1 from auth.users owner where owner.id=d.authorized_by
        and (owner.raw_app_meta_data->>'role'='super_admin' or exists(
          select 1 from public.arena_admins m where m.arena_id=d.arena_id and m.user_id=owner.id)));
  if not found then return; end if;
  insert into public.kiosk_screen_previews(device_id, requested_at)
    values(device.id, now()) on conflict(device_id) do update set requested_at=excluded.requested_at;
  return query select device.name, p.captured_at,
    case when p.captured_at > now() - interval '10 seconds' then p.image_base64 else null end
    from public.kiosk_screen_previews p where p.device_id=device.id;
end;
$$;
revoke all on function public.kiosk_preview_requested(text), public.publish_kiosk_preview(text,text) from public;
grant execute on function public.kiosk_preview_requested(text), public.publish_kiosk_preview(text,text) to anon, authenticated;
revoke all on function public.request_kiosk_preview(bigint) from public, anon;
grant execute on function public.request_kiosk_preview(bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
