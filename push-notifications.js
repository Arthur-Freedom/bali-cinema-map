'use strict';
(() => {
  const status=document.getElementById('push-status');
  const enable=document.getElementById('push-enable');
  const disable=document.getElementById('push-disable');
  const test=document.getElementById('push-test');
  const login=document.getElementById('push-login');
  const receiptKey='bali-cinema-push-device';
  let registration=null, subscription=null, publicKey=null, signedIn=false, busy=false, deviceId='';
  let registrationTask=null;
  try { deviceId=localStorage.getItem(receiptKey)||''; } catch {}
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  const standalone=matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;
  const supported='serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  function receipt(value) { deviceId=value; try { if(value) localStorage.setItem(receiptKey,value); else localStorage.removeItem(receiptKey); } catch {} }
  function render(message) {
    const active=Boolean(subscription && deviceId && Notification.permission==='granted');
    enable.hidden=!supported || (ios&&!standalone) || active || !signedIn;
    enable.disabled=busy || !publicKey || Notification.permission==='denied';
    disable.hidden=!active; disable.disabled=busy;
    test.hidden=!active || !signedIn || !deviceId; test.disabled=busy;
    login.hidden=active || signedIn || !supported || (ios&&!standalone);
    if(message) status.textContent=message;
    else if(ios&&!standalone) status.textContent='On iPhone: open this site in Safari, tap Share → Add to Home Screen, then open it from that icon.';
    else if(!supported) status.textContent='This browser cannot receive website notifications. On Android, open this site in Chrome.';
    else if(Notification.permission==='denied') status.textContent='Notifications are blocked. Allow them in this browser’s site settings, then reload.';
    else if(active) status.textContent='Alerts are on for this device. New titles arrive after a successful movie refresh.';
    else if(!signedIn) status.textContent='Personal alerts for Arthur-Freedom. Sign in, then enable them on this device.';
    else if(!publicKey) status.textContent='Connecting to movie alerts…';
    else status.textContent='Get one alert when a refresh finds new movies. Works when this site is closed.';
  }
  async function setup() {
    if(!supported || (ios&&!standalone)) { render(); return; }
    try {
      registrationTask=navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
      await registrationTask;
      registration=await navigator.serviceWorker.ready;
      subscription=await registration.pushManager.getSubscription();
      if(!subscription) receipt('');
      render();
    } catch { render('Movie alerts could not start. Reload the page and try again.'); }
  }
  async function ownerChanged() {
    signedIn=Boolean(window.CinemaOwner?.signedIn);
    login.href=window.CinemaOwner?.loginUrl || '#owner-controls';
    publicKey=null;
    render();
    if(signedIn && supported) {
      document.getElementById('push-controls').open=true;
      try { publicKey=(await window.CinemaOwner.api('/api/push/config')).publicKey; render(); }
      catch(error) { render(error.message); }
    }
  }
  login.addEventListener('click',()=>{ login.href=window.CinemaOwner?.loginUrl || '#owner-controls'; });
  enable.addEventListener('click',async()=>{
    if(busy || !signedIn || !publicKey) return;
    busy=true;
    // Ask directly inside this tap; do not request permission on page load.
    const permissionTask=Notification.requestPermission();
    render('Waiting for notification permission…');
    let created=false;
    try {
      if(await permissionTask!=='granted') { render('Notifications were not enabled. You can try again whenever you like.'); return; }
      if(!registration) { await registrationTask; registration=await navigator.serviceWorker.ready; }
      subscription=await registration.pushManager.getSubscription();
      if(!subscription) {
        const key=Uint8Array.from(atob(publicKey.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
        subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
        created=true;
      }
      const result=await window.CinemaOwner.api('/api/push/subscribe','POST',{subscription:subscription.toJSON()});
      receipt(result.id); render('Movie alerts are on. Tap “Send test” to check delivery on this device.');
    } catch(error) {
      if(created && subscription) { await subscription.unsubscribe().catch(()=>{}); subscription=null; }
      render(error.message || 'Movie alerts could not be enabled. Please try again.');
    } finally { busy=false; render(status.textContent); }
  });
  disable.addEventListener('click',async()=>{
    if(busy || !subscription) return;
    busy=true; render('Turning alerts off…');
    try {
      const old=subscription.toJSON();
      if(!await subscription.unsubscribe()) throw new Error('Could not turn alerts off. Try again, or block notifications in site settings.');
      subscription=null; receipt('');
      if(signedIn) await window.CinemaOwner.api('/api/push/unsubscribe','POST',{subscription:old}).catch(()=>{});
      render('Alerts are off on this device.');
    } catch(error) { render(error.message); }
    finally { busy=false; render(status.textContent); }
  });
  test.addEventListener('click',async()=>{
    if(busy || !deviceId) return;
    busy=true; render('Queuing a test notification…');
    try {
      await window.CinemaOwner.api('/api/push/test','POST',{id:deviceId});
      render('Test queued. A notification should arrive in about a minute. Check Android’s site and app notification settings if it doesn’t.');
    } catch(error) { render(error.message); }
    finally { busy=false; render(status.textContent); }
  });
  window.addEventListener('cinema:owner-changed',ownerChanged);
  setup(); ownerChanged();
})();
