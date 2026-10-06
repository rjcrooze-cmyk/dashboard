/* Daily Dashboard service worker — offline-first.
   Added 2026-09-30. The daily refresh task rewrites ONLY the SWBUILD region below
   (build stamp + the current Star of Mysore page list); everything else is stable.
   Strategy:
     - navigations  : cache-first (instant open), revalidated in the background
     - same-origin  : cache-first, network fill on miss
     - cross-origin : never intercepted (article links, Ask endpoint) so they fail fast offline
   A new build changes the bytes of this file, which is what makes the browser install a new
   worker. It then WAITS (no skipWaiting on install) so the page can offer "tap to refresh"
   instead of swapping the page out from under someone mid-read. */

/*SWBUILD_START*/
const BUILD = "2026-10-06T01:35:28Z";
const SOM_PAGES = ["som/page-01.webp?v=3488", "som/page-02.webp?v=3488", "som/page-03.webp?v=3488", "som/page-04.webp?v=3488", "som/page-05.webp?v=3488", "som/page-06.webp?v=3488", "som/page-07.webp?v=3488", "som/page-08.webp?v=3488", "som/page-09.webp?v=3488", "som/page-10.webp?v=3488", "som/page-11.webp?v=3488", "som/page-12.webp?v=3488"];
/*SWBUILD_END*/

const CACHE = "dash-" + BUILD;
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
const INDEX = "./index.html";

async function fill(cache, urls) {
  const out = { ok: 0, fail: 0 };
  for (const u of urls) {
    try {
      // cache:"reload" bypasses the HTTP cache so a build never installs a stale copy
      const res = await fetch(new Request(u, { cache: "reload" }));
      if (res && (res.ok || res.type === "opaque")) { await cache.put(u, res.clone()); out.ok++; }
      else out.fail++;
    } catch (e) { out.fail++; }
  }
  return out;
}

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await fill(c, SHELL);
    await fill(c, SOM_PAGES);
    // deliberately NOT skipWaiting() — see header note
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("dash-") && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "SKIP_WAITING") { self.skipWaiting(); return; }
  if (d.type === "CACHE_ASSETS" && Array.isArray(d.urls)) {
    e.waitUntil((async () => {
      const c = await caches.open(CACHE);
      const missing = [];
      for (const u of d.urls) { if (!(await c.match(u))) missing.push(u); }
      const r = missing.length ? await fill(c, missing) : { ok: 0, fail: 0 };
      const total = d.urls.length;
      const have = total - r.fail;
      const cl = await self.clients.matchAll();
      cl.forEach(x => x.postMessage({ type: "CACHED", have, total, added: r.ok, build: BUILD }));
    })());
  }
  if (d.type === "PING") {
    e.waitUntil((async () => {
      const c = await caches.open(CACHE);
      const n = (await c.keys()).length;
      const cl = await self.clients.matchAll();
      cl.forEach(x => x.postMessage({ type: "STATUS", entries: n, build: BUILD }));
    })());
  }
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // links + Ask endpoint stay on the network

  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(INDEX);
      const net = fetch(new Request(INDEX, { cache: "reload" }))
        .then(res => { if (res && res.ok) c.put(INDEX, res.clone()); return res; })
        .catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }          // instant open
      const res = await net;
      return res || new Response("<h1>Offline</h1><p>Open this page once while online.</p>",
        { headers: { "Content-Type": "text/html" } });
    })());
    return;
  }

  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req) || await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok) c.put(req, res.clone());
      return res;
    } catch (err) {
      return new Response("", { status: 504, statusText: "Offline" });
    }
  })());
});
