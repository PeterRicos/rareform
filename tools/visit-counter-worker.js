/**
 * visit-counter-worker.js  —  all-time page view counter for randomstock.shop
 *
 * Deployed on a custom zone route (stats.randomstock.shop/*) behind Cloudflare WAF
 * and rate-limiting rules (see tools/wrangler.jsonc). Bind a KV namespace to VISITS
 * and set STATS_KEY as an encrypted secret.
 *
 * Privacy: records only normalized site routes ("/", "/product/<slug>/", or "/other").
 * No IP address, no user agent, no referrer, no query string, no fingerprint.
 *
 * Endpoints
 *   GET|POST /hit?u=/path     count one view, returns 204 (used by boot.js)
 *   GET /stats                JSON: all-time total, today, last 30 days, top paths
 *                             Auth: Authorization: Bearer <STATS_KEY> (or X-Stats-Key)
 *
 * Storage model: a single JSON document ("visits:v1") holds { allTime, days, paths }
 * so /hit takes 2 KV ops (1 get + 1 put) and /stats takes 1 KV read (zero N+1 loops).
 *
 * Cloudflare Dashboard WAF Rate Limiting (recommended on zone randomstock.shop):
 *   - /hit*   : e.g. 30 requests / 10 seconds per IP -> Block / Managed Challenge
 *   - /stats* : e.g. 5 requests / 1 minute per IP -> Block
 */

const ALLOWED_ORIGIN = "https://randomstock.shop";
const MAX_PATHS = 500;
const STORE_KEY = "visits:v1";

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};

function hitCorsHeaders() {
  return {
    "access-control-allow-origin": ALLOWED_ORIGIN,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...SECURITY_HEADERS,
    },
  });
}

/** YYYY-MM-DD in UTC, so a "day" rolls over at the same moment for everyone. */
function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/**
 * Normalize and allowlist site paths: "/" (including "/index.html") or
 * "/product/<slug>/" matching lowercase slug characters. Unknown paths bucket
 * into "/other" so arbitrary ?u= strings cannot pollute KV.
 */
function cleanPath(raw) {
  if (!raw) return "/";
  let path = String(raw).split("#")[0].split("?")[0].trim() || "/";
  if (!path.startsWith("/")) path = "/" + path;
  if (path === "/" || path === "/index.html") return "/";
  if (/^\/product\/[a-z0-9-]{1,100}\/?$/.test(path)) {
    return path.endsWith("/") ? path : path + "/";
  }
  return "/other";
}

async function sha256(str) {
  const bytes = new TextEncoder().encode(str);
  return crypto.subtle.digest("SHA-256", bytes);
}

async function timingSafeEquals(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const [da, db] = await Promise.all([sha256(a), sha256(b)]);
  return crypto.subtle.timingSafeEqual(da, db);
}

async function loadStore(env) {
  const raw = await env.VISITS.get(STORE_KEY, "json");
  if (raw && typeof raw === "object") {
    return {
      allTime: Number.isFinite(raw.allTime) ? raw.allTime : 0,
      days: raw.days && typeof raw.days === "object" ? raw.days : {},
      paths: raw.paths && typeof raw.paths === "object" ? raw.paths : {},
    };
  }
  return { allTime: 0, days: {}, paths: {} };
}

async function handleHit(request, env) {
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== ALLOWED_ORIGIN) {
    return json({ error: "forbidden" }, 403);
  }

  const url = new URL(request.url);
  let path = cleanPath(url.searchParams.get("u"));
  const today = dayKey();

  const store = await loadStore(env);
  store.allTime += 1;
  store.days[today] = (store.days[today] || 0) + 1;

  if (!(path in store.paths) && Object.keys(store.paths).length >= MAX_PATHS) {
    path = "/other";
  }
  store.paths[path] = (store.paths[path] || 0) + 1;

  await env.VISITS.put(STORE_KEY, JSON.stringify(store));

  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "no-store",
      ...SECURITY_HEADERS,
      ...hitCorsHeaders(),
    },
  });
}

function readAuthKey(request) {
  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const hdr = request.headers.get("x-stats-key");
  return hdr ? hdr.trim() : "";
}

async function handleStats(request, env) {
  if (request.method !== "GET") {
    return json({ error: "method not allowed" }, 405);
  }

  const supplied = readAuthKey(request);
  if (!env.STATS_KEY || !(await timingSafeEquals(supplied, env.STATS_KEY))) {
    return json({ error: "forbidden" }, 403);
  }

  const store = await loadStore(env);
  const ordered = Object.keys(store.days).sort();
  const topPaths = Object.entries(store.paths)
    .map(([path, views]) => ({ path, views }))
    .sort((a, b) => b.views - a.views);

  return json({
    allTime: store.allTime,
    today: store.days[dayKey()] || 0,
    daysTracked: ordered.length,
    firstDay: ordered[0] || null,
    last30: ordered.slice(-30).map((date) => ({ date, views: store.days[date] })),
    topPaths: topPaths.slice(0, 25),
  });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        if (url.pathname === "/hit") {
          return new Response(null, {
            status: 204,
            headers: { ...SECURITY_HEADERS, ...hitCorsHeaders() },
          });
        }
        return new Response(null, { status: 405, headers: SECURITY_HEADERS });
      }

      switch (url.pathname) {
        case "/hit":
          return await handleHit(request, env);
        case "/stats":
          return await handleStats(request, env);
        default:
          return json({ error: "not found" }, 404);
      }
    } catch (_err) {
      return json({ error: "service unavailable" }, 503);
    }
  },
};
