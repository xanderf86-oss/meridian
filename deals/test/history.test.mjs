import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
import { createHistoryStore, historyKey } from "../lib/history.mjs";
import { analyzeHistory, blackFriday, generalGuidance } from "../lib/insights.mjs";
import { asinFromUrl, dailyFromKeepa, keepaTimeToMs } from "../lib/sources/keepa.mjs";

const DAY = 86400_000;
const NOW = Date.UTC(2026, 10, 25, 15); // Wed before Black Friday 2026
const toKeepa = (ms) => ms / 60_000 - 21564000;

// Two years at $249, $169 over each Black Friday week, $199 around mid-July.
function syntheticDaily(now = NOW, current = 229) {
  const points = [];
  for (let t = Math.floor((now - 729 * DAY) / DAY) * DAY; t <= now; t += DAY) {
    const d = new Date(t);
    const bf = blackFriday(d.getUTCFullYear());
    let price = 249;
    if (t >= bf - 2 * DAY && t <= bf + 3 * DAY) price = 169;
    else if (d.getUTCMonth() === 6 && d.getUTCDate() >= 8 && d.getUTCDate() <= 17) price = 199;
    points.push({ t, price });
  }
  points.at(-1).price = current;
  return points;
}

test("Black Friday date", () => {
  assert.equal(new Date(blackFriday(2026)).toISOString().slice(0, 10), "2026-11-27");
  assert.equal(new Date(blackFriday(2025)).toISOString().slice(0, 10), "2025-11-28");
  assert.equal(new Date(blackFriday(2024)).toISOString().slice(0, 10), "2024-11-29");
});

test("asin extraction and keepa time", () => {
  assert.equal(asinFromUrl("https://www.amazon.com/Apple-AirPods/dp/B0D1XD1ZV3?th=1"), "B0D1XD1ZV3");
  assert.equal(asinFromUrl("https://www.amazon.com/gp/product/b0d1xd1zv3/"), "B0D1XD1ZV3");
  assert.equal(asinFromUrl("https://www.walmart.com/dp/B0D1XD1ZV3"), null);
  assert.equal(new Date(keepaTimeToMs(0)).toISOString(), "2011-01-01T00:00:00.000Z");
});

test("keepa step series becomes daily lows, skipping out-of-stock days", () => {
  const d0 = Date.UTC(2026, 10, 1);
  const csv = [toKeepa(d0), 24900, toKeepa(d0 + 2 * DAY + 3600_000), 19900, toKeepa(d0 + 2 * DAY + 7200_000), 22900, toKeepa(d0 + 4 * DAY), -1, toKeepa(d0 + 6 * DAY), 21900];
  const points = dailyFromKeepa(csv, { now: d0 + 7 * DAY });
  assert.deepEqual(points.map((p) => [(p.t - d0) / DAY, p.price]), [[0, 249], [1, 249], [2, 199], [3, 229], [6, 219], [7, 219]]);
});

test("verdicts", () => {
  const wait = analyzeHistory(syntheticDaily(NOW, 229), { now: NOW });
  assert.equal(wait.verdict, "wait");
  assert.match(wait.headline, /Black Friday \(2 days away\)/);
  assert.equal(wait.typicalBlackFridayDrop, 32);
  assert.equal(wait.low, 169);
  assert.ok(wait.seasonality.cheapest.includes("Nov"), JSON.stringify(wait.seasonality));

  const buy = analyzeHistory(syntheticDaily(NOW, 169), { now: NOW });
  assert.equal(buy.verdict, "buy");

  const later = Date.UTC(2026, 3, 10);
  const fair = analyzeHistory(syntheticDaily(later, 249), { now: later });
  assert.equal(fair.verdict, "fair");
  assert.ok(fair.reasons.some((r) => /cheapest in/.test(r)));

  const thin = analyzeHistory([{ t: NOW, price: 100 }], { now: NOW });
  assert.equal(thin.verdict, "not-enough-history");
  assert.match(thin.headline, /1 day/);
});

test("general guidance is keyword based", () => {
  assert.equal(generalGuidance("LG C4 65 OLED TV").length, 1);
  assert.deepEqual(generalGuidance("garden hose"), []);
});

test("tracker records daily lows and persists to disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "deals-"));
  let clock = Date.UTC(2026, 10, 20, 17);
  const store = createHistoryStore({ dir, now: () => clock });
  const result = (price, retailer) => ({ summary: { lowestNew: { price, retailer, url: "https://x.com" }, bestPerRetailer: [{ retailer, price }] } });
  await store.record("AirPods Pro 2", result(179, "Target"));
  await store.record("pro 2 airpods", result(169, "Amazon"));
  await store.record("AirPods Pro 2", result(189, "Walmart"));
  clock += DAY;
  await store.record("AirPods Pro 2", result(159, "Amazon"));
  const { points } = await store.series("airpods  PRO 2");
  assert.deepEqual(points.map((p) => [p.price, p.retailer]), [[169, "Amazon"], [159, "Amazon"]]);
  assert.equal(historyKey("Pro AirPods 2"), "2 airpods pro");
  await new Promise((r) => setTimeout(r, 1700));
  const saved = JSON.parse(await readFile(join(dir, "price-history.json"), "utf8"));
  assert.equal(Object.keys(saved.queries["2 airpods pro"].days).length, 2);
  const reloaded = createHistoryStore({ dir });
  assert.equal((await reloaded.series("AirPods Pro 2")).points.length, 2);
});

test("/api/history combines tracker and Keepa", async () => {
  const history = createHistoryStore();
  const daily = syntheticDaily(NOW, 229);
  const csv = daily.flatMap((p) => [toKeepa(p.t), Math.round(p.price * 100)]);
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ products: [{ title: "Apple AirPods Pro 2", csv: [csv, csv] }] }));
  };
  const server = createApp({ env: { KEEPA_API_KEY: "k" }, fetchImpl, history, now: () => NOW, sources: [] }).listen(0);
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await history.record("airpods pro 2", { summary: { lowestNew: { price: 170, retailer: "Amazon" }, bestPerRetailer: [] } });
    const body = await (await fetch(`${base}/api/history?q=airpods+pro+2&asin=B0D1XD1ZV3`)).json();
    assert.equal(body.amazon.state, "ok");
    assert.equal(body.amazon.url, "https://www.amazon.com/dp/B0D1XD1ZV3");
    assert.equal(body.amazon.insight.verdict, "wait");
    assert.ok(body.amazon.points.length > 700);
    assert.equal(body.tracked.points.length, 1);
    assert.equal(body.tracked.insight.verdict, "not-enough-history");
    await fetch(`${base}/api/history?q=airpods+pro+2&asin=B0D1XD1ZV3`);
    assert.equal(calls.length, 1, "keepa result is cached");
    const noKey = await (await fetch(`${base}/api/history?q=airpods&asin=bad`)).json();
    assert.equal(noKey.amazon.state, "no-match");
  } finally {
    server.close();
  }
});
