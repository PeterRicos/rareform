// Random Stock boot extras: the visit counter and the fresh-HTML service
// worker registration. Both used to sit inline at the end of <body>; they
// live here now so the page carries no inline scripts besides the
// announcement-bar memory in the head (which has to run before first
// paint). Deferred, so this runs after app.js and before load.

    (function countVisit() {
      // Worker URL from the Cloudflare dashboard:
      // https://visit-counters.marra-pete.workers.dev
      var VISIT_ENDPOINT = "https://visit-counters.marra-pete.workers.dev";

      if (!VISIT_ENDPOINT) return; // not configured yet, so do nothing at all

      try {
        var endpoint =
          VISIT_ENDPOINT + "/hit?u=" + encodeURIComponent(location.pathname) +
          "&t=" + Date.now(); // cache-buster: Pages is served with max-age=600,
        //                             so a stable URL gets collapsed by the CDN
        //                             and whole days of visits go uncounted.
        if (navigator.sendBeacon) {
          navigator.sendBeacon(endpoint); // survives navigating away instantly
        } else {
          fetch(endpoint, { mode: "no-cors", cache: "no-store", keepalive: true });
        }
      } catch (err) {
        /* A counter must never be able to break the page. */
      }
    })();
  

    (function freshHtmlWorker() {
      if (!("serviceWorker" in navigator)) return;

      var secure = location.protocol === "https:" ||
        location.hostname === "localhost" || location.hostname === "127.0.0.1";
      if (!secure) return;

      window.addEventListener("load", function () {
        // updateViaCache:"none" keeps the worker script itself out of the HTTP
        // cache too, so a fix to sw.js lands on the visit after it is deployed.
        navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
          .catch(function () {
            /* Registration is a nicety: the site works exactly as before without it. */
          });
      });
    })();
  
