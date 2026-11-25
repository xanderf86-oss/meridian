// Best Buy Products API (official, free key: https://developer.bestbuy.com).
import { detectCondition, parsePrice, queryTokens } from "../clean.mjs";

const SHOW = [
  "sku", "name", "salePrice", "regularPrice", "onSale", "customerReviewAverage",
  "customerReviewCount", "image", "condition", "onlineAvailability", "freeShipping",
].join(",");

export const bestbuy = {
  id: "bestbuy",
  label: "Best Buy",
  kind: "listings",
  requires: ["BESTBUY_API_KEY"],
  signup: "https://developer.bestbuy.com",
  async search(query, { http, env }) {
    const terms = queryTokens(query).map((t) => t.replace(/[^a-z0-9]/g, "")).filter(Boolean).slice(0, 6);
    if (!terms.length) return [];
    const filter = terms.map((term) => `search=${term}`).join("&");
    const url =
      `https://api.bestbuy.com/v1/products((${filter}))` +
      `?apiKey=${encodeURIComponent(env.BESTBUY_API_KEY)}&format=json&pageSize=50&sort=salePrice.asc&show=${SHOW}`;
    return bestbuy.parse(await http.json(url));
  },
  parse(data) {
    return (data?.products || []).map((p) => ({
      source: "bestbuy",
      retailer: "Best Buy",
      title: p.name,
      price: parsePrice(p.salePrice),
      originalPrice: parsePrice(p.regularPrice),
      // The API's own `url` is a click-tracking redirect; link straight to the product page.
      url: `https://www.bestbuy.com/site/${encodeURIComponent(p.sku)}.p?skuId=${encodeURIComponent(p.sku)}`,
      image: p.image || null,
      rating: Number(p.customerReviewAverage) || null,
      reviewCount: Number(p.customerReviewCount) || 0,
      condition: detectCondition(p.condition, p.name),
      inStock: p.onlineAvailability !== false,
      note: p.freeShipping ? "Free shipping" : null,
    }));
  },
};
