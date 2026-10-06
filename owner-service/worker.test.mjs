import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from './worker.mjs';

const env = {SITE_URL:'https://arthur-freedom.github.io/bali-cinema-map/',
  SERVICE_ORIGIN:'https://cinema.example', OWNER_LOGIN:'Arthur-Freedom', OWNER_ID:'18115558',
  REPO:'bali-cinema-map', REPO_ID:'1405444014', WORKFLOW:'pages.yml', REF:'main',
  GITHUB_CLIENT_ID:'test-client', GITHUB_CLIENT_SECRET:'test-secret', SESSION_SECRET:'a'.repeat(43)};
const origin = new URL(env.SITE_URL).origin;
const start = Date.parse('2026-10-06T07:00:00Z');
const response = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json'}});

function setup({owner=env.OWNER_ID, upstream, tokenResponse} = {}) {
  let time = start;
  const calls = [];
  const handler = createHandler({now:()=>time, fetch:async(url, options)=>{
    // Match workerd: Node's fetch accepts this mode, but Workers throws before sending.
    if (options.redirect === 'error') throw new TypeError('Invalid redirect value: error');
    calls.push({url, options});
    if (url === 'https://github.com/login/oauth/access_token') return tokenResponse ? tokenResponse() : response({access_token:'ghu_test', expires_in:28800, refresh_token:'never-store-me'});
    if (url === 'https://api.github.com/user') return response({id:Number(owner), login:'name-can-change'});
    if (upstream) return upstream(url, options);
    throw new Error(`Unexpected endpoint ${url}`);
  }});
  const request = (path, options={}) => handler(new Request(env.SERVICE_ORIGIN+path, options), env);
  async function login() {
    const begin = await request('/auth/login?return='+encodeURIComponent(env.SITE_URL+'?movie=2026%2Fdaniel&sort=time'));
    const authorize = new URL(begin.headers.get('Location'));
    const cookie = begin.headers.get('Set-Cookie').split(';')[0];
    const finish = await request('/auth/callback?code=test-code&state='+authorize.searchParams.get('state'), {headers:{Cookie:cookie}});
    const target = new URL(finish.headers.get('Location'));
    return {authorize, cookie, finish, target, session:new URLSearchParams(target.hash.slice(1)).get('owner-session')};
  }
  const api = (path, session, method='GET', requestOrigin=origin) => request(path, {method,
    headers:{Origin:requestOrigin, Authorization:'Bearer '+session, 'Content-Type':'application/json'}});
  return {calls, request, login, api, advance:milliseconds=>{time+=milliseconds;}};
}

