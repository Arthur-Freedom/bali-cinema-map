'use strict';
(() => {
  const status=document.getElementById('push-status');
  const enable=document.getElementById('push-enable');
  const disable=document.getElementById('push-disable');
  const test=document.getElementById('push-test');
  const login=document.getElementById('push-login');
  const language=document.getElementById('push-language');
  const languagePanel=document.getElementById('push-language-panel');
  const languageFields=document.getElementById('push-language-fields');
  const languageOptions=document.getElementById('push-language-options');
  const anyLanguage=document.getElementById('push-language-any');
  const saveLanguages=document.getElementById('push-language-save');
  const cancelLanguages=document.getElementById('push-language-cancel');
  const languageNote=document.getElementById('push-language-note');
  const preferenceStatus=document.getElementById('push-preference-status');
  const languageName=window.CinemaShowtimes.languageName;
  const languageInputs=new Map();
  let savedLanguages=[], configReady=false, savingPreference=false, configVersion=0;
  const receiptKey='bali-cinema-push-device';
  let registration=null, subscription=null, publicKey=null, signedIn=false, busy=false, deviceId='';
  let registrationTask=null;
  let testRequestedAt=0, testTimer=null, lastReceipt=null;
  const standalone=matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;
  const desktop=/Windows/.test(navigator.userAgent);
  const notificationHelp=desktop
    ? 'No pop-up? In Windows Settings → System → Notifications, turn on Google Chrome and notification banners. Also check Do not disturb.'
    : /Android/.test(navigator.userAgent)
      ? `No pop-up? In Android Settings → Apps → ${standalone ? 'Bali Cinema' : 'Chrome'} → Notifications, enable banners for ${standalone ? 'General' : 'Sites'}. Also check Do not disturb.`
      : 'No pop-up? Check notification banners for this browser or app in your device settings, and check Do not disturb.';
  try { deviceId=localStorage.getItem(receiptKey)||''; } catch {}
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  const supported='serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  function receipt(value) { deviceId=value; try { if(value) localStorage.setItem(receiptKey,value); else localStorage.removeItem(receiptKey); } catch {} }
  function render(message) {
    const permission=supported ? Notification.permission : 'default';
    const active=Boolean(subscription && deviceId && permission==='granted');
    enable.hidden=!supported || (ios&&!standalone) || active || !signedIn;
    enable.disabled=busy || !publicKey || permission==='denied';
    disable.hidden=!active; disable.disabled=busy;
    test.hidden=!active || !signedIn || !deviceId; test.disabled=busy;
    login.hidden=signedIn || !supported || (ios&&!standalone);
    language.disabled=!signedIn || !configReady || savingPreference;
    languageFields.disabled=language.disabled;
    languageNote.textContent=signedIn ? 'Choose one or more. Applies to all your devices.' : 'Applies to all your devices. Sign in to change it.';
    if(message) status.textContent=message;
    else if(ios&&!standalone) status.textContent='On iPhone: open this site in Safari, tap Share → Add to Home Screen, then open it from that icon.';
    else if(!supported) status.textContent='This browser cannot receive website notifications. On Android, open this site in Chrome.';
    else if(permission==='denied') status.textContent='Notifications are blocked. Allow them in this browser’s site settings, then reload.';
    else if(active && lastReceipt) status.textContent=lastReceipt;
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
      await checkReceived();
    } catch { render('Movie alerts could not start. Reload the page and try again.'); }
  }
  async function ownerChanged() {
    const version=++configVersion;
    preferenceStatus.hidden=true;
    signedIn=Boolean(window.CinemaOwner?.signedIn);
    login.href=window.CinemaOwner?.loginUrl || '#owner-controls';
    login.textContent=window.CinemaOwner?.hasSavedSignIn ? 'Retry sign-in connection' : 'Sign in to manage alerts';
    publicKey=null; configReady=false; closeLanguages();
    render();
    if(signedIn) {
      document.getElementById('push-controls').open=true;
      try {
        const config=await window.CinemaOwner.api('/api/push/config');
        if(version!==configVersion) return;
        publicKey=config.publicKey;
        if(!Array.isArray(config.languages)) throw new Error('Alert language settings are not available yet. Reload in a moment.');
        languageOptions.replaceChildren(); languageInputs.clear();
        config.languages.filter(code=>/^[a-z]{2,3}$/.test(code))
          .sort((a,b)=>languageName(a).localeCompare(languageName(b)))
          .forEach(code=>{
            const label=document.createElement('label'), input=document.createElement('input');
            label.className='push-language-option'; input.type='checkbox'; input.value=code;
            input.addEventListener('change',()=>{anyLanguage.checked=![...languageInputs.values()].some(item=>item.checked);});
            label.append(input,document.createTextNode(languageName(code))); languageOptions.append(label); languageInputs.set(code,input);
          });
        savedLanguages=config.selectedLanguages || (config.language ? [config.language] : []);
        resetLanguages(); configReady=true;
        render();
      }
      catch(error) { if(version===configVersion) render(error.message); }
    }
  }
  function resetLanguages() {
    languageInputs.forEach((input,code)=>{input.checked=savedLanguages.includes(code);});
    anyLanguage.checked=!savedLanguages.length;
    const names=savedLanguages.map(languageName).sort();
    language.textContent=names.length>2 ? `${names.slice(0,2).join(', ')} + ${names.length-2} more` : names.join(', ') || 'Any language';
    language.title=names.join(', ') || 'Any language';
  }
  function closeLanguages(focus=false) {
    languagePanel.hidden=true; language.setAttribute('aria-expanded','false'); resetLanguages();
    if(focus) language.focus();
  }
  language.addEventListener('click',()=>{
    if(language.disabled) return;
    if(!languagePanel.hidden) { closeLanguages(); return; }
    resetLanguages(); languagePanel.hidden=false; language.setAttribute('aria-expanded','true');
  });
  anyLanguage.addEventListener('change',()=>{
    if(anyLanguage.checked) languageInputs.forEach(input=>{input.checked=false;});
    else anyLanguage.checked=![...languageInputs.values()].some(input=>input.checked);
  });
  cancelLanguages.addEventListener('click',()=>closeLanguages(true));
  languagePanel.addEventListener('keydown',event=>{
    if(event.key==='Escape' && !savingPreference) { event.preventDefault(); event.stopPropagation(); closeLanguages(true); }
  });
  saveLanguages.addEventListener('click',async()=>{
    if(!signedIn || !configReady || savingPreference) return;
    const selectedLanguages=[...languageInputs].filter(([,input])=>input.checked).map(([code])=>code), version=configVersion;
    savingPreference=true;
    preferenceStatus.hidden=false; preferenceStatus.textContent='Saving alert languages…'; render();
    try {
      const result=await window.CinemaOwner.api('/api/push/preferences','POST',{selectedLanguages});
      if(version!==configVersion) return;
      savedLanguages=result.selectedLanguages; closeLanguages();
      preferenceStatus.textContent=savedLanguages.length
        ? 'Saved for all devices. Movies matching any selected language will trigger alerts.'
        : 'Saved for all devices. New movies in any language will trigger alerts.';
    } catch(error) {
      if(version!==configVersion) return;
      preferenceStatus.textContent=`Could not save. Your previous selection is still active. ${error.message || 'Please try again.'}`;
    } finally { savingPreference=false; render(); if(languagePanel.hidden && signedIn) language.focus(); }
  });
  login.addEventListener('click',event=>{
    if(window.CinemaOwner?.hasSavedSignIn) { event.preventDefault(); window.CinemaOwner.reconnect(); }
    else login.href=window.CinemaOwner?.loginUrl || '#owner-controls';
  });
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
  function received(data) {
    if(data?.type!=='cinema:push-received' || data.test!==true || !Number.isFinite(data.receivedAt)) return;
    if(testRequestedAt && data.receivedAt<testRequestedAt) return;
    clearTimeout(testTimer);
    const time=new Date(data.receivedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    lastReceipt=`Test reached this browser at ${time}. ${notificationHelp}`;
    render(lastReceipt);
  }
  async function checkReceived() {
    if(!registration) return;
    const notifications=await registration.getNotifications().catch(()=>[]);
    const latest=notifications.map(n=>n.data).filter(d=>d?.test && d.receivedAt)
      .sort((a,b)=>b.receivedAt-a.receivedAt)[0];
    if(latest) received(latest);
  }
  if(supported) navigator.serviceWorker.addEventListener('message',event=>received(event.data));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden) checkReceived();});
  test.addEventListener('click',async()=>{
    if(busy || !deviceId) return;
    busy=true; lastReceipt=null; testRequestedAt=Date.now(); clearTimeout(testTimer);
    render('Queuing a test notification…');
    try {
      await window.CinemaOwner.api('/api/push/test','POST',{id:deviceId});
      if(!lastReceipt) {
        render('Test queued. Waiting for this browser to receive it… This can take a minute or two.');
        testTimer=setTimeout(()=>{
          if(!lastReceipt) render(`No receipt confirmed yet. Keep your internet connection on and try again shortly. ${notificationHelp}`);
        },120000);
      }
    } catch(error) { render(error.message); }
    finally { busy=false; render(status.textContent); }
  });
  window.addEventListener('cinema:owner-changed',ownerChanged);
  setup(); ownerChanged();
})();
