import {
  cleanUrl, detectCondition, isAdUrl, isSponsoredText, looksLikeAccessory, matchesQuery, median, queryTokens, round2,
} from "./clean.mjs";
import { isConfigured } from "./sources/index.mjs";

const SOURCE_TIMEOUT_MS = 16_000;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Turns raw adapter output into clean, comparable offers. Everything that is an
// ad, a tracking redirect, off-topic, or missing a price/link is dropped here.
export function refineOffers(raw, query) {
  const tokens = queryTokens(query);
  const removed = { sponsored: 0, offTopic: 0, incomplete: 0, duplicate: 0 };
  const seen = new Set();
  const offers = [];
  for (const item of raw) {
    if (item.sponsored || isSponsoredText(item.title, item.note) || isAdUrl(item.url)) {
      removed.sponsored += 1;
      continue;
    }
    const url = cleanUrl(item.url);
    if (!url || !item.title || !item.price) {
      removed.incomplete += 1;
      continue;
    }
    if (!matchesQuery(item.title, tokens)) {
      removed.offTopic += 1;
      continue;
    }
    const key = `${url}|${item.price}`;
    if (seen.has(key)) {
      removed.duplicate += 1;
      continue;
    }
    seen.add(key);
    const originalPrice = item.originalPrice && item.originalPrice > item.price ? item.originalPrice : null;
    offers.push({
      ...item,
      url,
      discussionUrl: item.discussionUrl ? cleanUrl(item.discussionUrl) : null,
      originalPrice,
      savings: originalPrice ? round2(originalPrice - item.price) : null,
      percentOff: originalPrice ? Math.round((1 - item.price / originalPrice) * 100) : null,
      condition: item.condition || detectCondition(item.title),
      accessory: looksLikeAccessory(item.title, query),
      flags: [],
    });
  }

  // A "new" price far below what everyone else charges is almost always an
  // accessory, a part, or a scam listing. Flag it rather than call it the best deal.
  const typical = median(offers.filter((o) => !o.accessory && o.condition === "new").map((o) => o.price));
  if (typical) {
    for (const offer of offers) {
      if (!offer.accessory && offer.price < typical * 0.35) offer.flags.push("far-below-typical");
    }
  }
  offers.sort((a, b) => a.price - b.price);
  return { offers, removed, typical };
}

export function summarize(offers) {
  const core = offers.filter((o) => !o.accessory && !o.flags.length);
  const newOnes = core.filter((o) => o.condition === "new");
  const lowest = newOnes[0] || null;
  const byRetailer = new Map();
  for (const offer of newOnes) if (!byRetailer.has(offer.retailer)) byRetailer.set(offer.retailer, offer);
  const rated = core.filter((o) => o.rating && o.reviewCount > 0);
  const reviewTotal = rated.reduce((sum, o) => sum + o.reviewCount, 0);
  return {
    lowestNew: lowest && { price: lowest.price, retailer: lowest.retailer, url: lowest.url, title: lowest.title },
    lowestUsed: core.find((o) => o.condition !== "new") || null,
    typicalPrice: median(newOnes.map((o) => o.price)),
    retailers: byRetailer.size,
    bestPerRetailer: [...byRetailer.values()].map((o) => ({ retailer: o.retailer, price: o.price, url: o.url, title: o.title })),
    rating: reviewTotal
      ? { average: round2(rated.reduce((sum, o) => sum + o.rating * o.reviewCount, 0) / reviewTotal), reviews: reviewTotal }
      : null,
  };
}

export function refineReviews(raw, query) {
  const tokens = queryTokens(query);
  const seen = new Set();
  return raw
    .filter((r) => r.url && !seen.has(r.url) && seen.add(r.url))
    .filter((r) => !isSponsoredText(r.title, r.snippet))
    .filter((r) => matchesQuery(`${r.title} ${r.snippet}`, tokens))
    .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.postedAt || 0) - (a.postedAt || 0))
    .slice(0, 24);
}

export async function runSearch(query, { sources, env, http }) {
  const active = sources.filter((source) => isConfigured(source, env));
  const results = await Promise.allSettled(
    active.map((source) => withTimeout(source.search(query, { http, env }), SOURCE_TIMEOUT_MS)),
  );
  const status = sources.map((source) => {
    const index = active.indexOf(source);
    if (index < 0) return { id: source.id, label: source.label, kind: source.kind, state: "not-configured", requires: source.requires, signup: source.signup || null };
    const result = results[index];
    if (result.status === "rejected") {
      console.warn(`source ${source.id} failed:`, result.reason?.message || result.reason);
      return { id: source.id, label: source.label, kind: source.kind, state: "error", error: String(result.reason?.message || "failed").slice(0, 120) };
    }
    return { id: source.id, label: source.label, kind: source.kind, state: "ok", count: result.value.length };
  });

  const byKind = { listings: [], community: [], reviews: [] };
  active.forEach((source, index) => {
    if (results[index].status === "fulfilled") byKind[source.kind].push(...results[index].value);
  });

  const listings = refineOffers(byKind.listings, query);
  const community = refineOffers(byKind.community, query);
  community.offers.sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
  const reviews = refineReviews(byKind.reviews, query);

  return {
    query,
    asOf: Date.now(),
    summary: summarize(listings.offers),
    offers: listings.offers,
    community: community.offers.slice(0, 40),
    reviews,
    removed: {
      sponsored: listings.removed.sponsored + community.removed.sponsored,
      offTopic: listings.removed.offTopic + community.removed.offTopic,
      duplicate: listings.removed.duplicate + community.removed.duplicate,
      incomplete: listings.removed.incomplete + community.removed.incomplete,
    },
    sources: status,
  };
}
