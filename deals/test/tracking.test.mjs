import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../server.mjs";
import { createHistoryStore } from "../lib/history.mjs";
import { makeHttp } from "../lib/http.mjs";
import { githubStorage } from "../lib/storage.mjs";
import * as F from "./fixtures.mjs";

const DAY = 86400_000;
const result = (price, retailer = "Amazon") => ({ summary: { lowestNew: { price, retailer, url: "https://x.com/p" }, bestPerRetailer: [{ retailer, price }] } });

// A tiny in-memory stand-in for the GitHub Contents API.
function fakeGitHub({ failReads = false } = {}) {
  const state = { branches: new Set(["main"]), file: null, sha: 0, puts: 0, calls: [] };
  const json = (status, body) => new Response(JSON.stringify(body), { status });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    state.calls.push(`${method} ${u.pathname}`);
    assert.equal(init.headers.authorization, "Bearer tok");
    if (u.pathname === "/repos/me/repo") return json(200, { default_branch: "main" });
    if (u.pathname === "/repos/me/repo/git/ref/heads/main") return json(200, { object: { sha: "abc" } });
    if (u.pathname === "/repos/me/repo/git/ref/heads/deal-desk-data") return state.branches.has("deal-desk-data") ? json(200, {}) : json(404, {});
    if (u.pathname === "/repos/me/repo/git/refs" && method === "POST") {
      state.branches.add("deal-desk-data");
      return json(201, {});
    }
    if (u.pathname === "/repos/me/repo/contents/price-history.json") {
      if (method === "GET") {
        if (failReads) return json(500, {});
        if (!state.file) return json(404, {});
        return json(200, { sha: `s${state.sha}`, content: Buffer.from(state.file).toString("base64") });
      }
      const body = JSON.parse(init.body);
      if (!state.branches.has(body.branch)) return json(404, {});
      if (state.file && body.sha !== `s${state.sha}`) return json(409, {});
      state.file = Buffer.from(body.content, "base64").toString("utf8");
      state.sha += 1;
      state.puts += 1;
      return json(200, { content: { sha: `s${state.sha}` } });
    }
    return json(404, {});
  };
  return { state, fetchImpl };
}

const storageFor = (gh) => Object.assign(githubStorage({ http: makeHttp(gh.fetchImpl), token: "tok", repo: "me/repo" }), { saveDelayMs: 5 });

test("GitHub storage creates the data branch, saves, and reloads after a restart", async () => {
  const gh = fakeGitHub();
  const store = createHistoryStore({ storage: storageFor(gh) });
  await store.record("AirPods Pro 2", result(169));
  await store.flush();
  assert.ok(gh.state.branches.has("deal-desk-data"));
  assert.equal(gh.state.puts, 1);

  await store.record("AirPods Pro 2", result(175)); // not lower: nothing new to save
  await store.flush();
  await store.record("AirPods Pro 2", result(159));
  await store.flush();
  assert.equal(JSON.parse(gh.state.file).queries["2 airpods pro"].days[Object.keys(JSON.parse(gh.state.file).queries["2 airpods pro"].days)[0]].low, 159);

  const restarted = createHistoryStore({ storage: storageFor(gh) });
  assert.deepEqual((await restarted.series("airpods pro 2")).points.map((p) => p.price), [159]);
  await restarted.record("Dyson V15", result(499));
  await restarted.flush();
  assert.equal(Object.keys(JSON.parse(gh.state.file).queries).length, 2, "restart keeps earlier products");
});

test("a failed load never overwrites stored history", async () => {
  const gh = fakeGitHub({ failReads: true });
  gh.state.file = JSON.stringify({ version: 1, queries: { precious: { label: "precious", days: {} } } });
  gh.state.branches.add("deal-desk-data");
  const store = createHistoryStore({ storage: storageFor(gh) });
  await store.record("AirPods Pro 2", result(169));
  await store.flush();
  assert.equal(gh.state.puts, 0);
  assert.ok(JSON.parse(gh.state.file).queries.precious);
  assert.equal((await store.status()).healthy, false);
});

test("watchlist: start price, change, limit, and once-a-day refresh claim", async () => {
  let clock = Date.UTC(2026, 10, 20, 17);
  const store = createHistoryStore({ now: () => clock, watchLimit: 1 });
  assert.equal((await store.setWatch("never searched", true)).ok, false);
  await store.record("AirPods Pro 2", result(200));
  await store.record("Dyson V15", result(500));
  assert.equal((await store.setWatch("airpods pro 2", true)).watch.startPrice, 200);
  assert.match((await store.setWatch("dyson v15", true)).reason, /full/);
  clock += DAY;
  await store.record("AirPods Pro 2", result(170, "Target"));
  const [item] = await store.watchlist();
  assert.deepEqual([item.query, item.startPrice, item.price, item.retailer, item.changePercent, item.low, item.spark.length], ["AirPods Pro 2", 200, 170, "Target", -15, 170, 2]);

  assert.deepEqual(await store.claimRefresh(20 * 3600_000), ["AirPods Pro 2"]);
  assert.equal(await store.claimRefresh(20 * 3600_000), null, "already refreshed today");
  clock += DAY;
  assert.deepEqual(await store.claimRefresh(20 * 3600_000), ["AirPods Pro 2"]);
  assert.equal((await store.setWatch("airpods pro 2", false)).watch, null);
  assert.deepEqual(await store.watchlist(), []);
});

test("watch API and daily refresh endpoint", async () => {
  let clock = Date.UTC(2026, 10, 20, 17);
  const history = createHistoryStore({ now: () => clock });
  let serpCalls = 0;
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.hostname === "serpapi.com") {
      serpCalls += 1;
      return new Response(JSON.stringify(F.serpData));
    }
    return new Response("{}", { status: 404 });
  };
  const server = createApp({ env: { SERPAPI_KEY: "k" }, fetchImpl, history, now: () => clock }).listen(0);
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/api/watch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ q: "airpods pro 2" })).status, 409, "must search first");
    await fetch(`${base}/api/search?q=airpods+pro+2`);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal((await fetch(`${base}/api/watch`)).status, 405);
    const watched = await (await post({ q: "airpods pro 2" })).json();
    assert.equal(watched.watch.startPrice, 159);
    const hist = await (await fetch(`${base}/api/history?q=airpods+pro+2`)).json();
    assert.equal(hist.watch.startPrice, 159);
    assert.equal(hist.tracker.watched, 1);

    const before = serpCalls;
    clock += DAY;
    assert.deepEqual(await (await fetch(`${base}/api/refresh`)).json(), { started: 1 });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(serpCalls, before + 1);
    assert.equal((await (await fetch(`${base}/api/refresh`)).json()).started, 0, "only once a day");
    const list = await (await fetch(`${base}/api/watchlist`)).json();
    assert.equal(list.items[0].spark.length, 2);

    assert.equal((await post({ q: "airpods pro 2", on: false })).status, 200);
    assert.equal((await (await fetch(`${base}/api/watchlist`)).json()).items.length, 0);
    assert.equal((await fetch(`${base}/api/watch`, { method: "POST", body: "{bad" })).status, 400);
  } finally {
    server.close();
  }
});
