import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { PGlite } from '@electric-sql/pglite'
import { loadBindings, transform } from 'next/dist/build/swc/index.js'

const read = file => readFile(new URL(file, import.meta.url), 'utf8')
const owner = '00000000-0000-0000-0000-000000000011'
const manager = '00000000-0000-0000-0000-000000000012'
const stranger = '00000000-0000-0000-0000-000000000013'

test('tablets bind to one active court, retain identity during suspension and lose access on revocation', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role; create schema auth;
      create table auth.users(id uuid primary key, raw_app_meta_data jsonb not null default '{}');
      insert into auth.users values ('${owner}', '{"role":"super_admin"}'), ('${manager}', '{}'), ('${stranger}', '{}');
      create function auth.uid() returns uuid language sql as $$
        select nullif(current_setting('request.user',true),'')::uuid;
      $$;
      create function auth.jwt() returns jsonb language sql as $$
        select coalesce(nullif(current_setting('request.claims',true),'')::jsonb,'{}'::jsonb);
      $$;
      create function is_super_admin() returns boolean language sql as $$
        select coalesce(auth.jwt()->'app_metadata'->>'role' = 'super_admin',false);
      $$;
      create table arenas(id bigint primary key,is_active boolean not null,name text default 'Arena',country_code text default 'SK');
      insert into arenas(id,is_active) values (1,true),(2,true);
      create table arena_courts(id bigint primary key,arena_id bigint references arenas(id),is_active boolean not null);
      insert into arena_courts values (7,1,true),(8,1,false),(9,2,true);
      create table arena_admins(arena_id bigint,user_id uuid);
      insert into arena_admins values (1,'${manager}');
      create table live_matches(id uuid primary key, court_id bigint references arena_courts(id), country_code text default 'SK');
      create table live_match_rematches(previous_match_id uuid references live_matches(id), next_match_id uuid references live_matches(id));
      create function is_arena_admin(p_arena_id bigint) returns boolean language sql security definer as $$
        select exists(select 1 from public.arena_admins where arena_id=p_arena_id and user_id=auth.uid());
      $$;
      create function create_qr_device_match_with_settings(
        p_id uuid, p1 bigint, p2 bigint, p3 bigint, p4 bigint,
        arena text, token text, scoring text, sets text, third_set text
      ) returns uuid language plpgsql as $$
      begin
        insert into public.live_matches(id,country_code) values(p_id,case when p1=99 then 'NL' else 'SK' end);
        return p_id;
      end;
      $$;
    `)
    await db.exec(await read('076_authorized_kiosk_devices.sql'))
    await db.exec(await read('080_court_bound_kiosks.sql'))
    await db.exec(await read('081_remote_device_pairing.sql'))
    const previousMatch = '00000000-0000-0000-0000-000000000021'
    const nextMatch = '00000000-0000-0000-0000-000000000022'
    await db.query('insert into live_matches(id,court_id) values ($1,7),($2,null)', [previousMatch, nextMatch])
    await db.query('insert into live_match_rematches values ($1,$2)', [previousMatch, nextMatch])
    assert.equal((await db.query('select court_id from live_matches where id=$1', [nextMatch])).rows[0].court_id, 7)
    await db.exec('set role authenticated')
    await db.query("select set_config('request.user',$1,false)", [stranger])
    await assert.rejects(db.query("select authorize_court_kiosk_device(1,7,'Tablet',$1)", ['a'.repeat(64)]), /oprávnenie/)
    await db.query("select set_config('request.user',$1,false)", [manager])
    for (const courtId of [8, 9, null]) {
      await assert.rejects(db.query("select authorize_court_kiosk_device(1,$1,'Tablet',$2)", [courtId, 'a'.repeat(64)]), /aktívny kurt/)
    }
    const id = (await db.query("select authorize_court_kiosk_device(1,7,'Tablet',$1) as id", ['a'.repeat(64)])).rows[0].id
    await assert.rejects(db.query("select authorize_court_kiosk_device(1,7,'Second',$1)", ['b'.repeat(64)]), /už má/)
    assert.equal((await db.query('select court_id from arena_kiosk_devices')).rows[0].court_id, 7)
    await assert.rejects(db.query('select token_hash from arena_kiosk_devices'), /permission denied/)
    await db.exec('reset role; set role anon')
    assert.deepEqual((await db.query('select * from get_kiosk_device_context($1)', ['a'.repeat(64)])).rows, [{ court_id: 7, available: true }])
    assert.deepEqual((await db.query('select * from get_kiosk_device_context($1)', ['b'.repeat(64)])).rows, [])
    await assert.rejects(db.query("select authorize_court_kiosk_device(1,7,'Tablet',$1)", ['b'.repeat(64)]), /permission denied/)
    await db.exec('reset role; update arena_courts set is_active=false where id=7; set role anon')
    assert.deepEqual((await db.query('select * from get_kiosk_device_context($1)', ['a'.repeat(64)])).rows, [{ court_id: 7, available: false }])
    assert.equal((await db.query('select is_authorized_kiosk_device($1) as ok', ['a'.repeat(64)])).rows[0].ok, false)
    await db.exec('reset role; update arena_courts set is_active=true where id=7; update arenas set is_active=false where id=1; set role anon')
    assert.equal((await db.query('select * from get_kiosk_device_context($1)', ['a'.repeat(64)])).rows[0].available, false)
    await db.exec('reset role; update arenas set is_active=true where id=1; set role authenticated')
    await db.query('select revoke_kiosk_device($1)', [id])
    assert.deepEqual((await db.query('select * from get_kiosk_device_context($1)', ['a'.repeat(64)])).rows, [])

    // Super Admin authorization survives logout but not removal of the trusted role.
    await db.query("select set_config('request.user',$1,false)", [owner])
    await db.exec(`set request.claims = '{"app_metadata":{"role":"super_admin"}}'`)
    await db.query("select authorize_court_kiosk_device(2,9,'Owner tablet',$1)", ['c'.repeat(64)])
    await db.exec(`set request.claims = '{}'; reset role; set role anon`)
    assert.equal((await db.query('select * from get_kiosk_device_context($1)', ['c'.repeat(64)])).rows[0].court_id, 9)
    await db.exec(`reset role; update auth.users set raw_app_meta_data='{}' where id='${owner}'; set role anon`)
    assert.deepEqual((await db.query('select * from get_kiosk_device_context($1)', ['c'.repeat(64)])).rows, [])

    await db.exec('reset role; set role authenticated')
    await db.query("select set_config('request.user',$1,false)", [manager])
    await db.query("select authorize_kiosk_device(1,'Legacy',$1)", ['d'.repeat(64)])
    assert.deepEqual((await db.query('select * from get_kiosk_device_context($1)', ['d'.repeat(64)])).rows, [{ court_id: null, available: true }])
    await db.exec('reset role; delete from arena_admins; set role anon')
    assert.deepEqual((await db.query('select * from get_kiosk_device_context($1)', ['d'.repeat(64)])).rows, [])

    await db.exec(`reset role; insert into arena_admins values(1,'${manager}'); set role service_role`)
    await db.query('select create_device_pairing_request($1,$2,$3)', ['e'.repeat(64), 'ABCDEF12', 'test-ip'])
    await db.query('select create_device_pairing_request($1,$2,$3)', ['f'.repeat(64), 'ABCDEF34', 'test-ip'])
    await db.exec('set role authenticated')
    await db.query("select set_config('request.user',$1,false)", [stranger])
    await assert.rejects(db.query("select claim_device_pairing('ABCDEF12',1,7,'TV','scoreboard')"), /oprávnenie/)
    await db.query("select set_config('request.user',$1,false)", [manager])
    assert.deepEqual((await db.query("select claim_device_pairing('ABCDEF12',1,7,'TV','scoreboard') as result")).rows[0].result, { paired: true })
    assert.ok((await db.query("select claim_device_pairing('ABCDEF12',1,7,'TV','scoreboard') as result")).rows[0].result.error)
    assert.ok((await db.query("select claim_device_pairing('ABCDEF34',1,7,'Another TV','scoreboard') as result")).rows[0].result.error)
    assert.deepEqual((await db.query("select claim_device_pairing('ABCDEF34',1,7,'Tablet','kiosk') as result")).rows[0].result, { paired: true })
    await db.exec('set role anon')
    assert.deepEqual((await db.query('select * from get_paired_device_context($1)', ['e'.repeat(64)])).rows, [{ court_id: 7, available: true, device_role: 'scoreboard' }])
    await assert.rejects(db.query('select * from device_pairing_requests'), /permission denied/)
    await assert.rejects(db.query("select create_device_pairing_request($1,'ABCDEF56','test-ip')", ['1'.repeat(64)]), /permission denied/)
    await db.exec('set role service_role')
    await db.query("select create_device_pairing_request($1,'ABCDEF56','test-ip')", ['1'.repeat(64)])
    await db.exec("reset role; update device_pairing_requests set expires_at=now()-interval '1 second' where claimed_at is null; set role authenticated")
    assert.ok((await db.query("select claim_device_pairing('ABCDEF56',1,7,'Expired','scoreboard') as result")).rows[0].result.error)
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.ok((await db.query("select claim_device_pairing('00000000',1,7,'Missing','scoreboard') as result")).rows[0].result.error)
    }
    await assert.rejects(db.query("select claim_device_pairing('00000000',1,7,'Missing','scoreboard')"), /Príliš veľa/)
    await db.exec('reset role; set role anon')
    const qrId = '00000000-0000-0000-0000-000000000031'
    await db.query("select create_qr_court_match_with_settings($1,1,2,3,4,'Ignored','token','classic','standard','full_set',7)", [qrId])
    await db.exec('reset role')
    assert.equal((await db.query('select court_id from live_matches where id=$1', [qrId])).rows[0].court_id, 7)
    const wrongCountry = '00000000-0000-0000-0000-000000000032'
    await db.exec('set role anon')
    await assert.rejects(db.query("select create_qr_court_match_with_settings($1,99,2,3,4,'Ignored','token','classic','standard','full_set',7)", [wrongCountry]), /krajiny/)
    await db.exec('reset role')
    assert.equal((await db.query('select count(*)::int as n from live_matches where id=$1', [wrongCountry])).rows[0].n, 0)
  } finally { await db.close() }
})

test('admin claims the target code without navigating or signing out the admin device', async () => {
  await loadBindings()
  const { code } = await transform(await read('../components/arena-kiosk-devices.tsx'), {
    filename: 'arena-kiosk-devices.tsx',
    jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  })
  for (const failure of [null, 'authorize']) {
    const calls = []
    const errors = []
    const exports = {}
    let hook = 0
    const element = (type, props) => ({ type, props })
    vm.runInNewContext(code, {
      exports, AbortSignal,
      console: { error: () => {} },
      window: { location: { assign: url => calls.push(['navigate', url]) } },
      require: name => {
        if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element }
        if (name === 'react') return {
          useState: initial => {
            const index = hook++
            return [index === 1 ? 'Tablet 1' : index === 2 ? '7' : index === 3 ? 'ABCDEF12' : initial, value => { if (index === 7) errors.push(value) }]
          },
          useCallback: fn => fn, useEffect: () => {},
        }
        if (name === '@/lib/errors') return { getErrorMessage: error => error.message }
        if (name === '@/lib/notifications') return { disablePushNotifications: async () => calls.push(['disablePush']) }
        if (name === '@/lib/supabase/client') return { createClient: () => ({
          rpc: async (name, args) => {
            calls.push([name, args])
            return { data: failure ? { error: 'Kód vypršal' } : { paired: true }, error: null }
          },
          from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }),
        }) }
        throw new Error(`Unexpected import ${name}`)
      },
    })
    const tree = exports.ArenaKioskDevices({ arenaId: '1', courts: [{ id: 7, name: 'Kurt 1', is_active: true }] })
    const form = tree.props.children.find(child => child?.type === 'form')
    await form.props.onSubmit({ preventDefault() {} })
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['claim_device_pairing', {
      p_code: 'ABCDEF12', p_arena_id: '1', p_court_id: '7', p_name: 'Tablet 1', p_role: 'kiosk',
    }])
    if (!failure) {
      assert.equal(calls.length, 1)
    } else {
      assert.equal(calls.some(([action]) => action === 'navigate'), false)
      assert.ok(errors.some(error => error.length > 0))
    }
  }
})
