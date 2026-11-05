import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const owner = '00000000-0000-0000-0000-000000000001'
const receipt = '10000000-0000-0000-0000-000000000001'
const correction = '20000000-0000-0000-0000-000000000001'
const deviceA = '30000000-0000-0000-0000-000000000001'
const deviceB = '30000000-0000-0000-0000-000000000002'
const read = name => readFile(new URL(name, import.meta.url), 'utf8')

async function setup(includeEloMigration = true) {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${owner}');
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.uid',true),'')::uuid $$;
    create function auth.role() returns text language sql as $$ select current_setting('request.authrole',true) $$;
    create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;
    grant usage on schema auth to authenticated;
    create function is_super_admin() returns boolean language sql as $$ select coalesce(current_setting('request.role',true),'')='super_admin' $$;
    create function is_arena_admin(id bigint) returns boolean language sql as $$ select public.is_super_admin() or (current_setting('request.role',true)='manager' and id=1) $$;
    create table audit(action text,target_id text,details jsonb);
    create function record_super_admin_action(p_action text,p_target text,p_id text,p_details jsonb)
      returns void language sql as $$ insert into public.audit values(p_action,p_id,p_details) $$;
    create table arenas(id bigint primary key,name text,is_active boolean default true);
    create table arena_courts(id bigint primary key,arena_id bigint,name text,is_active boolean default true);
    insert into arenas(id,name) values(1,'Arena A'),(2,'Arena B');
    insert into arena_courts(id,arena_id,name) values(10,1,'Court A'),(20,2,'Court B');
    create table live_matches(id bigint primary key,court_id bigint,started_at timestamptz,finished_at timestamptz,ended_early_at timestamptz,paused_at timestamptz);
    create table arena_kiosk_devices(id uuid primary key,court_id bigint,token_hash text,revoked_at timestamptz);
    insert into arena_kiosk_devices(id,court_id,token_hash) values
      ('${deviceA}',10,encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex')),
      ('${deviceB}',20,encode(sha256(convert_to(repeat('b',64),'UTF8')),'hex'));
    create function get_paired_device_context(p_token text) returns table(court_id bigint,available boolean)
      language sql security definer as $$
        select d.court_id,c.is_active and a.is_active from public.arena_kiosk_devices d
        join public.arena_courts c on c.id=d.court_id join public.arenas a on a.id=c.arena_id
        where d.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') and d.revoked_at is null
      $$;
    create table proffiles(id bigint primary key,full_name text,email text,elo_rating integer default 1000,highest_elo integer default 1000,matches_played integer default 0,matches_won integer default 0);
    grant select,update on proffiles to authenticated;
    insert into proffiles(id,full_name) select n,'Player '||n from generate_series(1,4) n;
    create table matches(id bigint generated always as identity primary key,player1_id bigint,team1_player2_id bigint,player2_id bigint,team2_player2_id bigint,winner_id bigint,match_date timestamptz,status text,approved_profile_ids bigint[],rejected_by bigint);
  `)
  for (const migration of ['031_player_stats_from_confirmed_matches.sql','034_seasonal_and_career_elo.sql',
    '035_fix_recalculate_safeupdate.sql','086_clicker_rentals.sql','087_arena_settlements.sql',
    '088_device_reload_commands.sql',...(includeEloMigration ? ['089_manual_elo_adjustments.sql'] : [])]) await db.exec(await read(migration))
  await db.query("select set_config('request.uid',$1,false)",[owner])
  await db.exec("set request.role='super_admin'; set role authenticated")
  return db
}

test('monthly settlements support partial receipts, overpayment, retries, scoped reads and immutable void history', async () => {
  const db = await setup()
  const report = async (arena = null, month = '2026-03') => (await db.query('select arena_settlement_report($1,$2) as r',[month,arena])).rows[0].r
  const save = (id = receipt,cents = 100) => db.query('select super_admin_record_payment($1,1,$2,$3,$4,$5)',[id,'2026-03',cents,'2026-03-15','Bank transfer'])
  try {
    await db.exec('reset role')
    await db.query(`insert into clicker_rentals(id,arena_id,court_id,arena_name,court_name,duration_minutes,price_cents,owner_share_cents,created_by,created_at)
      values($1,1,10,'Arena A','Court A',120,250,125,$2,'2026-03-01 00:00 Europe/Bratislava')`,[correction,owner])
    await db.exec('set role authenticated')
    assert.equal((await report()).summary[0].due_cents,125)
    await save(); await save()
    let r = await report()
    assert.equal(r.total_count,1)
    assert.equal(r.summary[0].paid_cents,100)
    assert.equal(r.summary[0].balance_cents,25)
    await assert.rejects(save(receipt,101),/už bol použitý/)
    await save('10000000-0000-0000-0000-000000000002',50)
    r = await report()
    assert.equal(r.summary[0].balance_cents,-25,'Overpayment is explicit, never silently clamped')
    assert.equal((await report(null,'2026-04')).summary[0].paid_cents,0)
    for (const cents of [0,-1,null,100000001]) await assert.rejects(save('10000000-0000-0000-0000-000000000003',cents),/Skontroluj/)
    await assert.rejects(db.query('select super_admin_record_payment($1,1,$2,100,$3,$4)',[receipt,'2026-03','2099-12-31','Future']),/Skontroluj/)
    await assert.rejects(db.query('select super_admin_void_payment($1,$2)',[receipt,' ']),/dôvod/)
    await db.query('select super_admin_void_payment($1,$2)',[receipt,'Wrong transfer'])
    await db.query('select super_admin_void_payment($1,$2)',[receipt,'Retry reason'])
    r = await report()
    assert.equal(r.total_count,2)
    assert.equal(r.summary[0].paid_cents,50)
    assert.equal(r.summary[0].balance_cents,75)
    assert.equal(r.payments.find(p => p.id===receipt).void_reason,'Wrong transfer')
    await db.query('select void_clicker_rental($1,$2)',[correction,'Rental void'])
    assert.equal((await report()).summary[0].balance_cents,-50)
    await db.exec("set request.role='manager'")
    assert.equal((await report(1)).summary.length,1)
    await assert.rejects(report(),/oprávnenie/)
    await assert.rejects(report(2),/oprávnenie/)
    await assert.rejects(save(),/Super Admin/)
    await assert.rejects(db.query('select super_admin_void_payment($1,$2)',[receipt,'Wrong']),/Super Admin/)
    await assert.rejects(db.exec('select * from arena_payment_receipts'),/permission denied/)
    await assert.rejects(db.exec('delete from arena_payment_receipts'),/permission denied/)
    await db.exec('reset role')
    assert.equal((await db.query("select count(*)::integer as n from audit where action='payment.recorded'")).rows[0].n,2)
    assert.equal((await db.query("select count(*)::integer as n from audit where action='payment.voided'")).rows[0].n,1)
    await db.exec('set role anon')
    await assert.rejects(report(),/permission denied/)
  } finally { await db.close() }
})

test('installing ELO corrections preserves existing doubles, singles and seasonal match replay without adjustments', async () => {
  const db = await setup(false)
  try {
    await db.exec(`reset role;
      insert into matches(player1_id,team1_player2_id,player2_id,team2_player2_id,winner_id,match_date,status) values
        (1,2,3,4,1,spl_season_start(now())-interval '2 months','confirmed'),
        (1,2,3,4,3,spl_season_start(now())+interval '1 hour','approved'),
        (1,null,3,null,1,spl_season_start(now())+interval '2 hours','confirmed'),
        (1,2,3,4,null,now(),'pending'),
        (1,null,null,null,1,spl_season_start(now())+interval '8 months','confirmed');
    `)
    const before = (await db.query('select * from proffiles order by id')).rows
    const matchesBefore = (await db.query('select * from matches order by id')).rows
    await db.exec(await read('089_manual_elo_adjustments.sql'))
    await db.exec('select recalculate_player_stats()')
    assert.deepEqual((await db.query('select * from proffiles order by id')).rows,before)
    assert.deepEqual((await db.query('select * from matches order by id')).rows,matchesBefore)
  } finally { await db.close() }
})

test('reload commands are token-bound, expire, require post-delivery acknowledgement and protect active/paused matches', async () => {
  const db = await setup()
  const request = async (id=deviceA) => (await db.query('select super_admin_request_device_reload($1) as id',[id])).rows[0].id
  const poll = async (token='a'.repeat(64),ack=null) => (await db.query('select poll_device_reload($1,$2) as id',[token,ack])).rows[0].id
  try {
    const command = await request()
    assert.equal(await request(),command,'Duplicate request reuses pending command')
    await db.exec('reset role; set role anon')
    await assert.rejects(request(),/permission denied/)
    await assert.rejects(poll('c'.repeat(64)),/Neautorizované/)
    await assert.rejects(poll('b'.repeat(64),command),/nebol doručený/)
    await assert.rejects(poll('a'.repeat(64),command),/nebol doručený/)
    await db.exec('reset role')
    assert.equal((await db.query('select acknowledged_at from device_reload_commands where id=$1',[command])).rows[0].acknowledged_at,null)
    // A match starting after the admin request must block delivery too.
    await db.exec("insert into live_matches values(1,10,now(),null,null,now()); set role anon")
    assert.equal(await poll(),null)
    await db.exec("reset role; set role authenticated")
    await assert.rejects(request(),/zápas/)
    await db.exec("reset role; update live_matches set ended_early_at=now() where id=1; set role anon")
    assert.equal(await poll(),command)
    assert.equal(await poll(),command,'A lost response must not lose the command')
    await poll('a'.repeat(64),command)
    assert.equal(await poll(),null)
    await db.exec('reset role; set role authenticated')
    let status = (await db.query('select * from device_reload_commands where id=$1',[command])).rows[0]
    assert.ok(status.delivered_at && status.acknowledged_at)
    const next = await request()
    assert.notEqual(next,command)
    await db.exec("reset role; update device_reload_commands set expires_at=now()-interval '1 second' where acknowledged_at is null; set role anon")
    assert.equal(await poll(),null)
    await db.exec("reset role; update arenas set is_active=false where id=1; set role anon")
    await assert.rejects(poll(),/Neautorizované/)
    await db.exec('reset role; set role authenticated')
    await assert.rejects(request(),/pozastavené/)
    await db.exec("set request.role='manager'")
    await assert.rejects(request(),/Super Admin/)
    assert.equal((await db.query('select * from device_reload_commands')).rows.length,0)
    await db.exec("reset role; update arenas set is_active=true where id=1; update arena_kiosk_devices set revoked_at=now() where id='"+deviceA+"'; set role anon")
    await assert.rejects(poll(),/Neautorizované/)
  } finally { await db.close() }
})

test('manual ELO corrections replay chronologically, survive matches, preserve season resets and protect concurrent edits', async () => {
  const db = await setup()
  const ratings = async () => (await db.query('select id,elo_rating,career_elo,highest_elo,matches_played,matches_won from proffiles order by id')).rows
  const adjust = (id,player,expectedS,expectedC,targetS,targetC,reason='Verified correction') =>
    db.query('select super_admin_adjust_elo($1,$2,$3,$4,$5,$6,$7)',[id,player,expectedS,expectedC,targetS,targetC,reason])
  try {
    await adjust(correction,1,1000,1000,1200,1100)
    await adjust(correction,1,1000,1000,1200,1100)
    assert.equal((await db.query('select * from elo_adjustments')).rows.length,1)
    let row = (await ratings())[0]
    assert.deepEqual([row.elo_rating,row.career_elo,row.highest_elo,row.matches_played],[1200,1100,1100,0])
    await assert.rejects(adjust(correction,1,1000,1000,1300,1100),/už bol použitý/)
    await assert.rejects(adjust('20000000-0000-0000-0000-000000000002',1,1000,1000,1300,null),/medzičasom/)
    await assert.rejects(adjust('20000000-0000-0000-0000-000000000002',1,1200,1100,1200,null),/nelíši/)
    await assert.rejects(adjust('20000000-0000-0000-0000-000000000002',1,1200,1100,1300,null,' '),/dôvod/)
    await db.exec('reset role')
    await db.exec(`insert into matches(player1_id,player2_id,winner_id,match_date,status) values(1,3,1,clock_timestamp(),'confirmed')`)
    row = (await ratings())[0]
    const expectedSeasonDelta = Math.round(32*(1-1/(1+10**((1000-1200)/400))))
    const expectedCareerDelta = Math.round(32*(1-1/(1+10**((1000-1100)/400))))
    assert.equal(row.elo_rating,1200+expectedSeasonDelta)
    assert.equal(row.career_elo,1100+expectedCareerDelta)
    assert.equal(row.matches_played,1)
    assert.equal(row.matches_won,1)
    await db.exec('select recalculate_player_stats()')
    assert.deepEqual((await ratings())[0],row,'Repeated recalculation preserves the correction exactly once')
    // Move the correction into the prior season to simulate rollover.
    await db.exec("delete from matches where id is not null; update elo_adjustments set created_at=(spl_season_start(now())-interval '2 months'),season_start=spl_season_start(spl_season_start(now())-interval '2 months') where id is not null; select recalculate_player_stats()")
    row = (await ratings())[0]
    assert.equal(row.elo_rating,1000)
    assert.equal(row.career_elo,1100)
    assert.equal(row.matches_played,0)
    await db.exec('set role authenticated')
    await adjust('20000000-0000-0000-0000-000000000002',1,1000,1100,1050,null)
    row=(await ratings())[0]
    assert.equal(row.elo_rating,1050)
    assert.equal(row.career_elo,1100,'Season-only correction does not change career')
    await adjust('20000000-0000-0000-0000-000000000003',1,1050,1100,null,900)
    row=(await ratings())[0]
    assert.equal(row.elo_rating,1050)
    assert.equal(row.career_elo,900)
    assert.equal(row.highest_elo,1100,'Lowering current rating does not erase historical peak')
    assert.equal((await db.query("select * from super_admin_search_elo_players('1')")).rows.length,1)
    assert.equal((await db.query("select * from super_admin_search_elo_players('Player')")).rows.length,4)
    await db.exec("reset role; insert into matches(player1_id,player2_id,winner_id,match_date,status) values(1,3,1,now()+interval '2 hours','confirmed'); set role authenticated")
    const futureRating=(await ratings())[0]
    await assert.rejects(adjust('20000000-0000-0000-0000-000000000004',1,futureRating.elo_rating,futureRating.career_elo,1600,null),/nedosiahla/)
    assert.equal((await db.query('select * from elo_adjustments')).rows.length,3,'Failed target validation rolls the entire correction back')
    assert.deepEqual((await ratings())[0],futureRating)
    await db.exec("reset role; delete from matches where id is not null; update proffiles set elo_season_start='2000-01-01' where id=1; set role authenticated")
    const refreshed=(await db.query("select * from super_admin_search_elo_players('1')")).rows[0]
    assert.equal(refreshed.elo_rating,1050,'Search refreshes season rollover without requiring a failed edit')
    await db.exec("set request.role='manager'; set request.authrole='authenticated'")
    await assert.rejects(adjust('20000000-0000-0000-0000-000000000004',1,1050,900,1200,null),/Super Admin/)
    await assert.rejects(db.exec("select * from super_admin_search_elo_players('Player')"),/Super Admin/)
    assert.equal((await db.query('select * from elo_adjustments')).rows.length,0)
    await assert.rejects(db.exec('update proffiles set career_elo=5000 where id=1'),/ELO/)
    await assert.rejects(db.exec('delete from elo_adjustments'),/permission denied/)
    await db.exec('reset role')
    assert.equal((await db.query("select count(*)::integer as n from audit where action='elo.adjusted'")).rows[0].n,3)
    // No unsafe blanket updates may be introduced into RPC code.
    const sources = (await db.query("select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")).rows
    for (const { prosrc } of sources) for (const [sql] of prosrc.matchAll(/\b(update\s+(only\s+)?[\w.]+(\s+as\s+\w+)?\s+set\b|delete\s+from\b)[^;]*;/gis)) assert.match(sql,/\bwhere\b/i)
  } finally { await db.close() }
})
