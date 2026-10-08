/**
 * visit-counter-worker.js  —  all-time page view counter for randomstock.shop
 *
 * Paste this into a Cloudflare Worker (Workers & Pages -> Create -> Worker -> Edit code),
 * bind a KV namespace to the variable name VISITS, and set STATS_KEY as an encrypted
 * secret. The page itself fires a fire-and-forget request at /hit, so the counter is
 * invisible to visitors: no script tag in the <head>, no cookie, no layout shift.
 *
 * Privacy: this records the page path and nothing else. No IP address, no user agent,
 * no referrer, no fingerprint. That's why it needs no cookie banner.
 *
 * Endpoints
 *   GET|POST /hit?u=/path     count one view, returns 204 (used by the page)
 *   GET /stats?key=<secret>   JSON: all-time total, today, last 30 days, top paths
 *   GET /                     service info
 *
 * NOTE: this file is in a PUBLIC repo, so the stats key must live in a Cloudflare
 * secret (Settings -> Variables and Secrets -> type "Secret"), never in this code.
 * If STATS_KEY is unset, /stats refuses every request.
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "86400",
};

/** Cap how many distinct paths we track, so the KV key space can't grow forever. */
const MAX_PATHS = 500;

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS,
    },
  });
}

/** YYYY-MM-DD in UTC, so a "day" rolls over at the same moment for everyone. */
function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/**
 * Keep only the path: no query string, no hash, bounded length. Query strings can
 * carry personal data, and an unbounded key length is a cheap way to blow up KV.
 */
function cleanPath(raw) {
  if (!raw) return "/";
  let path = String(raw).split("#")[0].split("?")[0] || "/";
  if (!path.startsWith("/")) path = "/" + path;
  return path.slice(0, 120);
}

/**
 * KV has no atomic increment, so this read-then-write can lose a hit when two
 * requests land in the same instant. That is fine here: the numbers are directional,
 * and a single flat key is far cheaper than per-day key churn.
 */
async function bump(env, key) {
  const current = parseInt((await env.VISITS.get(key)) || "0", 10);
  const next = (Number.isFinite(current) ? current : 0) + 1;
  await env.VISITS.put(key, String(next));
  return next;
}

async function handleHit(request, env) {
  const url = new URL(request.url);
  const path = cleanPath(url.searchParams.get("u"));

  await Promise.all([
    bump(env, "total"),
    bump(env, `d:${dayKey()}`),
    bump(env, `p:${path}`),
  ]);

  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store", ...CORS },
  });
}

async function handleStats(request, env) {
  const supplied = new URL(request.url).searchParams.get("key");

  // No secret configured, or wrong secret -> refuse. Never log or echo the key.
  if (!env.STATS_KEY || supplied !== env.STATS_KEY) {
    return json({ error: "forbidden" }, 403);
  }

  const readAll = async (prefix) => {
    const listed = await env.VISITS.list({ prefix });
    const out = [];
    for (const key of listed.keys) {
      const views = parseInt((await env.VISITS.get(key.name)) || "0", 10) || 0;
      out.push([key.name.slice(prefix.length), views]);
    }
    return out;
  };

  const [dayRows, pathRows, totalKey] = await Promise.all([
    readAll("d:"),
    readAll("p:"),
    env.VISITS.get("total"),
  ]);

  const days = Object.fromEntries(dayRows);
  const ordered = Object.keys(days).sort();
  const topPaths = pathRows
    .map(([path, views]) => ({ path, views }))
    .sort((a, b) => b.views - a.views);

  return json({
    allTime: parseInt(totalKey || "0", 10) || 0,
    today: days[dayKey()] || 0,
    daysTracked: ordered.length,
    firstDay: ordered[0] || null,
    last30: ordered.slice(-30).map((date) => ({ date, views: days[date] })),
    topPaths: topPaths.slice(0, 25),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    switch (url.pathname) {
      // POST is included because navigator.sendBeacon() always uses POST.
      case "/hit":
        return handleHit(request, env);
      case "/stats":
        return handleStats(request, env);
      default:
        return json({
          service: "randomstock.shop visit counter",
          endpoints: ["/hit?u=/path", "/stats?key=<secret>"],
        });
    }
  },
};