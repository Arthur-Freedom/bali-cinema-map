'use strict';
(() => {
  // Run before third-party scripts. Remove the opaque sign-in result from the address bar immediately.
  const sessionKey = 'bali-cinema-owner-session';
  const runKey = 'bali-cinema-owner-run';
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  let session = fragment.get('owner-session') || '';
  const loginError = fragment.get('owner-error');
  if (fragment.has('owner-session') || fragment.has('owner-error')) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  try {
    if (session) sessionStorage.setItem(sessionKey, session);
    else session = sessionStorage.getItem(sessionKey) || '';
  } catch {} // Private browsing can disable session storage; this tab still works in memory.

  const panel = document.getElementById('owner-controls');
  const login = document.getElementById('owner-login');
  const refresh = document.getElementById('owner-refresh');
  const signout = document.getElementById('owner-signout');
  const check = document.getElementById('owner-check');
  const status = document.getElementById('owner-status');
  const runLink = document.getElementById('owner-run');
  let service = '', currentRun = null, busy = false, generation = 0;
  let authenticated = false;
  window.CinemaOwner = Object.freeze({api,
    get signedIn() { return authenticated; },
    get loginUrl() { const url=new URL('/auth/login', service || location.origin); url.searchParams.set('return',location.href.split('#')[0]); return url.href; }
  });
  function saveRun(run) {
    currentRun = run;
    try { if (run) sessionStorage.setItem(runKey, JSON.stringify(run)); else sessionStorage.removeItem(runKey); } catch {}
  }
  function signedIn(value) {
    authenticated = value;
    login.hidden = value;
    refresh.hidden = !value;
    signout.hidden = !value;
    if (!value) check.hidden = true;
    window.dispatchEvent(new Event('cinema:owner-changed'));
  }
  function forgetSession() {
    session = '';
    try { sessionStorage.removeItem(sessionKey); sessionStorage.removeItem(runKey); } catch {}
    currentRun = null;
    signedIn(false);
  }
  function showRun(run) {
    if (!run?.id || !/^\d+$/.test(String(run.id))) return;
    runLink.href = `https://github.com/Arthur-Freedom/bali-cinema-map/actions/runs/${run.id}`;
    runLink.hidden = false;
  }
  async function api(path, method='GET', body) {
    const response = await fetch(service+path, {method, cache:'no-store', credentials:'omit',
      signal:AbortSignal.timeout(20000), body:body === undefined ? undefined : JSON.stringify(body), headers:{Authorization:`Bearer ${session}`, ...(method==='POST' ? {'Content-Type':'application/json'} : {})}});
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) forgetSession();
      throw new Error(data.error || 'The refresh service could not complete the request.');
    }
    return data;
  }
  const sleep = milliseconds => new Promise(resolve=>setTimeout(resolve, milliseconds));
  async function watch(run) {
    const token = ++generation;
    busy = true;
    refresh.disabled = true;
    check.hidden = true;
    saveRun(run);
    showRun(run);
    const deadline = Date.now()+10*60*1000;
    try {
      while (token === generation && Date.now() < deadline) {
        const path = run.id ? `/api/runs/${run.id}` : `/api/runs?since=${encodeURIComponent(run.requestedAt)}`;
        run = await api(path);
        if (token !== generation) return;
        saveRun(run);
        showRun(run);
        if (run.status === 'completed') {
          if (run.conclusion !== 'success' && !run.published) {
            saveRun(null);
            throw new Error('Refresh did not finish successfully. The previous listings are still available. Open the GitHub run for details.');
          }
          status.textContent = 'Published. Loading the fresh listings…';
          const cacheDeadline = Date.now()+60000;
          while (token === generation) {
            try {
              await window.CinemaData.reload({since:run.createdAt});
              if (token !== generation) return;
              status.textContent = run.conclusion === 'success' ? 'Movie data updated. You’re viewing the fresh listings.'
                : 'Movie data updated. An archive or notification step needs attention; open the GitHub run for details.';
              saveRun(null);
              return;
            } catch {
              if (Date.now() >= cacheDeadline) throw new Error('Published successfully. The website cache is still updating; check again shortly.');
              await sleep(5000);
            }
          }
          return;
        }
        status.textContent = run.stage || 'Queued on GitHub…';
        await sleep(10000);
      }
      if (token === generation) status.textContent = 'GitHub is taking longer than usual. Check progress again, or open the run.';
    } catch (error) {
      if (token === generation) status.textContent = error.name === 'TimeoutError' || error.name === 'TypeError'
        ? 'Could not reach the refresh service. Your current listings are unchanged. Try again shortly.' : error.message;
    } finally {
      if (token === generation) {
        busy = false;
        refresh.disabled = false;
        check.hidden = !session || !currentRun;
      }
    }
  }
  login.addEventListener('click', () => {
    const target = new URL('/auth/login', service);
    target.searchParams.set('return', window.location.href.split('#')[0]);
    login.href = target.href;
  });
  refresh.addEventListener('click', async()=>{
    if (busy) return;
    const token = generation;
    busy = true;
    refresh.disabled = true;
    status.textContent = 'Starting the refresh…';
    try {
      const run = await api('/api/refresh', 'POST');
      if (token !== generation || !session) return;
      await watch(run);
    } catch (error) {
      status.textContent = error.name === 'TypeError' || error.name === 'TimeoutError'
        ? 'Could not confirm whether GitHub started the refresh. Try again to reconnect; an active run will be reused.' : error.message;
    } finally { busy = false; refresh.disabled = false; }
  });
  check.addEventListener('click', ()=>{if (currentRun && !busy) watch(currentRun);});
  signout.addEventListener('click', async()=>{
    ++generation;
    signout.disabled = true;
    // Start revocation before dropping the opaque session from this tab.
    const revocation = api('/api/logout', 'POST');
    forgetSession();
    busy = false;
    refresh.disabled = false;
    status.textContent = 'Signed out.';
    try { await revocation; }
    catch { status.textContent = 'Signed out of this tab. GitHub could not revoke the session yet; it expires within one hour.'; }
    finally { signout.disabled = false; }
  });
  async function init() {
    try {
      const response = await fetch('./owner-refresh-config.json', {cache:'no-store'});
      if (!response.ok) return;
      const config = await response.json();
      if (!config.serviceUrl) return;
      const target = new URL(config.serviceUrl);
      const local = ['localhost', '127.0.0.1'].includes(window.location.hostname) && ['localhost', '127.0.0.1'].includes(target.hostname);
      if (!local && (target.protocol !== 'https:' || target.hostname !== 'bali-cinema-owner-refresh.honeymooninbali.workers.dev')) return;
      service = target.origin;
      login.href = service+'/auth/login';
      panel.hidden = false;
      signedIn(false);
      if (loginError) { status.textContent = loginError; panel.open = true; }
      if (!session) return;
      panel.open = true;
      status.textContent = 'Checking your owner sign-in…';
      const owner = await api('/api/session');
      signedIn(true);
      status.textContent = `Signed in as ${owner.login}. Refreshing usually takes about a minute.`;
      try { currentRun = JSON.parse(sessionStorage.getItem(runKey)); } catch {}
      if (currentRun?.id || currentRun?.requestedAt) watch(currentRun);
    } catch {
      signedIn(false);
      status.textContent = 'Sign in with GitHub to refresh. Only Arthur-Freedom can start a refresh.';
    }
  }
  init();
})();
