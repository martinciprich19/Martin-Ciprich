import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const read = file => readFile(new URL(file,import.meta.url),'utf8')
const alice = '11111111-1111-4111-8111-111111111111'
const bob = '22222222-2222-4222-8222-222222222222'

test('Firebase recipient resolution enforces each category, all devices, account scope and opt-in defaults',async()=>{
  const db=new PGlite()
  const tokens=async type => {
    await db.query("update notifications set type=$1 where id='event'",[type])
    await db.exec('set role service_role')
    try { return (await db.query("select push_notification_tokens('event') as token")).rows.map(r=>r.token) }
    finally { await db.exec('reset role') }
  }
  try {
    await db.exec(`
      create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.uid',true),'')::uuid $$;
      create table auth.users(id uuid primary key,email text);
      create table proffiles(id bigint primary key,email text,settings jsonb default '{}');
      create table notifications(id text primary key,user_id text,type text);
      insert into auth.users values('${alice}','alice@test.invalid'),('${bob}','bob@test.invalid');
      insert into proffiles values(1,'alice@test.invalid','{"bio":"keep"}'),(2,'bob@test.invalid','{}');
      insert into notifications values('event','1','message');
    `)
    await db.exec(await read('049_web_push_notifications.sql'))
    await db.exec(await read('090_push_notification_preferences.sql'))
    await db.exec(`insert into user_push_tokens(token,user_id) values
      ('alice-device-one-token-123456','${alice}'),('alice-device-two-token-123456','${alice}'),('bob-device-one-token-123456','${bob}')`)
    for (const type of ['challenge_request','pair_challenge','challenge_team_accepted','message','new_message','direct_message','match_finished','match_paused','friend_request','pair_invitation']) assert.equal((await tokens(type)).length,2,type)
    for (const type of ['news','league_news','tournament','tournament_invite','tournament_invitation','announcement','system_announcement']) assert.equal((await tokens(type)).length,0,`${type} requires opt-in`)
    await db.query("select set_config('request.uid',$1,false)",[alice])
    await db.exec('set role authenticated')
    await db.query("select set_my_push_category('emailChallenges',false)")
    await db.query("select set_my_push_category('emailMessages',false)")
    await db.query("select set_my_push_category('emailTournaments',true)")
    await assert.rejects(db.query("select set_my_push_category('pushAlerts',false)"),/kategória/)
    await assert.rejects(db.query("select set_my_push_category('emailMessages',null)"),/kategória/)
    await assert.rejects(db.query("select push_notification_tokens('event')"),/permission denied/)
    await db.exec('reset role')
    const profiles=(await db.query('select * from proffiles order by id')).rows
    assert.equal(profiles[0].settings.bio,'keep','Category update must preserve unrelated settings')
    assert.deepEqual(profiles[1].settings,{},'Only the authenticated account is modified')
    for (const type of ['challenge_request','pair_challenge','challenge_team_accepted','message','new_message','direct_message']) assert.equal((await tokens(type)).length,0,type)
    for (const type of ['news','league_news','tournament','tournament_invite','tournament_invitation','announcement','match_finished','match_paused','friend_request','pair_invitation','system_announcement']) assert.equal((await tokens(type)).length,2,type)
    await db.exec(`update notifications set user_id='${alice}' where id='event'`)
    assert.equal((await tokens('message')).length,0,'Legacy auth UUID recipients also respect preferences')
    await db.exec("update notifications set user_id=null where id='event'")
    assert.equal((await tokens('news')).length,2,'Broadcast selects only opted-in accounts')
    assert.equal((await tokens('message')).length,1,'Broadcast still applies private account preferences')
    await db.exec('set role authenticated')
    await db.query("select set_my_push_category('emailChallenges',true)")
    await db.query("select set_my_push_category('emailMessages',true)")
    await db.exec('reset role')
    for (const type of ['challenge_request','message']) assert.equal((await tokens(type)).length,3,`${type} can be re-enabled`)
    await db.exec('set role authenticated')
    await db.query("select set_my_push_category('emailTournaments',false)")
    await db.exec('reset role')
    assert.equal((await tokens('system_announcement')).length,0,'League announcements can be disabled again')
    await db.exec('set role authenticated')
    await db.query("select set_my_push_category('emailTournaments',true)")
    await db.exec('reset role')
    await db.exec(`update proffiles set settings=settings||'{"pushAlerts":false}' where id=1`)
    assert.equal((await tokens('news')).length,0,'Master disable overrides category opt-in')
    await db.exec('set role anon')
    await assert.rejects(db.query("select set_my_push_category('emailMessages',true)"),/permission denied/)
    await db.exec("reset role; set role authenticated; set request.uid=''")
    await assert.rejects(db.query("select set_my_push_category('emailMessages',true)"),/Prihlásenie/)
  } finally { await db.close() }
})

test('settings switches save immediately, serialize requests and retain state on failure',async()=>{
  const source=await read('../app/profile/page.tsx')
  const update=source.slice(source.indexOf('  const update = (key: string, value: unknown) => {'),source.indexOf('  const toggleSlot ='))
    .replace('(key: string, value: unknown)','(key, value)')
  let settings={emailChallenges:true,emailMessages:true,emailTournaments:false}
  let resolve
  let saving=false
  const alerts=[],calls=[]
  const context={
    categoryLock:{current:false},setSavingCategory:value=>{saving=value},
    setSettings:fn=>{settings=fn(settings)},
    createClient:()=>({rpc:(name,args)=>{calls.push({name,args});return new Promise(done=>{resolve=done})}}),
    console:{error(){}},window:{alert:message=>alerts.push(message)},getErrorMessage:()=> 'Save failed',t:text=>text,
  }
  vm.createContext(context)
  vm.runInContext(`${update};globalThis.change=update`,context)
  context.change('emailMessages',false)
  assert.equal(saving,true)
  assert.equal(settings.emailMessages,true,'Do not show successful change before database acknowledgement')
  context.change('emailChallenges',false)
  assert.equal(calls.length,1,'No overlapping preference saves')
  resolve({error:null})
  await new Promise(done=>setImmediate(done))
  assert.equal(settings.emailMessages,false)
  assert.equal(settings.emailChallenges,true)
  assert.equal(saving,false)
  assert.equal(calls[0].name,'set_my_push_category')
  context.change('emailChallenges',false)
  resolve({error:{message:'Offline'}})
  await new Promise(done=>setImmediate(done))
  assert.equal(settings.emailChallenges,true)
  assert.equal(alerts.length,1)
  assert.equal(context.categoryLock.current,false)
})
