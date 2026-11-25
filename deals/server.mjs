import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { runSearch } from "./lib/aggregate.mjs";
import { createHistoryStore } from "./lib/history.mjs";
import { storageFromEnv } from "./lib/storage.mjs";
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
const REFRESH_EVERY_MS = 20 * 60 * 60 * 1000;

export function createApp({
  env = process.env,
  fetchImpl = globalThis.fetch,
  sources = SOURCES,
  history: historyOption = null,
  now = () => Date.now(),
} = {}) {
  const http = makeHttp(fetchImpl);
  const history =
    historyOption ||
    createHistoryStore({
      storage: storageFromEnv(env, http, join(fileURLToPath(new URL(".", import.meta.url)), "data")),
      watchLimit: Number(env.WATCH_LIMIT || 10),
    });
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
      watch: tracked.watch,
      tracker: await history.status(),
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

  // Re-check every watched product at most once a day so its history has no
  // gaps. Triggered by any visit and by GET /api/refresh (for a daily ping).
  let refreshing = null;
  async function refreshWatched() {
    if (refreshing) return { started: 0, running: true };
    const queries = await history.claimRefresh(REFRESH_EVERY_MS);
    if (!queries) return { started: 0 };
    refreshing = (async () => {
      for (const query of queries) {
        await runSearch(query, { sources, env, http })
          .then((data) => history.record(query, data))
          .catch((error) => console.warn("refresh failed:", query, error.message));
      }
      await history.flush();
      console.log(`refreshed ${queries.length} watched products`);
    })().finally(() => {
      refreshing = null;
    });
    return { started: queries.length };
  }
  const refreshInBackground = () => refreshWatched().catch((error) => console.warn("refresh failed:", error.message));

  function readJson(request) {
    return new Promise((resolve, reject) => {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
        if (body.length > 2000) reject(Object.assign(new Error("too large"), { code: "EBODY" }));
      });
      request.on("end", () => {
        try {
          resolve(JSON.parse(body || "{}"));
        } catch {
          reject(Object.assign(new Error("bad json"), { code: "EBODY" }));
        }
      });
      request.on("error", reject);
    });
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
        refreshInBackground();
        return send(response, 200, await search(query));
      }
      if (url.pathname === "/api/history") {
        const query = String(url.searchParams.get("q") || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 100);
        if (query.length < 2) return send(response, 400, { error: "Type at least two characters." });
        const asin = /^[A-Z0-9]{10}$/.test(url.searchParams.get("asin") || "") ? url.searchParams.get("asin") : null;
        if (limited(request)) return send(response, 429, { error: "Too many requests — wait a minute and try again." });
        return send(response, 200, await priceHistory(query, asin));
      }
      if (url.pathname === "/api/watchlist") {
        refreshInBackground();
        return send(response, 200, { items: await history.watchlist(), tracker: await history.status() });
      }
      if (url.pathname === "/api/watch") {
        if (request.method !== "POST") return send(response, 405, { error: "Method not allowed." });
        if (limited(request)) return send(response, 429, { error: "Too many requests — wait a minute and try again." });
        const body = await readJson(request);
        const query = String(body.q || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 100);
        const result = await history.setWatch(query, body.on !== false);
        if (!result.ok) return send(response, 409, { error: result.reason });
        return send(response, 200, { watch: result.watch, tracker: await history.status() });
      }
      if (url.pathname === "/api/refresh") {
        return send(response, 202, await refreshWatched());
      }
      if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405, { error: "Method not allowed." });
      const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
      const filePath = normalize(join(ROOT, pathname));
      if (!filePath.startsWith(ROOT)) return send(response, 403, { error: "Forbidden." });
      const file = await readFile(filePath);
      return send(response, 200, file, TYPES[extname(filePath)] || "application/octet-stream");
    } catch (error) {
      if (error?.code === "EBODY") {
        if (!response.headersSent) send(response, 400, { error: "Bad request." });
        return;
      }
      if (error?.code === "ENOENT" || error?.code === "EISDIR") {
        if (!response.headersSent) send(response, 404, { error: "Not found." });
        return;
      }
      console.error(error);
      if (!response.headersSent) send(response, 500, { error: "Search failed. Try again." });
    }
  });
  server.history = history;
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const port = Number(process.env.PORT || 8788);
  const app = createApp();
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
      // Save any unsaved price history before the host stops the process.
      Promise.race([app.history.flush(), new Promise((r) => setTimeout(r, 8000))]).finally(() => process.exit(0));
    });
  }
  app.listen(port, "0.0.0.0", () => {
    const on = SOURCES.filter((s) => isConfigured(s, process.env)).map((s) => s.id);
    console.log(`Deals listening on ${port}; sources: ${on.join(", ")}; history: ${app.history.storage.name}`);
  });
}
