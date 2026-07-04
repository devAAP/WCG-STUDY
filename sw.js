const CACHE_NAME='wcg-study-v3';
const CACHE_URLS=['./', './index.html','./manifest.json','./WCG_Interactive_Timeline.html','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(CACHE_URLS).catch(()=>{})).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(c=>{if(c)return c;return fetch(e.request).then(r=>{if(!r||r.status!==200)return r;caches.open(CACHE_NAME).then(cache=>cache.put(e.request,r.clone()));return r;}).catch(()=>e.request.mode==='navigate'?caches.match('./index.html'):null);}));});
