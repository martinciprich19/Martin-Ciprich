import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import vm from 'node:vm'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadBindings, transform } from 'next/dist/build/swc/index.js'

const user = '00000000-0000-0000-0000-000000000001'
const request90 = '10000000-0000-0000-0000-000000000001'
const request120 = '10000000-0000-0000-0000-000000000002'
const migration = new URL('086_clicker_rentals.sql', import.meta.url)

test('rental ledger enforces manager scope, immutable prices, idempotency, monthly accounting and audited voids', async () => {
  const db = new PGlite()
  const report = async (month, arena = null, offset = 0) => (await db.query('select clicker_rental_report($1,$2,$3) as data', [month, arena, offset])).rows[0].data
  const record = (id, court, duration) => db.query('select record_clicker_rental($1,$2,$3)', [id, court, duration])
  const role = name => db.query("select set_config('request.role',$1,false)", [name])
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key);
      insert into auth.users values('${user}');
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.uid',true),'')::uuid $$;
      create function public.is_super_admin() returns boolean language sql as $$ select coalesce(current_setting('request.role',true),'')='super_admin' $$;
      create function public.is_arena_admin(id bigint) returns boolean language sql as $$
        select public.is_super_admin() or (coalesce(current_setting('request.role',true),'')='arena_admin' and id=1)
      $$;
      create table arenas(id bigint primary key,name text,is_active boolean);
      create table arena_courts(id bigint primary key,arena_id bigint,name text,is_active boolean);
      insert into arenas values(1,'Arena A',true),(2,'Arena B',true),(3,'Paused',false);
      insert into arena_courts values(10,1,'Court A',true),(11,1,'Inactive',false),(20,2,'Court B',true),(30,3,'Court C',true);
    `)
    await db.exec(await readFile(migration, 'utf8'))
    await db.exec("set role anon")
    await assert.rejects(record(request90, 10, 90), /permission denied/)
    await assert.rejects(report('2026-03'), /permission denied/)
    await db.exec('reset role; set role authenticated')
    await db.query("select set_config('request.uid',$1,false)", [user])
    await role('player')
    await assert.rejects(record(request90, 10, 90), /oprávnenie/)
    await assert.rejects(report('2026-03', 1), /oprávnenie/)
    await role('arena_admin')
    await assert.rejects(report('2026-03'), /oprávnenie/)
    await assert.rejects(report('2026-03', 2), /oprávnenie/)
    await assert.rejects(record(request90, 20, 90), /oprávnenie/)
    await assert.rejects(record(request90, 999, 90), /oprávnenie/)
    await assert.rejects(record(request90, 11, 90), /aktívny/)
    await assert.rejects(record(request90, 10, 60), /90 alebo 120/)
    await assert.rejects(record(request90, 10, null), /90 alebo 120/)
    await assert.rejects(report('2026-13', 1), /Neplatný mesiac/)
    await assert.rejects(report('2026-03', 1, -1), /Neplatná strana/)
    await assert.rejects(db.exec('select * from clicker_rentals'), /permission denied/)
    await assert.rejects(db.exec('delete from clicker_rentals'), /permission denied/)
    await assert.rejects(db.exec('update clicker_rentals set price_cents=0'), /permission denied/)
    await record(request90, 10, 90)
    await record(request90, 10, 90)
    await record(request120, 10, 120)
    await assert.rejects(record(request90, 10, 120), /už bol použitý/)
    await assert.rejects(db.query('select void_clicker_rental($1,$2)', [request90, 'Omyl']), /Super Admin/)
    await db.exec('reset role')
    const stored = (await db.query('select * from clicker_rentals order by duration_minutes')).rows
    assert.equal(stored.length, 2, 'Retry does not create another charge')
    assert.deepEqual(stored.map(r => [r.duration_minutes, r.price_cents, r.owner_share_cents]), [[90,200,100],[120,250,125]])
    assert.ok(stored.every(r => r.created_by === user && Math.abs(Date.now() - r.created_at.getTime()) < 60000))
    await db.exec(`
      update clicker_rentals set created_at='2026-03-01 00:00 Europe/Bratislava';
      update arenas set name='Renamed' where id=1;
      update arena_courts set name='Renamed court' where id=10;
      insert into clicker_rentals
        (id,arena_id,court_id,arena_name,court_name,duration_minutes,price_cents,owner_share_cents,created_by,created_at)
      select ('20000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,2,20,'Arena B','Court B',90,200,100,'${user}',
        '2026-03-31 23:59:59 Europe/Bratislava'::timestamptz from generate_series(1,105) n;
      insert into clicker_rentals
        (id,arena_id,court_id,arena_name,court_name,duration_minutes,price_cents,owner_share_cents,created_by,created_at)
      values
        ('30000000-0000-0000-0000-000000000001',2,20,'Arena B','Court B',120,250,125,'${user}','2026-04-01 00:00 Europe/Bratislava'),
        ('30000000-0000-0000-0000-000000000002',2,20,'Arena B','Court B',120,250,125,'${user}','2026-02-28 23:59:59 Europe/Bratislava');
      set role authenticated;
    `)
    const own = await report('2026-03', 1)
    assert.equal(own.total_count, 2)
    assert.deepEqual(own.summary.map(r => [r.count_90,r.count_120,r.revenue_cents,r.owner_cents]), [[1,1,450,225]])
    assert.equal(own.summary[0].arena_name, 'Arena A', 'Historical names are preserved')
    await role('super_admin')
    await assert.rejects(record('40000000-0000-0000-0000-000000000001', 30, 90), /aktívny/)
    const global = await report('2026-03')
    assert.equal(global.total_count, 107)
    assert.equal(global.rentals.length, 100)
    assert.equal(global.summary.reduce((sum,r) => sum + r.owner_cents,0), 10725)
    const page2 = await report('2026-03', null, 100)
    assert.equal(page2.rentals.length, 7)
    assert.equal(new Set([...global.rentals,...page2.rentals].map(r => r.id)).size,107)
    assert.equal((await report('2026-04')).total_count, 1)
    assert.equal((await report('2026-02')).total_count, 1)
    assert.equal((await report('2025-01')).total_count, 0)
    await assert.rejects(db.query('select void_clicker_rental($1,$2)', [request90, ' ']), /dôvod/)
    await db.query('select void_clicker_rental($1,$2)', [request90, 'Duplicitné odovzdanie'])
    await db.query('select void_clicker_rental($1,$2)', [request90, 'Druhý dôvod'])
    const after = await report('2026-03',1)
    assert.equal(after.total_count, 2, 'Void preserves the record')
    assert.deepEqual(after.summary.map(r => [r.count_90,r.count_120,r.revenue_cents,r.owner_cents]), [[0,1,250,125]])
    assert.equal(after.rentals.find(r => r.id === request90).void_reason, 'Duplicitné odovzdanie')
    await db.exec('reset role')
    assert.equal((await db.query('select voided_by from clicker_rentals where id=$1',[request90])).rows[0].voided_by,user)
    await db.exec("set role authenticated; set request.uid=''")
    await assert.rejects(report('2026-03'), /oprávnenie/)
  } finally { await db.close() }
})

test('rental UI shows financial totals and restricts handover/void actions to their intended surfaces', async () => {
  await loadBindings()
  const { code } = await transform(await readFile(new URL('../components/clicker-rentals.tsx', import.meta.url), 'utf8'), {
    filename: 'clicker-rentals.tsx',
    jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  })
  const fixture = {
    summary: [{ arena_id: 1, court_id: 10, arena_name: 'Arena A', court_name: 'Court A',
      count_90: 3, count_120: 2, revenue_cents: 1100, owner_cents: 550 }],
    rentals: [{ id: request90, arena_name: 'Arena A', court_name: 'Court A', duration_minutes: 90,
      price_cents: 200, owner_share_cents: 100, created_at: '2026-03-01T10:00:00Z', created_by: user,
      voided_at: null, void_reason: null }],
    total_count: 5, as_of: '2026-03-01T10:01:00Z',
  }
  const calls = []
  let failNext = false
  let queryError
  let data = fixture
  let stateIndex = 0
  let refIndex = 0
  const states = []
  const refs = []
  const exported = {}
  vm.runInNewContext(code, {
    exports: exported, crypto: { randomUUID: () => request90 }, console: { error() {} },
    require: name => {
      if (name === 'react/jsx-runtime') return jsxRuntime
      if (name === 'react') return {
        useState: initial => {
          const index = stateIndex++
          if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
          return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
        },
        useRef: value => {
          const index = refIndex++
          return refs[index] ??= { current: value }
        },
      }
      if (name === 'swr') return () => ({ data, error: queryError, isLoading: false, mutate: async () => {} })
      if (name === '@/lib/supabase/client') return { createClient: () => ({
        rpc: async (method, args) => {
          calls.push({ method, args })
          if (failNext) { failNext = false; return { error: { message: 'Network response lost' } } }
          return { error: null }
        },
      }) }
      throw new Error(`Unexpected import: ${name}`)
    },
  })
  function tree(props) {
    stateIndex = 0
    refIndex = 0
    return exported.ClickerRentals(props)
  }
  function elements(node) {
    if (!node || typeof node !== 'object') return []
    if (Array.isArray(node)) return node.flatMap(elements)
    return [node, ...elements(node.props?.children)]
  }
  const props = { arenaId: '1', courts: [{ id: 10, name: 'Court A', is_active: true }] }
  let rendered = tree(props)
  const html = renderToStaticMarkup(rendered).replaceAll('\u00a0',' ')
  assert.match(html, /11,00 €/)
  assert.match(html, /5,50 €/)
  assert.match(html, /Zaevidovať prenájom/)
  assert.doesNotMatch(html, /Stornovať s dôvodom/)
  const superHtml = renderToStaticMarkup(tree({ superAdmin: true }))
  assert.match(superHtml, /Stornovať s dôvodom/)
  assert.doesNotMatch(superHtml, /Zaevidovať prenájom/)
  // Select court, confirm handover and retry the same form after a lost response.
  rendered = tree(props)
  elements(rendered).find(e => e.type === 'select' && e.props.value === '').props.onChange({ target: { value: '10' } })
  rendered = tree(props)
  elements(rendered).find(e => e.type === 'input' && e.props.type === 'checkbox').props.onChange({ target: { checked: true } })
  rendered = tree(props)
  failNext = true
  await elements(rendered).find(e => e.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.match(renderToStaticMarkup(tree(props)), /Network response lost/)
  rendered = tree(props)
  await elements(rendered).find(e => e.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].method, 'record_clicker_rental')
  assert.equal(JSON.stringify(calls[0].args), JSON.stringify(calls[1].args), 'Retry reuses request UUID')
  rendered = tree(props)
  assert.equal(elements(rendered).find(e => e.type === 'input' && e.props.type === 'checkbox').props.checked, false)
  assert.match(renderToStaticMarkup(rendered), /Prenájom bol zaevidovaný/)
  assert.equal(elements(rendered).find(e => e.type === 'select').props.value, '', 'New handover requires deliberate selection')
  queryError = new Error('Report unavailable')
  assert.doesNotMatch(renderToStaticMarkup(tree(props)).replaceAll('\u00a0',' '), /11,00 €/, 'Do not show financial totals when the report failed')
  queryError = undefined
  data = { ...fixture, summary: [], rentals: [], total_count: 0 }
  assert.match(renderToStaticMarkup(tree(props)), /zatiaľ nie sú evidované prenájmy/)
})
