import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanUrl, detectCondition, isSponsoredText, looksLikeAccessory, matchesQuery, parsePrice, queryTokens } from "../lib/clean.mjs";

test("cleanUrl strips tracking and unwraps redirects", () => {
  assert.equal(cleanUrl("https://www.amazon.com/dp/B0D1/ref=sr_1_1?tag=aff-20&th=1&utm_source=x"), "https://www.amazon.com/dp/B0D1?th=1");
  assert.equal(cleanUrl("https://www.google.com/url?url=https%3A%2F%2Fwww.walmart.com%2Fip%2F1%3Fwmlspartner%3Dz"), "https://www.walmart.com/ip/1");
  assert.equal(cleanUrl("https://click.linksynergy.com/deeplink?id=1&murl=https%3A%2F%2Fwww.target.com%2Fp%2FA-1"), "https://www.target.com/p/A-1");
  assert.equal(cleanUrl("https://www.googleadservices.com/pagead/aclk?sa=L"), null);
  assert.equal(cleanUrl("https://www.amazon.com/sspa/click?spc=1"), null);
  assert.equal(cleanUrl("javascript:alert(1)"), null);
  assert.equal(cleanUrl("http://example.com/p?id=4#x"), "https://example.com/p?id=4");
});

test("parsePrice", () => {
  assert.equal(parsePrice("Now $1,299.99 (was $1,499)"), 1299.99);
  assert.equal(parsePrice("$169"), 169);
  assert.equal(parsePrice("Free"), null);
  assert.equal(parsePrice(0), null);
});

test("query matching and accessories", () => {
  const tokens = queryTokens("Black Friday AirPods Pro 2 deal");
  assert.deepEqual(tokens, ["airpods", "pro"]);
  assert.ok(matchesQuery("Apple AirPods Pro (2nd gen)", tokens));
  assert.ok(!matchesQuery("Apple AirPods Max", tokens));
  assert.ok(matchesQuery("Samsung 990 PRO 2 TB SSD", queryTokens("990 pro 2tb")));
  assert.ok(looksLikeAccessory("Silicone Case for AirPods Pro 2", "airpods pro"));
  assert.ok(!looksLikeAccessory("Apple AirPods Pro 2 with MagSafe case", "airpods pro case"));
  assert.ok(!looksLikeAccessory("Apple AirPods Pro 2", "airpods pro"));
});

test("condition and sponsored detection", () => {
  assert.equal(detectCondition("Geek Squad Certified Refurbished"), "refurbished");
  assert.equal(detectCondition("Pre-Owned"), "used");
  assert.equal(detectCondition("Brand new sealed"), "new");
  assert.ok(isSponsoredText("Sponsored · Apple AirPods"));
  assert.ok(isSponsoredText("Great earbuds #ad"));
  assert.ok(!isSponsoredText("Adapter for USB-C"));
  assert.ok(!isSponsoredText("Advanced noise cancelling"));
});
