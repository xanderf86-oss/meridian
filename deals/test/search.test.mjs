import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../server.mjs";
import { createHistoryStore } from "../lib/history.mjs";
import * as F from "./fixtures.mjs";

const ENV = { BESTBUY_API_KEY: "k", EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "s", SERPAPI_KEY: "k", YOUTUBE_API_KEY: "k" };

function mockFetch(calls) {
  return async (url, init) => {
    calls.push(String(url));
    const u = new URL(url);
    const json = (body) => new Response(JSON.stringify(body), { status: 200 });
    if (u.hostname === "api.bestbuy.com") return json(F.bestbuyData);
    if (u.pathname.includes("oauth2/token")) return json({ access_token: "t", expires_in: 7200 });
    if (u.hostname === "api.ebay.com") return json(F.ebayData);
    if (u.hostname === "serpapi.com") return json(F.serpData);
    if (u.hostname === "slickdeals.net") return new Response(F.slickXml, { status: 200 });
    if (u.hostname === "www.reddit.com" && u.pathname.startsWith("/r/")) return json(F.redditDealsData);
    if (u.hostname === "www.reddit.com") return json(F.redditReviewData);
    if (u.hostname === "www.googleapis.com") return json(F.youtubeData);
    return new Response("nope", { status: 404 });
  };
}

async function withServer(options, fn) {
  const server = createApp({ history: createHistoryStore(), ...options }).listen(0);
  await once(server, "listening");
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test("search aggregates, strips ads and ranks by price", async () => {
  const calls = [];
  await withServer({ env: ENV, fetchImpl: mockFetch(calls) }, async (base) => {
    const res = await fetch(`${base}/api/search?q=${encodeURIComponent("airpods pro 2")}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-security-policy"), /default-src 'self'/);
    const body = await res.json();

    assert.ok(body.sources.every((s) => s.state === "ok"), JSON.stringify(body.sources));
    const titles = body.offers.map((o) => o.title);
    assert.ok(!titles.some((t) => /sponsored|AD$|inline/i.test(t)), titles.join("\n"));
    assert.ok(!body.offers.some((o) => o.retailer === "Target"), "sponsored-flagged result dropped");
    assert.ok(body.removed.sponsored >= 2);
    assert.ok(body.dropped.some((d) => d.reason === "sponsored" && d.retailer === "Target"));
    const google = body.sources.find((s) => s.id === "google_shopping");
    assert.deepEqual([google.count, google.kept], [4, 3]);

    const prices = body.offers.map((o) => o.price);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b));

    assert.equal(body.summary.lowestNew.price, 159);
    assert.equal(body.summary.lowestNew.retailer, "Amazon");
    assert.equal(body.summary.lowestNew.url, "https://www.amazon.com/dp/B0D1XD1ZV3?th=1");

    const ebayNew = body.offers.find((o) => o.url.startsWith("https://www.ebay.com/itm/123"));
    assert.equal(ebayNew.url, "https://www.ebay.com/itm/123");
    const walmart = body.offers.find((o) => o.retailer === "Walmart");
    assert.equal(walmart.url, "https://www.walmart.com/ip/5689919121");
    const bb = body.offers.find((o) => o.retailer === "Best Buy" && o.price === 169.99);
    assert.equal(bb.url, "https://www.bestbuy.com/site/6447382.p?skuId=6447382");
    assert.equal(bb.percentOff, 32);
    assert.ok(body.offers.find((o) => /Case for/.test(o.title)).accessory);
    assert.ok(body.offers.find((o) => /knockoff/.test(o.title)).flags.includes("far-below-typical"));
    assert.equal(body.offers.find((o) => /Used Good/.test(o.title)).condition, "used");

    assert.ok(body.community.some((c) => c.retailer === "Woot" && c.url === "https://www.woot.com/offers/airpods-pro-2"));
    assert.ok(body.community.some((c) => c.retailer === "Costco" && c.price === 154.99));
    assert.ok(!body.community.some((c) => /Promoted|Expired|Weekly|ad$/i.test(c.title)));

    assert.deepEqual(body.reviews.map((r) => r.url), [
      "https://www.reddit.com/r/airpods/comments/r1/",
      "https://www.youtube.com/watch?v=abc123",
    ]);

    // Second call is served from cache.
    const before = calls.length;
    const again = await (await fetch(`${base}/api/search?q=AirPods%20Pro%202`)).json();
    assert.equal(again.cached, true);
    assert.equal(calls.length, before);
  });
});

test("unconfigured sources are skipped and failures are reported, not fatal", async () => {
  const calls = [];
  const failing = async (url) => {
    calls.push(String(url));
    if (String(url).includes("slickdeals")) throw new Error("network down");
    return mockFetch([])(url);
  };
  await withServer({ env: {}, fetchImpl: failing }, async (base) => {
    const body = await (await fetch(`${base}/api/search?q=airpods+pro`)).json();
    const state = Object.fromEntries(body.sources.map((s) => [s.id, s.state]));
    assert.equal(state.bestbuy, "not-configured");
    assert.equal(state.slickdeals, "error");
    assert.equal(state.reddit_deals, "ok");
    assert.ok(!calls.some((u) => u.includes("bestbuy") || u.includes("serpapi")));
    assert.ok(body.community.length > 0);
  });
});

test("input validation and static files", async () => {
  await withServer({ env: {}, fetchImpl: mockFetch([]) }, async (base) => {
    assert.equal((await fetch(`${base}/api/search?q=a`)).status, 400);
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/..%2fserver.mjs`)).status, 404);
    assert.equal((await fetch(`${base}/nope.js`)).status, 404);
  });
});
