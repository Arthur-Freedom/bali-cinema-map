import {PushError, internalPush, ownerPush} from './push.mjs';
const encoder = new TextEncoder();
const cookieName = '__Host-cinema-login';
const apiRoot = 'https://api.github.com';
const apiVersion = '2026-03-10';
const renewalLifetime = 15897600;
const rememberedPattern = /^remembered\.[A-Za-z0-9_-]{43}$/;

class PublicError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
function random() { return base64url(crypto.getRandomValues(new Uint8Array(32))); }
async function key(secret) {
  if (!secret || secret.length < 43) throw new PublicError(503, 'Owner sign-in is not configured yet.');
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode(secret)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(payload, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:encoder.encode('bali-cinema-owner-v1')}, await key(secret), encoder.encode(JSON.stringify(payload)));
  return `${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
}
async function unseal(value, secret, purpose, now) {
  try {
    if (!value || value.length > 8192) throw new Error('Missing session');
    const parts = value.split('.');
    if (parts.length !== 2) throw new Error('Invalid session');
    const decrypted = await crypto.subtle.decrypt({name:'AES-GCM', iv:decode(parts[0]), additionalData:encoder.encode('bali-cinema-owner-v1')}, await key(secret), decode(parts[1]));
    const data = JSON.parse(new TextDecoder().decode(decrypted));
    if (data.purpose !== purpose || !Number.isFinite(data.expires) || data.expires <= now) throw new Error('Expired');
    return data;
  } catch { throw new PublicError(401, 'Please sign in with GitHub again.'); }
}
function returnUrl(value, site) {
  const target = new URL(value || site, site);
  const allowed = new URL(site);
  if (target.origin !== allowed.origin || target.pathname !== allowed.pathname || target.username || target.password) {
    throw new PublicError(400, 'Invalid return address.');
  }
  target.hash = '';
  for (const name of [...target.searchParams.keys()]) {
    if (!['movie', 'experience', 'language', 'sort', 'new', 'v'].includes(name)) target.searchParams.delete(name);
  }
  return target;
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json; charset=utf-8'}});
}
function redirect(url, cookie) {
  const headers = new Headers({Location:String(url)});
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(null, {status:303, headers});
}
const clearCookie = `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// One private SQLite-backed Durable Object per remembered device. Serializing
// renewal prevents two tabs from spending the same single-use refresh token.
// Neither this object's routes nor its GitHub credentials are public endpoints.
export class OwnerSession {
  constructor(state, env, {fetch:send=globalThis.fetch, now=Date.now}={}) {
    this.storage=state.storage; this.env=env; this.send=send; this.now=now;
    this.pending=Promise.resolve();
  }
  serial(action) {
    const result=this.pending.then(action);
    this.pending=result.catch(()=>{});
    return result;
  }
  record(credentials, previous={}) {
    if (!credentials.access_token || credentials.error) throw new PublicError(401,'Please sign in with GitHub again.');
    const lifetime=Number(credentials.expires_in);
    const refreshLifetime=Number(credentials.refresh_token_expires_in) || renewalLifetime;
    return {purpose:'remembered', owner:this.env.OWNER_ID, token:credentials.access_token,
      refreshToken:credentials.refresh_token || '',
      tokenExpires:Number.isFinite(lifetime) && lifetime>0 ? this.now()+lifetime*1000 : null,
      expires:this.now()+Math.min(refreshLifetime,renewalLifetime)*1000,
      createdAt:previous.createdAt || this.now()};
  }
  async save(record) {
    await this.storage.put('session',await seal(record,this.env.SESSION_SECRET));
    await this.storage.setAlarm(record.expires);
  }
  async route(request) {
    const path=new URL(request.url).pathname;
    if (path==='/create' && request.method==='POST') {
      if (await this.storage.get('session')) throw new PublicError(409,'Session already exists.');
      await this.save(this.record(await request.json()));
      return json({ok:true});
    }
    const stored=await this.storage.get('session');
    const record=await unseal(stored,this.env.SESSION_SECRET,'remembered',this.now());
    if (record.owner!==this.env.OWNER_ID) throw new PublicError(401,'Please sign in with GitHub again.');
    if (path==='/logout' && request.method==='POST') {
      // Remove server access first, even if GitHub's revocation endpoint is down.
      await this.storage.deleteAll();
      await this.storage.deleteAlarm();
      const response=await this.send(`${apiRoot}/applications/${this.env.GITHUB_CLIENT_ID}/token`, {
        method:'DELETE',redirect:'manual',signal:AbortSignal.timeout(12000),
        headers:{Accept:'application/vnd.github+json','Content-Type':'application/json',
          'User-Agent':'BaliCinemaMap-OwnerRefresh','X-GitHub-Api-Version':apiVersion,
          Authorization:`Basic ${btoa(`${this.env.GITHUB_CLIENT_ID}:${this.env.GITHUB_CLIENT_SECRET}`)}`},
        body:JSON.stringify({access_token:record.token})});
      return json({signedOut:true,revoked:response.ok || response.status===404});
    }
    if (path!=='/session' || request.method!=='GET') throw new PublicError(404,'Not found.');
    let current=record;
    if (record.tokenExpires && record.tokenExpires<=this.now()+60000) {
      if (!record.refreshToken) throw new PublicError(401,'Please sign in with GitHub again.');
      const response=await this.send('https://github.com/login/oauth/access_token', {
        method:'POST',redirect:'manual',signal:AbortSignal.timeout(12000),
        headers:{Accept:'application/json','Content-Type':'application/json'},
        body:JSON.stringify({client_id:this.env.GITHUB_CLIENT_ID,client_secret:this.env.GITHUB_CLIENT_SECRET,
          grant_type:'refresh_token',refresh_token:record.refreshToken})});
      if (!response.ok) throw new PublicError(503,'GitHub is temporarily unavailable. Your saved sign-in is still here. Try again shortly.');
      const credentials=await response.json();
      if (credentials.error==='bad_refresh_token' || credentials.error==='invalid_grant') {
        throw new PublicError(401,'GitHub access expired or was revoked. Please sign in again.');
      }
      if (!credentials.access_token || !credentials.refresh_token || credentials.error) {
        throw new PublicError(503,'GitHub could not renew sign-in yet. Try again shortly.');
      }
      current=this.record(credentials,record);
      await this.save(current);
    } else if (!record.tokenExpires && record.expires-this.now()<renewalLifetime*500) {
      current={...record,expires:this.now()+renewalLifetime*1000};
      await this.save(current);
    }
    return json({...current,persistent:true});
  }
  fetch(request) {
    return this.serial(async()=>{
      try { return await this.route(request); }
      catch(error) { return json({error:error instanceof PublicError ? error.message : 'Saved sign-in is temporarily unavailable. Try again shortly.'},error instanceof PublicError ? error.status : 503); }
    });
  }
  alarm() {
    return this.serial(async()=>{
      const stored=await this.storage.get('session');
      let record;
      try { record=await unseal(stored,this.env.SESSION_SECRET,'remembered',this.now()); }
      catch { await this.storage.deleteAll(); return; }
      // An older queued alarm must not delete a session renewed just beforehand.
      await this.storage.setAlarm(record.expires);
    });
  }
}