test('OAuth uses PKCE, encrypted HttpOnly state, exact callback and repository-scoped token; returns only opaque session', async()=>{
  const s=setup(), result=await s.login();
  assert.equal(result.authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.match(result.authorize.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.authorize.searchParams.get('redirect_uri'), env.SERVICE_ORIGIN+'/auth/callback');
  assert.equal(result.target.searchParams.get('movie'), '2026/daniel');
  assert.equal(result.target.searchParams.get('sort'), 'time');
  assert.ok(result.session && !result.session.includes('ghu_test'));
  assert.equal(result.finish.headers.get('Cache-Control'), 'no-store');
  assert.match(result.finish.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Lax; Max-Age=0/);
  const exchange=JSON.parse(s.calls[0].options.body);
  assert.equal(exchange.repository_id, env.REPO_ID);
  assert.ok(exchange.code_verifier && exchange.code_verifier !== result.authorize.searchParams.get('code_challenge'));
  const session=await s.api('/api/session', result.session);
  assert.deepEqual(await session.json(), {login:env.OWNER_LOGIN, expires:start+3600000});
});
test('rejects redirect escape and callback state mismatch without exchanging a token', async()=>{
  const s=setup();
  for (const target of ['https://evil.example/', origin+'/another-project/']) {
    assert.equal((await s.request('/auth/login?return='+encodeURIComponent(target))).status, 400);
  }
  const login=await s.request('/auth/login');
  const bad=await s.request('/auth/callback?code=stolen&state=wrong', {headers:{Cookie:login.headers.get('Set-Cookie').split(';')[0]}});
  assert.equal(new URL(bad.headers.get('Location')).origin, origin);
  assert.ok(new URL(bad.headers.get('Location')).hash.startsWith('#owner-error='));
  assert.equal(s.calls.length, 0);
});
test('non-owner cannot get a session even with successful GitHub authentication', async()=>{
  const s=setup({owner:'999'}), result=await s.login();
  assert.equal(result.session, null);
  assert.match(decodeURIComponent(result.target.hash).replaceAll('+',' '), /Only Arthur-Freedom/);
});
test('tampering, expiry and untrusted origins cannot trigger workflow calls', async()=>{
  const s=setup(), {session}=await s.login();
  const count=s.calls.length;
  assert.equal((await s.api('/api/refresh', session, 'POST', 'https://evil.example')).status, 403);
  assert.equal((await s.api('/api/refresh', session+'x', 'POST')).status, 401);
  assert.equal((await s.api('/api/refresh', '', 'POST')).status, 401);
  s.advance(3600001);
  assert.equal((await s.api('/api/refresh', session, 'POST')).status, 401);
  assert.equal(s.calls.length, count);
});
test('dispatch targets only the configured workflow and main branch regardless of request body', async()=>{
  const s=setup({upstream:(url)=>url.endsWith('/dispatches') ? response({workflow_run_id:123}) : response({workflow_runs:[]})});
  const {session}=await s.login();
  const result=await s.request('/api/refresh', {method:'POST', headers:{Origin:origin, Authorization:'Bearer '+session, 'Content-Type':'application/json'}, body:JSON.stringify({ref:'evil', repo:'other'})});
  assert.equal(result.status, 202);
  assert.equal((await result.json()).id, 123);
  const dispatch=s.calls.find(call=>call.url.endsWith('/dispatches'));
  assert.equal(dispatch.url, 'https://api.github.com/repos/Arthur-Freedom/bali-cinema-map/actions/workflows/pages.yml/dispatches');
  assert.deepEqual(JSON.parse(dispatch.options.body), {ref:'main'});
});
test('reuses an active publish and does not dispatch a duplicate', async()=>{
  const s=setup({upstream:()=>response({workflow_runs:[{id:456, status:'in_progress', created_at:new Date(start-10000).toISOString()}]})});
  const {session}=await s.login(), result=await s.api('/api/refresh', session, 'POST');
  assert.equal((await result.json()).reused, true);
  assert.equal(s.calls.filter(c=>c.url.endsWith('/dispatches')).length, 0);
});
test('limits status reads to the cinema workflow and returns sanitized upstream errors', async()=>{
  const s=setup({upstream:()=>response({path:'.github/workflows/other.yml', head_branch:'main'})});
  const {session}=await s.login();
  assert.equal((await s.api('/api/runs/999', session)).status, 403);
  const broken=setup({upstream:()=>response({message:'sensitive upstream details'}, 500)});
  const other=await broken.login();
  const result=await broken.api('/api/refresh', other.session, 'POST');
  assert.equal(result.status, 502);
  assert.ok(!(await result.text()).includes('sensitive'));
});
test('CORS is limited to the site origin and sign-out revokes the GitHub token', async()=>{
  const s=setup({upstream:()=>new Response(null,{status:204})});
  const preflight=await s.request('/api/refresh',{method:'OPTIONS',headers:{Origin:origin}});
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);
  const denied=await s.request('/api/refresh',{method:'OPTIONS',headers:{Origin:'https://evil.example'}});
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'),null);
  const {session}=await s.login();
  assert.equal((await s.api('/api/logout',session,'POST')).status,200);
  const revoke=s.calls.at(-1);
  assert.equal(revoke.url,'https://api.github.com/applications/test-client/token');
  assert.equal(revoke.options.method,'DELETE');
});
test('rejects upstream redirects without forwarding credentials at exchange, API and revocation endpoints', async()=>{
  const redirect=()=>new Response(null,{status:307,headers:{Location:'https://unexpected.example/'}});
  const blocked=setup({tokenResponse:redirect});
  const login=await blocked.login();
  assert.equal(login.session,null);
  assert.match(decodeURIComponent(login.target.hash).replaceAll('+',' '),/GitHub sign-in is temporarily unavailable/);
  assert.equal(blocked.calls.length,1);
  const s=setup({upstream:redirect});
  const {session}=await s.login();
  assert.equal((await s.api('/api/refresh',session,'POST')).status,502);
  assert.equal((await s.api('/api/logout',session,'POST')).status,502);
  for (const call of [...blocked.calls,...s.calls]) {
    assert.equal(call.options.redirect,'manual');
    assert.ok(['https://github.com','https://api.github.com'].includes(new URL(call.url).origin));
  }
});
