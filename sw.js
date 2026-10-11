// sw.js — one job: never let a browser run a previous deploy of index.html.
//
// GitHub Pages sends "Cache-Control: max-age=600" with the HTML and offers no way
// to change that header, so for ten minutes after a deploy a returning shopper can
// be served the index.html they already had cached. That HTML is not just stale
// text: it carries its own inline handlers and points at ?v= asset URLs from the
// previous build. It is why "I clicked dismiss and the bar came back" (and every
// similar complaint) only ever happens inside that window.
//
// Assets do not have this problem — stamp-assets.js already gives each deploy new
// ?v= URLs — so this worker deliberately touches exactly one thing: navigations.
// It fetches them with cache:"no-store", which tells the browser's HTTP cache to
// step aside and ask the network for the current document, and tells any cache in
// the path (a CDN that honours the request directive) to do the same. The
// alternative, cache:"no-cache", would revalidate instead and save a few kilobytes
// on a 304 — but the document is fetched once per visit while freshness is the
// whole point, so the stronger directive wins.
//
// It stores nothing. There is no offline copy, no cache list to invalidate and no
// way for a bad deploy to be trapped behind it: if the network fails, the request
// falls back to an ordinary fetch (which may answer from the HTTP cache, exactly
// as it would with no worker installed).
//
// To remove it: delete this file and the "FRESH-HTML WORKER" block in index.html.
// Browsers drop a worker whose script 404s on the next update check; the
// registration in index.html is what keeps it alive, so removing both is enough.

self.addEventListener('install', function () {
  // Take over as soon as this version is ready, without waiting for the tabs that
  // are already open to close.
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  // Start controlling the pages that are open right now, so the fix applies on the
  // next navigation instead of the one after it.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (event) {
  var request = event.request;

  // Navigations only. CSS, JS, images and the visit counter keep their normal
  // caching, and non-GET requests are never touched.
  if (request.method !== 'GET' || request.mode !== 'navigate') return;

  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .catch(function () {
        // Offline or blocked: behave like a browser with no worker installed.
        return fetch(request);
      })
  );
});