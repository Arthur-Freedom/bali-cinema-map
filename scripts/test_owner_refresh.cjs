const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../owner-refresh.js'),'utf8');
const key='bali-cinema-owner-session',handle='remembered.'+'a'.repeat(43);
const site='https://arthur-freedom.github.io/bali-cinema-map/';
function storage(values=new Map()) {
  return {values,getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function boot({local=storage(),tab=storage(),hash='',sessionResponse}={}) {
  const elements=new Map(),events={},calls=[];
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{hidden:false,disabled:false,textContent:'',handlers:{},addEventListener(type,fn){this.handlers[type]=fn;}});
    return elements.get(id);
  };
  const location=new URL(site+hash);
  const window={location,history:{replaceState(_a,_b,path){location.href=new URL(path,site).href;}},
    addEventListener:(name,fn)=>events[name]=fn,dispatchEvent:()=>{}};
  const fetch=async(url,options)=>{
    calls.push({url,options});
    if(url==='./owner-refresh-config.json') return Response.json({serviceUrl:'https://bali-cinema-owner-refresh.honeymooninbali.workers.dev'});
    if(url.endsWith('/api/session')) return sessionResponse ? sessionResponse() : Response.json({login:'Arthur-Freedom',persistent:true});
    if(url.endsWith('/api/logout')) return Response.json({signedOut:true});
    throw Error('Unexpected request');
  };
  vm.runInNewContext(source,{window,document:{getElementById:element},location,
    localStorage:local,sessionStorage:tab,URL,URLSearchParams,fetch,AbortSignal,Event,setTimeout,Date});
  await settle();
  return {window,elements,events,calls,local,tab,location};
}
test('a remembered login survives a new tab and URL credentials are removed immediately',async()=>{
  const first=await boot({hash:'#owner-session='+handle});
  assert.equal(first.location.hash,'');
  assert.equal(first.local.getItem(key),handle);
  assert.equal(first.tab.getItem(key),null);
  const reopened=await boot({local:first.local});
  assert.equal(reopened.window.CinemaOwner.signedIn,true);
  assert.match(reopened.elements.get('owner-status').textContent,/Remembered on this device/);
});
test('temporary outages preserve sign-in and offer reconnection without OAuth',async()=>{
  let offline=true;
  const s=await boot({local:storage(new Map([[key,handle]])),sessionResponse:()=>offline
    ? Response.json({error:'Temporary outage'},{status:503})
    : Response.json({login:'Arthur-Freedom',persistent:true})});
  assert.equal(s.local.getItem(key),handle);
  assert.equal(s.elements.get('owner-login').hidden,true);
  assert.equal(s.elements.get('owner-reconnect').hidden,false);
  offline=false;
  await s.elements.get('owner-reconnect').handlers.click();
  assert.equal(s.window.CinemaOwner.signedIn,true);
});
test('only authentication rejection forgets the saved credential',async()=>{
  const s=await boot({local:storage(new Map([[key,handle]])),sessionResponse:()=>Response.json({error:'Sign in again'},{status:401})});
  assert.equal(s.local.getItem(key),null);
  assert.equal(s.elements.get('owner-login').hidden,false);
});
test('sign-out clears persistent storage and tells the service to revoke the session',async()=>{
  const s=await boot({local:storage(new Map([[key,handle]]))});
  await s.elements.get('owner-signout').handlers.click();
  assert.equal(s.local.getItem(key),null);
  assert.equal(s.window.CinemaOwner.signedIn,false);
  assert.equal(s.calls.at(-1).options.headers.Authorization,'Bearer '+handle);
});
test('signing out in another tab updates this tab without another GitHub login',async()=>{
  const s=await boot({local:storage(new Map([[key,handle]]))});
  s.events.storage({key,newValue:null});
  assert.equal(s.window.CinemaOwner.signedIn,false);
  assert.equal(s.elements.get('owner-refresh').hidden,true);
});
