const V='suivi-v39';
const SHELL=['./','index.html','style.css','app.js','manifest.webmanifest','icon-192.png','icon-512.png','logo.png','splash-logo.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>Promise.all(SHELL.map(f=>fetch(f,{cache:'reload'}).then(r=>{if(!r.ok)throw 0;return c.put(f,r)})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return; // les données (Google) ne passent jamais par le cache
  e.respondWith(fetch(e.request.url,{cache:'no-cache'}).then(r=>{const c=r.clone();caches.open(V).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request).then(m=>m||caches.match('index.html'))));
});
