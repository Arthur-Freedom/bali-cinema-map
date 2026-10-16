import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('native Worker fetch renews a saved token after restart, serializes rotation and revokes on logout',async()=>{
 const built=await build({stdin:{contents:`import {OwnerSession} from './worker.mjs'; export {OwnerSession}; export default {fetch(request,env){return env.SESSIONS.get(env.SESSIONS.idFromName('test')).fetch(request);}};`,resolveDir:fileURLToPath(new URL('.',import.meta.url))},bundle:true,format:'esm',platform:'browser',write:false});
 const persist=await mkdtemp(join(tmpdir(),'cinema-session-test-'));let rotations=0,revocations=0,mf;
 const options=()=>convertV4MiniflareOptions({name:'owner-session-runtime',modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-10-06',host:'127.0.0.1',port:0,
  bindings:{OWNER_ID:'18115558',SESSION_SECRET:'a'.repeat(43),GITHUB_CLIENT_ID:'synthetic-client',GITHUB_CLIENT_SECRET:'synthetic-secret'},
  durableObjects:{SESSIONS:{className:'OwnerSession',useSQLite:true}},resourcePersistencePath:persist,isolatedResourcePersistencePath:persist,
  outboundService:async request=>{
   if(request.url==='https://github.com/login/oauth/access_token'){
    const body=await request.json();assert.equal(body.grant_type,'refresh_token');assert.equal(body.refresh_token,'synthetic-initial-refresh');rotations++;
    return Response.json({access_token:'synthetic-renewed',refresh_token:'synthetic-refresh',expires_in:28800,refresh_token_expires_in:15897600});
   }
   assert.equal(request.url,'https://api.github.com/applications/synthetic-client/token');assert.equal(request.method,'DELETE');revocations++;
   return new Response(null,{status:204});
  }
 });
 try{
  mf=new Miniflare(options());
  const created=await mf.dispatchFetch('https://test/create',{method:'POST',body:JSON.stringify({access_token:'synthetic-initial',refresh_token:'synthetic-initial-refresh',expires_in:1,refresh_token_expires_in:15897600})});assert.equal(created.status,200);
  await mf.dispose();mf=new Miniflare(options());
  const replies=await Promise.all([mf.dispatchFetch('https://test/session'),mf.dispatchFetch('https://test/session')]);
  for(const reply of replies){const data=await reply.json();assert.equal(reply.status,200,JSON.stringify(data));assert.equal(data.token,'synthetic-renewed');}
  assert.equal(rotations,1);
  const loggedOut=await mf.dispatchFetch('https://test/logout',{method:'POST'});assert.equal(loggedOut.status,200);assert.equal((await loggedOut.json()).revoked,true);assert.equal(revocations,1);
  assert.equal((await mf.dispatchFetch('https://test/session')).status,401);
 }finally{await mf?.dispose();assert.equal(dirname(resolve(persist)),resolve(tmpdir()));assert.ok(basename(persist).startsWith('cinema-session-test-'));await rm(persist,{recursive:true,force:true});}
});
