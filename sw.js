'use strict';
// Notifications only: no fetch handler or offline cache, so schedules stay fresh.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let data={};
  try { data=event.data?.json() || {}; } catch {}
  const base=new URL(self.registration.scope);
  let url=base.href;
  try { const candidate=new URL(data.url,base); if(candidate.origin===base.origin && candidate.pathname===base.pathname) url=candidate.href; } catch {}
  event.waitUntil(self.registration.showNotification(String(data.title || 'New movies in Bali').slice(0,120),{
    body:String(data.body || 'Open Bali cinema map to see the latest listings.').slice(0,300),
    icon:new URL('icons/icon-192.png',base).href,
    badge:new URL('icons/badge-96.png',base).href,
    tag:String(data.tag || 'bali-new-movies').slice(0,100),renotify:false,
    data:{url}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const target=event.notification.data?.url || self.registration.scope;
    const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const tab=tabs.find(client=>client.url.startsWith(self.registration.scope));
    if(tab) { await tab.navigate(target); return tab.focus(); }
    return self.clients.openWindow(target);
  })());
});
