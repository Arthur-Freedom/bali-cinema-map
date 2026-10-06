const {test}=require('node:test');
const assert=require('node:assert/strict');
const {unseenMovies}=require('../movie-alerts.js');
test('first visit has no backlog; only later first discoveries appear, never returns or malformed dates',()=>{
  const first='2026-10-06T13:17:00+08:00', next='2026-10-07T07:17:00+08:00';
  const snapshot={refreshedAt:next,movies:[
    {id:'returning',firstSeenAt:first},{id:'new',firstSeenAt:next},{id:'unknown'},
    {id:'future',firstSeenAt:'2027-01-01T00:00:00Z'}]};
  assert.deepEqual(unseenMovies(snapshot,null),[]);
  assert.deepEqual(unseenMovies(snapshot,next),[]);
  assert.deepEqual(unseenMovies(snapshot,first).map(m=>m.id),['new']);
});
test('service worker restricts notification navigation to this project',async()=>{
  const vm=require('node:vm'), fs=require('node:fs');
  const handlers={}, shown=[];
  const scope='https://arthur-freedom.github.io/bali-cinema-map/';
  const messages=[];
  const self={registration:{scope,showNotification:async(...args)=>shown.push(args)},
    clients:{matchAll:async()=>[{url:scope,postMessage:d=>messages.push(d)},
      {url:'https://arthur-freedom.github.io/another-project/',postMessage:()=>assert.fail('unrelated page')} ]},
    addEventListener:(type,fn)=>handlers[type]=fn};
  vm.runInNewContext(fs.readFileSync(require.resolve('../sw.js'),'utf8'),{self,URL});
  let completion;
  handlers.push({data:{json:()=>({title:'Test',url:'https://evil.example/'})},waitUntil:p=>completion=p});
  await completion;
  assert.equal(shown[0][1].data.url,scope);
  handlers.push({data:{json:()=>({url:scope+'?movie=new',test:true})},waitUntil:p=>completion=p});
  await completion;
  assert.equal(shown[1][1].data.url,scope+'?movie=new');
  assert.equal(shown[1][1].requireInteraction,true);
  assert.equal(messages[1].test,true);
  assert.equal(typeof messages[1].receivedAt,'number');
  self.registration.showNotification=async()=>{throw Error('OS refused');};
  handlers.push({data:{json:()=>({test:true})},waitUntil:p=>completion=p});
  await assert.rejects(completion,/OS refused/);
  assert.equal(messages.length,2,'do not acknowledge when notification creation fails');
  assert.equal(handlers.fetch,undefined);
});
