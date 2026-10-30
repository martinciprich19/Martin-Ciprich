# Správa arén

## Aktuálny rozsah

Migrácia `071_arena_admin_access.sql` vytvorí priradenie existujúceho Supabase účtu ku konkrétnej aréne a zabezpečenú správu kurtov. Správca môže pridať kurt a zapínať/vypínať ho; vypnuté kurty sa nemažú, aby zostala zachovaná história.

Oprávnenia sa vynucujú cez Supabase RLS. Správca nemôže sám priradiť účet k aréne ani spravovať inú arénu. Migrácia nemení globálnu rolu `admin`.

**Správcovský panel nemení bodovanie ani formát zápasu.** Hráči si pravidlá vyberajú priamo na kiosku.

Migrácia `072_court_scoreboards.sql` pridáva oddelené adresy pre kiosk a monitor konkrétneho kurtu:

- Kiosk pre hráčov: `/kiosk?courtId=<ID_KURTU>`
- Monitor skóre: `/scoreboard/<ID_KURTU>`

Kiosk priradí spustený zápas ku kurtu. Monitor je iba na čítanie a obnovuje skóre každých 2,5 sekundy. V paneli `/arena-admin` sa pri každom kurte zobrazia priame odkazy na obe obrazovky. Otvor kiosk odkaz na tablete kurtu a monitor odkaz na displeji; monitor môžeš prepnúť do režimu celej obrazovky.

Migrácia `073_arena_sponsor_ads.sql` pridáva správu sponzorských obrázkov a log do panelu `/arena-admin`. Správca môže nahrať PNG, JPG alebo WebP do 5 MB, nastaviť názov sponzora, čas zobrazenia 5–60 sekúnd, reklamu pozastaviť alebo odstrániť. Predvolený interval je 10 sekúnd. Obrázky sa rotujú na monitoroch arény iba vtedy, keď na danom kurte nie je živý zápas; obrazovka s výsledkom zápasu má vždy prednosť.

## Nasadenie

1. Spusti celý súbor `scripts/071_arena_admin_access.sql` v Supabase SQL Editore po migrácii `070`.
2. Spusti celý súbor `scripts/072_court_scoreboards.sql`.
3. Spusti celý súbor `scripts/073_arena_sponsor_ads.sql`.
4. Správca sa musí najprv zaregistrovať a potvrdiť e-mail.
5. V SQL Editore priraď jeho existujúci účet ku konkrétnej aréne. Nahraď e-mail a názov arény presnými hodnotami. Blok zlyhá bez zmeny, ak nenájde presne jeden účet a jednu arénu.

```sql
do $$
declare
  target_user uuid;
  target_arena bigint;
begin
  select id into target_user
  from auth.users
  where lower(email) = lower('manager@example.com');
  if target_user is null then
    raise exception 'Supabase účet sa nenašiel. Najprv ho musí vlastník vytvoriť.';
  end if;
  if (select count(*) from auth.users where lower(email) = lower('manager@example.com')) <> 1 then
    raise exception 'E-mail neidentifikuje presne jeden účet.';
  end if;

  select id into target_arena
  from public.arenas
  where lower(trim(name)) = lower(trim('Názov arény'));
  if target_arena is null then
    raise exception 'Aréna sa nenašla.';
  end if;
  if (select count(*) from public.arenas
      where lower(trim(name)) = lower(trim('Názov arény'))) <> 1 then
    raise exception 'Názov neidentifikuje presne jednu arénu; použi jej ID.';
  end if;

  insert into public.arena_admins(arena_id, user_id)
  values (target_arena, target_user)
  on conflict (arena_id, user_id) do nothing;
end;
$$;
```

Po priradení sa používateľ prihlási do aplikácie, otvorí `/arena-admin` a pridá kurt. Pri každom kurte použije kiosk odkaz na tablete a monitor odkaz na obrazovke. Ak chceš prístup odobrať, odstráň konkrétne priradenie:

```sql
delete from public.arena_admins
where arena_id = 123
  and user_id = (select id from auth.users where lower(email) = lower('manager@example.com'));
```

Monitor sa priradí ku kurtu cez svoju adresu, bez samostatného prihlasovacieho PIN-u. Stav online hardvéru, párovanie cez QR/PIN a auditovaná správa výsledkov zatiaľ nie sú súčasťou týchto migrácií.
