import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { runSearch } from "./lib/aggregate.mjs";
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

export function createApp({ env = process.env, fetchImpl = globalThis.fetch, sources = SOURCES } = {}) {
  const http = makeHttp(fetchImpl);
  const cache = new Map();
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
            if (cache.size > 500) cache.delete(cache.keys().next().value);
            return data;
          })
          .finally(() => flights.delete(key)),
      );
    }
    return flights.get(key);
  }

  return createServer(async (request, response) => {
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
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const port = Number(process.env.PORT || 8788);
  createApp().listen(port, "0.0.0.0", () => {
    const on = SOURCES.filter((s) => isConfigured(s, process.env)).map((s) => s.id);
    console.log(`Deals listening on ${port}; sources: ${on.join(", ")}`);
  });
}
