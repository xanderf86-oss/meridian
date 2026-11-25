import {
  cleanUrl, detectCondition, isAdUrl, isResaleSite, isSponsoredText, looksLikeAccessory, matchesQuery, median, queryTokens, round2,
} from "./clean.mjs";
import { isConfigured } from "./sources/index.mjs";
import { asinFromUrl } from "./sources/keepa.mjs";

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
  // A sample of what was dropped and why, so the filtering can be inspected.
  const dropped = [];
  const related = [];
  const drop = (item, reason) => {
    removed[reason] += 1;
    if (dropped.length < 120) {
      dropped.push({ reason, source: item.source, retailer: item.retailer || null, title: String(item.title || "").slice(0, 140), price: item.price || null });
    }
  };
  for (const item of raw) {
    if (item.sponsored || isSponsoredText(item.title, item.note) || isAdUrl(item.url)) {
      drop(item, "sponsored");
      continue;
    }
    const url = cleanUrl(item.url);
    if (!url || !item.title || !item.price) {
      drop(item, "incomplete");
      continue;
    }
    if (!matchesQuery(item.title, tokens)) {
      drop(item, "offTopic");
      // Kept aside as "not an exact match", so a strict filter never leaves an empty page.
      if (related.length < 60 && !isResaleSite(item.retailer)) {
        related.push({
          source: item.source, retailer: item.retailer, title: item.title, price: item.price, url,
          image: item.image || null, rating: item.rating || null, reviewCount: item.reviewCount || 0,
          condition: item.condition || detectCondition(item.title), note: item.note || null,
          originalPrice: null, percentOff: null, accessory: looksLikeAccessory(item.title, query), flags: [],
        });
      }
      continue;
    }
    const key = `${url}|${item.price}`;
    if (seen.has(key)) {
      drop(item, "duplicate");
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
      flags: isResaleSite(item.retailer) ? ["resale-site"] : [],
    });
  }

  // A "new" price far below what everyone else charges is almost always an
  // accessory, a part, or a scam listing. Flag it rather than call it the best deal.
  const typical = median(offers.filter((o) => !o.accessory && !o.flags.length && o.condition === "new").map((o) => o.price));
  if (typical) {
    for (const offer of offers) {
      if (!offer.accessory && offer.price < typical * 0.35) offer.flags.push("far-below-typical");
    }
  }
  offers.sort((a, b) => a.price - b.price);
  return { offers, removed, dropped, related, typical };
}

export function summarize(offers) {
  const core = offers.filter((o) => !o.accessory && !o.flags.length);
  const newOnes = core.filter((o) => o.condition === "new");
  const lowest = newOnes[0] || null;
  const byRetailer = new Map();
  for (const offer of newOnes) if (!byRetailer.has(offer.retailer)) byRetailer.set(offer.retailer, offer);
  const rated = core.filter((o) => o.rating && o.reviewCount > 0);
  const reviewTotal = rated.reduce((sum, o) => sum + o.reviewCount, 0);
  const amazon = newOnes.find((o) => asinFromUrl(o.url));
  return {
    amazonAsin: amazon ? asinFromUrl(amazon.url) : null,
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
  const kept = (id, offers) => offers.filter((o) => o.source === id).length;

  const byKind = { listings: [], community: [], reviews: [] };
  active.forEach((source, index) => {
    if (results[index].status === "fulfilled") byKind[source.kind].push(...results[index].value);
  });

  const listings = refineOffers(byKind.listings, query);
  const community = refineOffers(byKind.community, query);
  community.offers.sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0));
  const reviews = refineReviews(byKind.reviews, query);
  for (const entry of status) {
    if (entry.state !== "ok") continue;
    if (entry.kind === "listings") entry.kept = kept(entry.id, listings.offers);
    if (entry.kind === "community") entry.kept = kept(entry.id, community.offers);
  }

  return {
    query,
    asOf: Date.now(),
    summary: summarize(listings.offers),
    offers: listings.offers,
    community: community.offers.slice(0, 40),
    reviews,
    // Counts are for store listings only; community posts are loosely matched
    // by their sites and would swamp the numbers.
    removed: listings.removed,
    dropped: listings.dropped,
    related: listings.related,
    sources: status,
  };
}
