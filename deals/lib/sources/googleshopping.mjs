// Google Shopping organic results via SerpApi (https://serpapi.com). This is how
// Amazon, Walmart, Target, Costco and hundreds of other stores are covered without
// scraping them. Paid placements (`ads`, `inline_shopping_results`) are never read.
import { cleanUrl, detectCondition, parsePrice, retailerFromUrl } from "../clean.mjs";

// "Amazon.com", "Walmart - Seller" → "Amazon", "Walmart" so stores group together.
function storeName(source) {
  if (!source) return null;
  const base = String(source).split(/\s+-\s+/)[0].trim();
  const asDomain = /^[\w-]+\.(com|net|org|us|co)$/i.test(base) ? retailerFromUrl(`https://${base}`) : base;
  return asDomain.replace(/\.(com|net|org|us)$/i, "");
}

export const googleShopping = {
  id: "google_shopping",
  label: "Google Shopping (all stores)",
  kind: "listings",
  requires: ["SERPAPI_KEY"],
  signup: "https://serpapi.com",
  async search(query, { http, env }) {
    const params = new URLSearchParams({
      engine: "google_shopping",
      q: query,
      gl: "us",
      hl: "en",
      num: "60",
      api_key: env.SERPAPI_KEY,
    });
    return googleShopping.parse(await http.json(`https://serpapi.com/search.json?${params}`, { timeoutMs: 15000 }));
  },
  parse(data) {
    // Organic results can also arrive grouped ("categorized") by Google. Paid
    // blocks (`ads`, `inline_shopping_results`) are never read.
    const grouped = (data?.categorized_shopping_results || []).flatMap((group) => group?.shopping_results || []);
    const seen = new Set();
    return [...(data?.shopping_results || []), ...grouped]
      .filter((item) => {
        const key = item.product_id || item.product_link || item.link || `${item.title}|${item.source}|${item.price}`;
        return !seen.has(key) && seen.add(key);
      })
      .map((item) => {
        const direct = [item.link, item.product_link].map(cleanUrl).find((url) => url && !/google\./.test(new URL(url).hostname));
        const url = direct || cleanUrl(item.product_link);
        return {
          source: "google_shopping",
          // Flagged here, removed (and counted) by the shared filter.
          sponsored: Boolean(item.sponsored || item.is_ad || item.ad),
          retailer: storeName(item.source) || (url ? retailerFromUrl(url) : "Unknown"),
          title: item.title,
          price: parsePrice(item.extracted_price ?? item.price),
          originalPrice: parsePrice(item.extracted_old_price ?? item.old_price),
          url,
          image: item.thumbnail || null,
          rating: Number(item.rating) || null,
          reviewCount: Number(item.reviews) || 0,
          condition: item.second_hand_condition ? detectCondition(item.second_hand_condition, "used") : detectCondition(item.title),
          note: [item.delivery, item.tag].filter(Boolean).join(" · ") || null,
        };
      });
  },
};
