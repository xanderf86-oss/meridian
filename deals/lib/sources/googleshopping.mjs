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

// A compact outline of the response (section names, sizes, a sample title), shown
// on the page for troubleshooting. Contains no keys or personal data.
export function describeResponse(data) {
  const sections = [];
  for (const [key, value] of Object.entries(data || {})) {
    if (Array.isArray(value)) {
      const first = value[0] || {};
      const nested = Array.isArray(first.shopping_results) ? first.shopping_results : null;
      const sample = (nested ? nested[0] : first) || {};
      sections.push({
        key,
        count: value.length,
        nested: nested ? value.reduce((sum, group) => sum + (group.shopping_results?.length || 0), 0) : null,
        fields: Object.keys(sample).slice(0, 14),
        sample: String(sample.title || first.title || "").slice(0, 70),
        price: sample.extracted_price ?? sample.price ?? null,
        store: sample.source || sample.seller || null,
      });
    } else if (value && typeof value === "object" && !["search_metadata", "search_parameters", "pagination", "serpapi_pagination"].includes(key)) {
      sections.push({ key, count: null, fields: Object.keys(value).slice(0, 14), sample: String(value.title || "").slice(0, 70) });
    }
  }
  return {
    asked: data?.search_parameters?.q ?? null,
    state: data?.search_information?.shopping_results_state ?? data?.search_information?.query_displayed ?? null,
    error: data?.error ?? null,
    sections,
  };
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
      google_domain: "google.com",
      location: env.SERPAPI_LOCATION || "United States",
      gl: "us",
      hl: "en",
      api_key: env.SERPAPI_KEY,
    });
    const data = await http.json(`https://serpapi.com/search.json?${params}`, { timeoutMs: 15000 });
    const items = googleShopping.parse(data);
    items.debug = describeResponse(data);
    return items;
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
