// eBay Browse API (official, free keys: https://developer.ebay.com).
import { detectCondition, parsePrice } from "../clean.mjs";
import { tokenCache } from "../http.mjs";

const token = tokenCache();

export const ebay = {
  id: "ebay",
  label: "eBay",
  kind: "listings",
  requires: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
  signup: "https://developer.ebay.com",
  async search(query, { http, env }) {
    const bearer = await token(() =>
      http.json("https://api.ebay.com/identity/v1/oauth2/token", {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
      }),
    );
    const params = new URLSearchParams({
      q: query,
      limit: "60",
      filter: "buyingOptions:{FIXED_PRICE},itemLocationCountry:US",
    });
    const data = await http.json(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
      headers: { authorization: `Bearer ${bearer}`, "x-ebay-c-marketplace-id": "EBAY_US" },
    });
    return ebay.parse(data);
  },
  parse(data) {
    return (data?.itemSummaries || [])
      .filter((item) => (item.price?.currency || "USD") === "USD")
      .map((item) => {
        const shipping = item.shippingOptions?.[0]?.shippingCost;
        const shipCost = shipping ? parsePrice(Number(shipping.value)) : null;
        const seller = item.seller?.feedbackPercentage ? `Seller ${item.seller.feedbackPercentage}% positive` : null;
        return {
          source: "ebay",
          retailer: "eBay",
          title: item.title,
          price: parsePrice(Number(item.price?.value)),
          originalPrice: parsePrice(Number(item.marketingPrice?.originalPrice?.value)),
          url: item.itemWebUrl,
          image: item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || null,
          rating: null,
          reviewCount: 0,
          condition: detectCondition(item.condition, item.title),
          note: [shipCost ? `+$${shipCost.toFixed(2)} shipping` : shipping ? "Free shipping" : null, seller]
            .filter(Boolean)
            .join(" · ") || null,
        };
      });
  },
};
