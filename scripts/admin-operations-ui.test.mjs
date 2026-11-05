import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadBindings, transform } from 'next/dist/build/swc/index.js'

const read = file => readFile(new URL(file,import.meta.url),'utf8')
function elements(node) {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(elements)
  return [node,...elements(node.props?.children)]
}
async function component(file, name, data, rpc) {
  await loadBindings()
  const { code } = await transform(await read(`../components/${file}`),{
    filename:file,jsc:{parser:{syntax:'typescript',tsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'},
  })
  const states=[],refs=[],exports={}
  let stateIndex=0,refIndex=0
  vm.runInNewContext(code,{exports,console:{error(){}},crypto:{randomUUID:()=> '10000000-0000-0000-0000-000000000001'},window:{confirm:()=>true},require: module => {
    if (module==='react/jsx-runtime') return jsxRuntime
    if (module==='react') return {
      useState: initial => {
        const index=stateIndex++
        if (!(index in states)) states[index]=typeof initial==='function'?initial():initial
        return [states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value}]
      },
      useRef: initial => refs[refIndex++] ?? (refs[refIndex-1]={current:initial}),
    }
    if (module==='swr') return ()=>({data,error:null,isLoading:false,mutate:async()=>{}})
    if (module==='@/lib/supabase/client') return {createClient:()=>({rpc})}
    throw new Error(module)
  }})
  return (props={})=>{ stateIndex=0;refIndex=0;return exports[name](props) }
}

test('settlement UI shows partial balances and credits, scopes payment controls, and retries the same receipt ID',async()=>{
  const calls=[]
  let failure=true
  const report={summary:[
    {arena_id:1,arena_name:'Arena A',due_cents:225,paid_cents:100,balance_cents:125},
    {arena_id:2,arena_name:'Arena B',due_cents:0,paid_cents:50,balance_cents:-50},
  ],payments:[],total_count:0,as_of:'2026-11-05T00:00:00Z'}
  const render=await component('arena-settlements.tsx','ArenaSettlements',report,async(name,args)=>{
    calls.push({name,args})
    if(failure){failure=false;return {error:{message:'Lost response'}}}
    return {error:null}
  })
  const props={superAdmin:true}
  let tree=render(props)
  const html=renderToStaticMarkup(tree).replaceAll('\u00a0',' ')
  assert.match(html,/1,25 €/)
  assert.match(html,/Preplatok 0,50 €/)
  assert.doesNotMatch(renderToStaticMarkup(render({arenaId:'1'})),/Potvrdiť prijatú platbu/)
  tree=render(props)
  elements(tree).find(e=>e.type==='select').props.onChange({target:{value:'1'}})
  elements(tree).find(e=>e.type==='input'&&e.props.inputMode==='decimal').props.onChange({target:{value:'12,50'}})
  elements(tree).find(e=>e.type==='input'&&e.props.minLength===3).props.onChange({target:{value:'Bank reference'}})
  tree=render(props)
  await elements(tree).find(e=>e.type==='form').props.onSubmit({preventDefault(){}})
  assert.match(renderToStaticMarkup(render(props)),/Lost response/)
  tree=render(props)
  await elements(tree).find(e=>e.type==='form').props.onSubmit({preventDefault(){}})
  assert.equal(calls[0].name,'super_admin_record_payment')
  assert.equal(calls[0].args.p_cents,1250)
  assert.equal(JSON.stringify(calls[0]),JSON.stringify(calls[1]))
  assert.match(renderToStaticMarkup(render(props)),/platba bola zaevidovaná/)
})

test('ELO UI sends expected old ratings, selected scope and reason, with an immutable correction ID',async()=>{
  const calls=[]
  const player={id:1,full_name:'Test Player',elo_rating:1000,career_elo:1050}
  const render=await component('super-admin-elo.tsx','SuperAdminElo',[],async(name,args)=>{
    calls.push({name,args})
    return {data:name==='super_admin_search_elo_players'?[player]:null,error:null}
  })
  let tree=render()
  elements(tree).find(e=>e.type==='input').props.onChange({target:{value:'Test'}})
  tree=render()
  await elements(tree).find(e=>e.type==='form').props.onSubmit({preventDefault(){}})
  tree=render()
  elements(tree).find(e=>e.type==='button'&&e.props.className?.includes('text-left')).props.onClick()
  tree=render()
  elements(tree).find(e=>e.type==='input'&&e.props.type==='number').props.onChange({target:{value:'1100'}})
  elements(tree).find(e=>e.type==='textarea').props.onChange({target:{value:'Correcting a verified issue'}})
  tree=render()
  await elements(tree).filter(e=>e.type==='form')[1].props.onSubmit({preventDefault(){}})
  const last=calls.at(-1)
  assert.equal(last.name,'super_admin_adjust_elo')
  assert.equal(last.args.p_expected_season,1000)
  assert.equal(last.args.p_expected_career,1050)
  assert.equal(last.args.p_target_season,1100)
  assert.equal(last.args.p_target_career,null)
  assert.equal(last.args.p_reason,'Correcting a verified issue')
  assert.match(renderToStaticMarkup(render()),/Oprava ELO bola uložená/)
})

test('reload listener reloads once, acknowledges only on remount and stops on unpaired devices',async()=>{
  const source=stripTypeScriptTypes(await read('../components/device-reload-listener.tsx'))
    .replace(/^import .*$/gm,'').replace(/\bexport /g,'')
  const storage=new Map(),calls=[]
  const command='10000000-0000-0000-0000-000000000001'
  let effect,interval,reloads=0
  const context={
    useEffect:callback=>{effect=callback},AbortController,
    sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    window:{setTimeout:()=>1,clearTimeout(){},setInterval:callback=>{interval=callback;return 2},clearInterval(){},location:{reload:()=>{reloads++}}},
    document:{hidden:false,addEventListener(){},removeEventListener(){}},
    console:{error(){}},fetch:async(url,options)=>{
      calls.push({url,headers:options.headers})
      return Response.json({paired:true,command:options.headers['x-riva-reload-ack']?null:command})
    },
  }
  vm.runInNewContext(`${source};DeviceReloadListener()`,context)
  const cleanup=effect()
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(reloads,1)
  interval()
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(calls.length,1,'No acknowledgement while still on the pre-reload document')
  cleanup()
  const cleanup2=effect()
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(calls[1].headers['x-riva-reload-ack'],command)
  assert.equal(storage.size,0)
  cleanup2()
  context.fetch=async()=>{calls.push({unpaired:true});return Response.json({paired:false})}
  const cleanup3=effect()
  await new Promise(resolve=>setImmediate(resolve))
  const count=calls.length
  interval()
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(calls.length,count)
  cleanup3()
})

test('reload API validates origin, device token and acknowledgement without exposing device secrets',async()=>{
  const source=stripTypeScriptTypes(await read('../app/api/device-reload/route.ts'))
    .replace(/^import .*$/gm,'').replace(/\bexport /g,'')
  const calls=[]
  let failure=null
  const POST=new Function('NextResponse','createClient','process','console',`${source};return POST`)(
    {json:Response.json},()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:null,error:failure}}}),
    {env:{NEXT_PUBLIC_SUPABASE_URL:'https://db.test',NEXT_PUBLIC_SUPABASE_ANON_KEY:'test'}},{error(){}},
  )
  function request(headers={},token='a'.repeat(64)){
    const r=new Request('https://riva.test/api/device-reload',{method:'POST',headers})
    r.nextUrl=new URL(r.url);r.cookies={get:()=>token===null?undefined:{value:token}}
    return r
  }
  assert.equal((await POST(request({origin:'https://other.test'}))).status,403)
  assert.deepEqual(await (await POST(request({},null))).json(),{paired:false})
  assert.equal((await POST(request({},'bad'))).status,401)
  assert.equal((await POST(request({'x-riva-reload-ack':'bad'}))).status,400)
  assert.equal(calls.length,0)
  assert.equal((await POST(request())).status,200)
  assert.equal(calls[0].name,'poll_device_reload')
  failure={code:'42501'}
  assert.equal((await POST(request())).status,403)
  failure={code:'22023'}
  assert.equal((await POST(request())).status,409)
  failure={code:'PGRST202'}
  assert.equal((await POST(request())).status,503)
})
