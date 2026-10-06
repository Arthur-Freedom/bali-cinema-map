import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from './worker.mjs';
import {ownerPush,internalPush,validateSubscription} from './push.mjs';

const base='https://cinema.example';
const now=()=>Date.parse('2026-10-07T05:00:00Z');
const sub={endpoint:'https://fcm.googleapis.com/test-device',keys:{p256dh:Buffer.from([4,...new Uint8Array(64)]).toString('base64url'),auth:Buffer.from(new Uint8Array(16)).toString('base64url')}};
function setup() {
  const entries=new Map();
  const env={SITE_URL:'https://arthur-freedom.github.io/bali-cinema-map/',SERVICE_ORIGIN:base,
    OWNER_LOGIN:'Arthur-Freedom',OWNER_ID:'18115558',REPO:'bali-cinema-map',REF:'main',WORKFLOW:'pages.yml',
    GITHUB_CLIENT_ID:'test',GITHUB_CLIENT_SECRET:'test',SESSION_SECRET:'s'.repeat(43),
    VAPID_PUBLIC_KEY:'public',PUSH_DISPATCH_SECRET:'d'.repeat(43),PUSH_DEVICES:{
      get:async key=>entries.has(key)?JSON.parse(entries.get(key)):null,
      put:async(key,value)=>entries.set(key,value),delete:async key=>entries.delete(key),
      list:async()=>({keys:[...entries.keys()].map(name=>({name}))})}};
  const request=(path,data,token=env.PUSH_DISPATCH_SECRET)=>new Request(base+path,{
    method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
    body:data===undefined?undefined:JSON.stringify(data)});
  return {env,entries,request};
}
test('only owner-authenticated routes can register a device; internal secret is separate',async()=>{
  const {env,entries,request}=setup();
  const handler=createHandler({now,fetch:async()=>{throw new Error('Must not fetch');}});
  const noSession=new Request(base+'/api/push/subscribe',{method:'POST',headers:{Origin:new URL(env.SITE_URL).origin,'Content-Type':'application/json'},body:JSON.stringify({subscription:sub})});
  assert.equal((await handler(noSession,env)).status,401);
  assert.equal((await handler(request('/internal/push/targets',undefined,'wrong'),env)).status,401);
  assert.equal(entries.size,0);
});
test('registration starts at now, is idempotent, and private reads require the dispatch secret',async()=>{
  const {env,entries,request}=setup();
  const first=await (await ownerPush(request('/api/push/subscribe',{subscription:sub}),env,now)).json();
  await ownerPush(request('/api/push/subscribe',{subscription:sub}),env,()=>now()+10000);
  assert.equal(entries.size,1);
  const {devices}=await (await internalPush(request('/internal/push/targets'),env,now)).json();
  assert.equal(devices[0].id,first.id);
  assert.equal(devices[0].cursor,new Date(now()).toISOString());
  await assert.rejects(internalPush(request('/internal/push/targets',undefined,'bad'),env,now),{status:401});
});
test('acks only advance cursors; expired subscriptions are removed',async()=>{
  const {env,entries,request}=setup();
  const {id}=await (await ownerPush(request('/api/push/subscribe',{subscription:sub}),env,now)).json();
  const cursor=new Date(now()+1000).toISOString();
  await internalPush(request('/internal/push/ack',{id,cursor}),env,now);
  await internalPush(request('/internal/push/ack',{id,cursor:new Date(now()-1000).toISOString()}),env,now);
  assert.equal(JSON.parse([...entries.values()][0]).cursor,cursor);
  await internalPush(request('/internal/push/ack',{id,expired:true}),env,now);
  assert.equal(entries.size,0);
});
test('test targets only a registered owner device and limits repeat dispatches',async()=>{
  const {env,request}=setup(),calls=[];
  const {id}=await (await ownerPush(request('/api/push/subscribe',{subscription:sub}),env,now)).json();
  const send=id=>calls.push(id);
  assert.equal((await ownerPush(request('/api/push/test',{id}),env,now,send)).status,202);
  await assert.rejects(ownerPush(request('/api/push/test',{id}),env,now,send),{status:429});
  await assert.rejects(ownerPush(request('/api/push/test',{id:'b'.repeat(64)}),env,now,send),{status:404});
  assert.deepEqual(calls,[id]);
});
test('rejects arbitrary destinations, malformed keys and oversized input',async()=>{
  for(const endpoint of ['https://localhost/x','https://fcm.googleapis.com.evil.example/x','https://fcm.googleapis.com:123/x','https://u:p@fcm.googleapis.com/x']) {
    assert.throws(()=>validateSubscription({...sub,endpoint}),{status:400});
  }
  assert.throws(()=>validateSubscription({...sub,keys:{p256dh:'bad',auth:'bad'}}),{status:400});
  const {env,request}=setup();
  await assert.rejects(ownerPush(request('/api/push/subscribe',{padding:'x'.repeat(9000)}),env,now),{status:413});
});
