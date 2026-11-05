import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('court analytics count completed matches once in exact rolling periods and restrict global access', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create function public.is_super_admin() returns boolean language sql as $$
        select coalesce(current_setting('request.role',true),'')='super_admin';
      $$;
      create table arenas(id bigint primary key,name text,is_active boolean);
      create table arena_courts(id bigint primary key,arena_id bigint,name text,is_active boolean);
      create table live_matches(id bigint primary key,court_id bigint,started_at timestamptz,finished_at timestamptz,ended_early_at timestamptz);
      insert into arenas values(1,'Arena',true),(2,'Paused',false),(3,'No courts',true);
      insert into arena_courts values(10,1,'Court 1',true),(11,1,'Court 2',true),(20,2,'Paused court',false);
    `)
    await db.exec(await readFile(new URL('085_super_admin_match_analytics.sql', import.meta.url), 'utf8'))
    await db.exec('set role anon')
    await assert.rejects(db.query('select * from super_admin_match_analytics()'), /permission denied/)
    await db.exec('reset role; set role authenticated')
    for (const role of ['player', 'arena_admin', 'admin']) {
      await db.query("select set_config('request.role',$1,false)", [role])
      await assert.rejects(db.query('select * from super_admin_match_analytics()'), /Super Admin access required/)
    }
    await db.exec('reset role; begin')
    // Keep now() fixed so timestamps exactly on each boundary remain inclusive.
    await db.exec(`
      insert into live_matches values
        (1,10,now()-interval '2 hours',now(),null),
        (2,10,now()-interval '25 hours',now()-interval '24 hours',null),
        (3,10,now()-interval '8 days',now()-interval '7 days',null),
        (4,10,now()-interval '2 months',now()-interval '1 month',null),
        (5,10,now()-interval '2 years',now()-interval '1 year',null),
        (6,10,now()-interval '2 years',now()-interval '1 year 1 second',null),
        (7,10,now(),null,null),
        (8,10,now(),now(),now()),
        (9,10,null,now(),null),
        (10,10,now(),now()+interval '1 second',null),
        (11,null,now(),now(),null),
        (12,11,now()-interval '4 days',now()-interval '3 days',null),
        (13,20,now()-interval '1 hour',now(),null);
      set role authenticated;
      set request.role='super_admin';
    `)
    const rows = (await db.query('select * from super_admin_match_analytics()')).rows
    const first = rows.find(row => row.court_id === 10)
    assert.deepEqual([first.last_day,first.last_week,first.last_month,first.last_year], [2,3,4,5])
    const second = rows.find(row => row.court_id === 11)
    assert.deepEqual([second.last_day,second.last_week,second.last_month,second.last_year], [0,1,1,1])
    assert.equal(rows.find(row => row.court_id === 20).last_day, 1, 'Paused courts retain history')
    assert.equal(rows.find(row => row.arena_id === 3).last_year, 0)
    assert.equal(rows.find(row => row.arena_id === 3).court_id, null)
    assert.equal(rows.filter(row => row.arena_id === 1).reduce((sum,row) => sum + row.last_year,0), 6)
    assert.ok(rows.every(row => row.as_of.getTime() === first.as_of.getTime()))
    await db.exec('commit')
  } finally { await db.close() }
})
