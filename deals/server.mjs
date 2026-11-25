import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { runSearch } from "./lib/aggregate.mjs";
import { createHistoryStore } from "./lib/history.mjs";
import { analyzeHistory, generalGuidance } from "./lib/insights.mjs";
import { keepaHistory } from "./lib/sources/keepa.mjs";
import { makeHttp } from "./lib/http.mjs";
import { SOURCES, isConfigured } from "./lib/sources/index.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const CACHE_MS = 10 * 60 * 1000;
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MIN || 20);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy":
    "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'",
};

const KEEPA_CACHE_MS = 6 * 60 * 60 * 1000;

export function createApp({
  env = process.env,
  fetchImpl = globalThis.fetch,
  sources = SOURCES,
  history = createHistoryStore({ dir: env.DATA_DIR || join(fileURLToPath(new URL(".", import.meta.url)), "data") }),
  now = () => Date.now(),
} = {}) {
  const http = makeHttp(fetchImpl);
  const cache = new Map();
  const keepaCache = new Map();
  const flights = new Map();
  const hits = new Map();

  function send(response, status, body, type = "application/json; charset=utf-8", extra = {}) {
    const payload = Buffer.isBuffer(body) ? body : JSON.stringify(body);
    response.writeHead(status, {
      "content-type": type,
      "cache-control": type.startsWith("application/json") ? "no-store" : "public, max-age=300",
      ...SECURITY_HEADERS,
      ...extra,
    });
    response.end(payload);
  }

  function limited(request) {
    if (!RATE_LIMIT) return false;
    const ip = String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "").split(",")[0].trim();
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((at) => now - at < 60_000);
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 5000) hits.clear();
    return recent.length > RATE_LIMIT;
  }

  async function search(query) {
    const key = query.toLowerCase().replace(/\s+/g, " ");
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) return { ...cached.data, cached: true };
    if (!flights.has(key)) {
      flights.set(
        key,
        runSearch(query, { sources, env, http })
          .then((data) => {
            cache.set(key, { at: Date.now(), data });
            history.record(query, data).catch((error) => console.warn("history record failed:", error.message));
            if (cache.size > 500) cache.delete(cache.keys().next().value);
            return data;
          })
          .finally(() => flights.delete(key)),
      );
    }
    return flights.get(key);
  }

  async function amazonHistory(asin) {
    if (!env.KEEPA_API_KEY) return { state: "not-configured", requires: ["KEEPA_API_KEY"], signup: "https://keepa.com/#!api" };
    if (!asin) return { state: "no-match" };
    const cached = keepaCache.get(asin);
    if (cached && Date.now() - cached.at < KEEPA_CACHE_MS) return cached.data;
    try {
      const found = await keepaHistory(asin, { http, env, now: now() });
      const data = found ? { state: "ok", ...found, insight: analyzeHistory(found.points, { now: now() }) } : { state: "no-match" };
      keepaCache.set(asin, { at: Date.now(), data });
      if (keepaCache.size > 500) keepaCache.delete(keepaCache.keys().next().value);
      return data;
    } catch (error) {
      console.warn("keepa failed:", error.message);
      return { state: "error", error: String(error.message).slice(0, 120) };
    }
  }

  async function priceHistory(query, asin) {
    const [tracked, amazon] = await Promise.all([history.series(query), amazonHistory(asin)]);
    return {
      query,
      tracked: {
        series: "Lowest new price across connected stores",
        since: tracked.since,
        points: tracked.points,
        insight: analyzeHistory(tracked.points, { now: now() }),
      },
      amazon,
      guidance: generalGuidance(query),
    };
  }

  // Optionally re-check recently searched products so the tracker keeps a daily
  // price even on days nobody searches. Each refresh spends API calls.
  function startRefresher(hours) {
    if (!(hours > 0)) return null;
    const timer = setInterval(async () => {
      const queries = (await history.recentQueries(14 * 86400_000)).slice(0, Number(env.TRACK_REFRESH_LIMIT || 50));
      for (const query of queries) {
        await runSearch(query, { sources, env, http })
          .then((data) => history.record(query, data))
          .catch((error) => console.warn("refresh failed:", query, error.message));
      }
      console.log(`refreshed ${queries.length} tracked products`);
    }, hours * 3600_000);
    timer.unref();
    return timer;
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://localhost");
      if (url.pathname === "/api/health") return send(response, 200, { ok: true });
      if (url.pathname === "/api/sources") {
        return send(response, 200, {
          sources: sources.map((s) => ({
            id: s.id, label: s.label, kind: s.kind, configured: isConfigured(s, env), requires: s.requires, signup: s.signup || null,
          })),
        });
      }
      if (url.pathname === "/api/search") {
        const query = String(url.searchParams.get("q") || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 100);
        if (query.length < 2) return send(response, 400, { error: "Type at least two characters." });
        if (limited(request)) return send(response, 429, { error: "Too many searches — wait a minute and try again." });
        return send(response, 200, await search(query));
      }
      if (url.pathname === "/api/history") {
        const query = String(url.searchParams.get("q") || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 100);
        if (query.length < 2) return send(response, 400, { error: "Type at least two characters." });
        const asin = /^[A-Z0-9]{10}$/.test(url.searchParams.get("asin") || "") ? url.searchParams.get("asin") : null;
        if (limited(request)) return send(response, 429, { error: "Too many requests — wait a minute and try again." });
        return send(response, 200, await priceHistory(query, asin));
      }
      if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405, { error: "Method not allowed." });
      const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
      const filePath = normalize(join(ROOT, pathname));
      if (!filePath.startsWith(ROOT)) return send(response, 403, { error: "Forbidden." });
      const file = await readFile(filePath);
      return send(response, 200, file, TYPES[extname(filePath)] || "application/octet-stream");
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "EISDIR") {
        if (!response.headersSent) send(response, 404, { error: "Not found." });
        return;
      }
      console.error(error);
      if (!response.headersSent) send(response, 500, { error: "Search failed. Try again." });
    }
  });
  server.startRefresher = startRefresher;
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const port = Number(process.env.PORT || 8788);
  const app = createApp();
  app.startRefresher(Number(process.env.TRACK_REFRESH_HOURS || 0));
  app.listen(port, "0.0.0.0", () => {
    const on = SOURCES.filter((s) => isConfigured(s, process.env)).map((s) => s.id);
    console.log(`Deals listening on ${port}; sources: ${on.join(", ")}`);
  });
}