async function rememberedSession(env, handle, path, credentials) {
  if (!env.OWNER_SESSIONS) throw new PublicError(503,'Remembered sign-in is temporarily unavailable. Try again shortly.');
  const object=env.OWNER_SESSIONS.get(env.OWNER_SESSIONS.idFromName(handle));
  const response=await object.fetch(new Request(`https://session.internal${path}`, {
    method:credentials || path==='/logout' ? 'POST' : 'GET',
    ...(credentials ? {headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials)} : {})}));
  const data=await response.json();
  if (!response.ok) throw new PublicError(response.status,data.error);
  return data;
}

export function createHandler({fetch:send = globalThis.fetch, now = Date.now} = {}) {
  async function github(path, token, options = {}) {
    const response = await send(`${apiRoot}${path}`, {
      // Workers supports manual redirects; reject every non-2xx response below.
      ...options, redirect:'manual', signal:AbortSignal.timeout(12000),
      headers:{Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':apiVersion,
        'User-Agent':'BaliCinemaMap-OwnerRefresh', Authorization:`Bearer ${token}`, ...options.headers}
    });
    if (response.status === 401) throw new PublicError(401, 'Please sign in with GitHub again.');
    if (response.status === 403 || response.status === 404) throw new PublicError(403, 'Check that the GitHub app is installed on bali-cinema-map with Actions permission.');
    if (!response.ok) throw new PublicError(502, 'GitHub could not complete the request. Try again shortly.');
    return response.status === 204 ? null : response.json();
  }
  async function verifyOwner(token, env) {
    const user = await github('/user', token);
    if (String(user.id) !== env.OWNER_ID) throw new PublicError(403, `Only ${env.OWNER_LOGIN} can refresh this site.`);
    return user;
  }
  function publicRun(run, env) {
    return {id:run.id, status:run.status, conclusion:run.conclusion, createdAt:run.created_at,
      url:`https://github.com/${env.OWNER_LOGIN}/${env.REPO}/actions/runs/${run.id}`};
  }
  async function route(request, env) {
    const url = new URL(request.url);
    const siteOrigin = new URL(env.SITE_URL).origin;
    const callback = `${env.SERVICE_ORIGIN}/auth/callback`;
    const repo = `/repos/${env.OWNER_LOGIN}/${env.REPO}`;
    const workflow = `${repo}/actions/workflows/${env.WORKFLOW}`;
    if (url.pathname.startsWith('/internal/push/')) return internalPush(request, env, now);
    if (url.pathname === '/health' && request.method === 'GET') return json({ready:Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.SESSION_SECRET),rememberedSignIn:Boolean(env.OWNER_SESSIONS)});
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.SESSION_SECRET) throw new PublicError(503, 'Owner sign-in is not configured yet.');

    if (url.pathname === '/auth/login' && request.method === 'GET') {
      const back = returnUrl(url.searchParams.get('return'), env.SITE_URL);
      const state = random(), verifier = random();
      const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
      const login = await seal({purpose:'login', state, verifier, back:String(back), expires:now()+10*60*1000}, env.SESSION_SECRET);
      const target = new URL('https://github.com/login/oauth/authorize');
      target.search = new URLSearchParams({client_id:env.GITHUB_CLIENT_ID, redirect_uri:callback, state,
        code_challenge:challenge, code_challenge_method:'S256', login:env.OWNER_LOGIN, allow_signup:'false'});
      return redirect(target, `${cookieName}=${login}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    }
    if (url.pathname === '/auth/callback' && request.method === 'GET') {
      let back = new URL(env.SITE_URL);
      try {
        const cookie = request.headers.get('Cookie')?.split(';').map(c=>c.trim()).find(c=>c.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
        const login = await unseal(cookie, env.SESSION_SECRET, 'login', now());
        if (!url.searchParams.get('state') || url.searchParams.get('state') !== login.state) throw new PublicError(401, 'Sign-in could not be verified.');
        back = returnUrl(login.back, env.SITE_URL);
        if (url.searchParams.has('error')) throw new PublicError(401, 'Sign-in was cancelled.');
        const code = url.searchParams.get('code');
        if (!code || code.length > 512) throw new PublicError(401, 'Sign-in could not be verified.');
        const exchange = await send('https://github.com/login/oauth/access_token', {
          method:'POST', redirect:'manual', signal:AbortSignal.timeout(12000), headers:{Accept:'application/json', 'Content-Type':'application/json'},
          body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID, client_secret:env.GITHUB_CLIENT_SECRET,
            code, redirect_uri:callback, code_verifier:login.verifier, repository_id:env.REPO_ID})
        });
        if (!exchange.ok) throw new PublicError(502, 'GitHub sign-in is temporarily unavailable.');
        const credentials = await exchange.json();
        if (!credentials.access_token || credentials.error) throw new PublicError(401, 'Sign-in expired. Please try again.');
        await verifyOwner(credentials.access_token, env);
        const session=`remembered.${random()}`;
        await rememberedSession(env,session,'/create',credentials);
        back.hash = new URLSearchParams({'owner-session':session}).toString();
      } catch (error) {
        back.hash = new URLSearchParams({'owner-error':error instanceof PublicError ? error.message : 'Sign-in could not finish. Please try again.'}).toString();
      }
      return redirect(back, clearCookie);
    }

    if (!url.pathname.startsWith('/api/')) throw new PublicError(404, 'Not found.');
    if (request.headers.get('Origin') !== siteOrigin) throw new PublicError(403, 'This request must come from the cinema map.');
    if (request.method === 'OPTIONS') return new Response(null, {status:204});
    if (!['GET', 'POST'].includes(request.method)) throw new PublicError(405, 'Method not allowed.');
    if (request.method === 'POST' && request.headers.get('Content-Type') !== 'application/json') throw new PublicError(415, 'Expected a JSON request.');
    const authorization = request.headers.get('Authorization') || '';
    const handle=authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const persistent=rememberedPattern.test(handle);
    if (persistent && url.pathname==='/api/logout' && request.method==='POST') {
      return json(await rememberedSession(env,handle,'/logout'));
    }
    const session = persistent ? await rememberedSession(env,handle,'/session')
      : await unseal(handle, env.SESSION_SECRET, 'session', now());
    if (session.owner !== env.OWNER_ID) throw new PublicError(403, 'Owner access required.');

    if (url.pathname.startsWith('/api/push/')) {
      await verifyOwner(session.token, env);
      return ownerPush(request, env, now, id => github(`${repo}/actions/workflows/push-test.yml/dispatches`, session.token,
        {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ref:env.REF,inputs:{device_id:id}})}));
    }

    if (url.pathname === '/api/session' && request.method === 'GET') {
      await verifyOwner(session.token, env);
      return json({login:env.OWNER_LOGIN, expires:session.expires,persistent});
    }
    if (url.pathname === '/api/logout' && request.method === 'POST') {
      const response = await send(`${apiRoot}/applications/${env.GITHUB_CLIENT_ID}/token`, {
        method:'DELETE', redirect:'manual', headers:{Accept:'application/vnd.github+json', 'Content-Type':'application/json',
          'User-Agent':'BaliCinemaMap-OwnerRefresh', 'X-GitHub-Api-Version':apiVersion,
          Authorization:`Basic ${btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`)}`},
        body:JSON.stringify({access_token:session.token})
      });
      if (!response.ok && response.status !== 404) throw new PublicError(502, 'Signed out of this tab. GitHub could not revoke the session yet; it expires within one hour.');
      return json({signedOut:true});
    }
    if (url.pathname === '/api/refresh' && request.method === 'POST') {
      await verifyOwner(session.token, env);
      const recent = await github(`${workflow}/runs?branch=${encodeURIComponent(env.REF)}&per_page=10`, session.token);
      const active = recent.workflow_runs.find(run=>run.status !== 'completed');
      if (active) return json({...publicRun(active, env), reused:true});
      const latest = recent.workflow_runs[0];
      if (latest && now()-Date.parse(latest.created_at) < 60000) throw new PublicError(429, 'A refresh just finished. Please wait a minute before starting another.');
      const requestedAt = new Date(now()).toISOString();
      const result = await github(`${workflow}/dispatches`, session.token, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ref:env.REF})});
      if (result?.workflow_run_id) return json({id:result.workflow_run_id, status:'queued', createdAt:new Date(now()).toISOString(),
        url:`https://github.com/${env.OWNER_LOGIN}/${env.REPO}/actions/runs/${result.workflow_run_id}`}, 202);
      // Older API responses have no run ID; the client locates the new owner-triggered run.
      return json({id:null, status:'queued', requestedAt}, 202);
    }
    if (url.pathname === '/api/runs' && request.method === 'GET') {
      const since = Date.parse(url.searchParams.get('since'));
      if (!Number.isFinite(since) || now()-since > 60*60*1000 || since > now()+5000) throw new PublicError(400, 'Invalid refresh time.');
      const runs = await github(`${workflow}/runs?branch=${encodeURIComponent(env.REF)}&event=workflow_dispatch&per_page=10`, session.token);
      const run = runs.workflow_runs.find(r=>String(r.actor?.id) === env.OWNER_ID && Date.parse(r.created_at) >= since-5000);
      return json(run ? publicRun(run, env) : {id:null, status:'queued', requestedAt:new Date(since).toISOString()});
    }
    const runId = /^\/api\/runs\/([0-9]+)$/.exec(url.pathname)?.[1];
    if (runId && request.method === 'GET') {
      const run = await github(`${repo}/actions/runs/${runId}`, session.token);
      if (run.path !== `.github/workflows/${env.WORKFLOW}` || run.head_branch !== env.REF) throw new PublicError(403, 'This run is not a cinema refresh.');
      let stage = run.status === 'queued' ? 'Queued on GitHub…' : 'Refreshing movie data…';
      let published = false;
      if (run.status === 'completed' && run.conclusion !== 'success') {
        const jobs = await github(`${repo}/actions/runs/${runId}/jobs?per_page=10`, session.token);
        published = jobs.jobs.some(job=>job.name === 'deploy' && job.conclusion === 'success');
      }
      if (run.status === 'in_progress') {
        const jobs = await github(`${repo}/actions/runs/${runId}/jobs?per_page=10`, session.token);
        if (jobs.jobs.some(job=>job.name === 'deploy' && job.status !== 'queued')) stage = 'Publishing the updated listings…';
        else if (jobs.jobs.some(job=>job.steps?.some(step=>step.name === 'Refresh movie listings' && step.status === 'in_progress'))) stage = 'Checking cinema schedules and trailers…';
      }
      return json({...publicRun(run, env), stage, published});
    }
    throw new PublicError(404, 'Not found.');
  }
  return async function handle(request, env) {
    let response;
    try { response = await route(request, env); }
    catch (error) { const safe=error instanceof PublicError || error instanceof PushError; response = json({error:safe ? error.message : 'The service is temporarily unavailable. Try again shortly.'}, safe ? error.status : 502); }
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    headers.set('Vary', 'Origin');
    if (request.headers.get('Origin') === new URL(env.SITE_URL).origin) {
      headers.set('Access-Control-Allow-Origin', new URL(env.SITE_URL).origin);
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      headers.set('Access-Control-Max-Age', '600');
    }
    return new Response(response.body, {status:response.status, headers});
  };
}
export default {fetch:createHandler()};
