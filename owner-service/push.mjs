// Private, owner-only device registrations. No endpoints or keys enter the public repo.
const encoder = new TextEncoder();
// Explicit languages supported by the movie metadata scraper; no guessed/Unknown alerts when filtered.
const languages = ['en','id','ko','ja','zh','cmn','yue','th','ms','hi','ta','te','ml','kn','fr','es','de','it','ar','jv','su','ban'];
const preferencesKey = 'preferences:language';
function validateLanguages(selected) {
  if (!Array.isArray(selected) || selected.length>languages.length || selected.some(code=>!languages.includes(code)))
    fail(400,'Choose supported alert languages.');
  return [...new Set(selected)].sort();
}
async function alertLanguages(env) {
  const saved = await env.PUSH_DEVICES.get(preferencesKey, 'json');
  if (saved === null) return [];
  // Preserve the owner's existing single-language preference during migration.
  try { return validateLanguages(saved.selectedLanguages ?? (saved.language==='' ? [] : [saved.language])); }
  catch { fail(503, 'Alert language settings could not be read. Please try again.'); }
}
export class PushError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json'}});
const fail = (status, message) => { throw new PushError(status, message); };
export function validateSubscription(value) {
  const endpoint = value?.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length > 4096) fail(400, 'Invalid notification subscription.');
  let url;
  try { url = new URL(endpoint); } catch { fail(400, 'Invalid notification subscription.'); }
  const host = url.hostname;
  const allowed = host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com'
    || host.endsWith('.push.services.mozilla.com') || host === 'web.push.apple.com'
    || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com');
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !allowed) fail(400, 'This browser’s push service is not supported yet.');
  for (const [name, size] of [['p256dh',65], ['auth',16]]) {
    const key = value?.keys?.[name];
    try {
      if (typeof key !== 'string' || !/^[\w-]+={0,2}$/.test(key)) throw new Error();
      const bytes = atob(key.replaceAll('-','+').replaceAll('_','/'));
      if (bytes.length !== size || (name === 'p256dh' && bytes.charCodeAt(0) !== 4)) throw new Error();
    } catch { fail(400, 'Invalid notification subscription keys.'); }
  }
  return {endpoint, keys:{p256dh:value.keys.p256dh, auth:value.keys.auth}};
}
export async function subscriptionId(endpoint) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(endpoint))), b=>b.toString(16).padStart(2,'0')).join('');
}
async function body(request) {
  if (request.headers.get('Content-Type') !== 'application/json') fail(415, 'Expected a JSON request.');
  // The API never accepts large bodies, including when Content-Length is absent.
  const reader = request.body?.getReader();
  let size=0, parts=[];
  if (!reader) fail(400, 'Missing request.');
  while (true) {
    const {value,done}=await reader.read();
    if (done) break;
    size+=value.length;
    if (size>8192) { await reader.cancel(); fail(413, 'Request is too large.'); }
    parts.push(value);
  }
  try { return JSON.parse(new TextDecoder().decode(new Uint8Array(parts.flatMap(p=>Array.from(p))))); }
  catch { fail(400, 'Invalid request.'); }
}
function ready(env) {
  if (!env.PUSH_DEVICES || !env.VAPID_PUBLIC_KEY) fail(503, 'Movie alerts are not configured yet.');
}
async function sameSecret(a,b) {
  if (!b || b.length<43 || a.length>256) return false;
  const hashes=await Promise.all([a,b].map(s=>crypto.subtle.digest('SHA-256',encoder.encode(s))));
  const x=new Uint8Array(hashes[0]), y=new Uint8Array(hashes[1]);
  let diff=0; for(let i=0;i<x.length;i++) diff|=x[i]^y[i];
  return diff===0;
}
export async function internalPush(request, env, now) {
  if (!await sameSecret((request.headers.get('Authorization')||'').replace(/^Bearer /,''),env.PUSH_DISPATCH_SECRET)) fail(401, 'Unauthorized.');
  ready(env);
  const path=new URL(request.url).pathname;
  if (path==='/internal/push/targets' && request.method==='GET') {
    const listing=await env.PUSH_DEVICES.list({prefix:'device:',limit:20});
    const devices=(await Promise.all(listing.keys.map(k=>env.PUSH_DEVICES.get(k.name,'json')))).filter(Boolean);
    const selectedLanguages=await alertLanguages(env);
    return json({devices, selectedLanguages, language:selectedLanguages[0] || ''});
  }
  if (path==='/internal/push/ack' && request.method==='POST') {
    const data=await body(request);
    if (!/^[a-f0-9]{64}$/.test(data.id||'')) fail(400,'Invalid device.');
    const key='device:'+data.id;
    const device=await env.PUSH_DEVICES.get(key,'json');
    if (device) {
      if (data.expired===true) await env.PUSH_DEVICES.delete(key);
      else {
        const time=Date.parse(data.cursor);
        if (!Number.isFinite(time) || time>now()+300000) fail(400,'Invalid observation time.');
        if (data.pendingLanguage !== undefined && (!Array.isArray(data.pendingLanguage) || data.pendingLanguage.length>200
          || data.pendingLanguage.some(id=>typeof id!=='string' || !/^[a-z0-9][a-z0-9/_-]{0,199}$/.test(id)))) fail(400,'Invalid pending movies.');
        if (time>Date.parse(device.cursor)) {
          device.cursor=data.cursor;
          if (data.pendingLanguage !== undefined) device.pendingLanguage=[...new Set(data.pendingLanguage)];
          await env.PUSH_DEVICES.put(key,JSON.stringify(device));
        }
      }
    }
    return json({ok:true});
  }
  fail(404,'Not found.');
}
export async function ownerPush(request, env, now, dispatchTest) {
  ready(env);
  const path=new URL(request.url).pathname;
  if (path==='/api/push/config' && request.method==='GET') {
    const selectedLanguages=await alertLanguages(env);
    return json({publicKey:env.VAPID_PUBLIC_KEY, languages, selectedLanguages, language:selectedLanguages[0] || ''});
  }
  if (request.method!=='POST') fail(405,'Method not allowed.');
  const data=await body(request);
  if (path==='/api/push/preferences') {
    const selectedLanguages=validateLanguages(data.selectedLanguages ?? (data.language==='' ? [] : [data.language]));
    await env.PUSH_DEVICES.put(preferencesKey,JSON.stringify({selectedLanguages}));
    return json({selectedLanguages, language:selectedLanguages[0] || ''});
  }
  if (path==='/api/push/subscribe' || path==='/api/push/unsubscribe') {
    const subscription=validateSubscription(data.subscription);
    const id=await subscriptionId(subscription.endpoint), key='device:'+id;
    if (path.endsWith('/unsubscribe')) { await env.PUSH_DEVICES.delete(key); return json({enabled:false}); }
    const prior=await env.PUSH_DEVICES.get(key,'json');
    if (!prior) {
      const list=await env.PUSH_DEVICES.list({prefix:'device:',limit:20});
      if (list.keys.length>=10) fail(409,'Ten devices already have alerts. Turn alerts off on an old device first.');
      const joinedAt=new Date(now()).toISOString();
      await env.PUSH_DEVICES.put(key,JSON.stringify({id,subscription,joinedAt,cursor:joinedAt}));
    } else if (JSON.stringify(prior.subscription)!==JSON.stringify(subscription)) {
      await env.PUSH_DEVICES.put(key,JSON.stringify({...prior,subscription}));
    }
    return json({enabled:true,id});
  }
  if (path==='/api/push/test') {
    if (!/^[a-f0-9]{64}$/.test(data.id||'')) fail(400,'Enable alerts on this device first.');
    const key='device:'+data.id, device=await env.PUSH_DEVICES.get(key,'json');
    if (!device) fail(404,'Enable alerts on this device first.');
    if (device.lastTestAt && now()-Date.parse(device.lastTestAt)<60000) fail(429,'A test was just requested. Please wait a minute.');
    device.lastTestAt=new Date(now()).toISOString();
    await env.PUSH_DEVICES.put(key,JSON.stringify(device));
    await dispatchTest(data.id);
    return json({queued:true},202);
  }
  fail(404,'Not found.');
}
