// Slickdeals public search RSS: community-posted, community-voted deals (no key).
import { parsePrice, snippet } from "../clean.mjs";
import { parseRss } from "../rss.mjs";

export const slickdeals = {
  id: "slickdeals",
  label: "Slickdeals (community)",
  kind: "community",
  requires: [],
  async search(query, { http }) {
    const params = new URLSearchParams({ q: query, searcharea: "deals", searchin: "first", rss: "1" });
    const xml = await http.text(`https://slickdeals.net/newsearch.php?${params}`, {
      headers: { accept: "application/rss+xml, application/xml" },
    });
    return slickdeals.parse(xml);
  },
  parse(xml) {
    return parseRss(xml).map((item) => {
      const store = item.title.match(/\bat\s+([A-Z][\w&.'-]*(?:\s[A-Z][\w&.'-]*){0,2})\s*$/)?.[1];
      return {
        source: "slickdeals",
        retailer: store || "Slickdeals",
        title: item.title,
        price: parsePrice(item.title),
        originalPrice: null,
        url: item.link,
        discussionUrl: item.link,
        image: item.description.match(/<img[^>]+src="([^"]+)"/i)?.[1] || null,
        rating: null,
        reviewCount: 0,
        postedAt: Date.parse(item.pubDate) || null,
        summary: snippet(item.description, 200),
      };
    });
  },
};
