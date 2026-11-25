// Reddit: deal subreddits (posts link straight to the retailer) and real-owner
// review threads. Works without keys at low volume; set REDDIT_CLIENT_ID/SECRET
// for the higher OAuth limits.
import { isSponsoredText, parsePrice, retailerFromUrl, snippet } from "../clean.mjs";
import { tokenCache } from "../http.mjs";

const token = tokenCache();
const DEAL_SUBS = (process.env.REDDIT_DEAL_SUBS || "deals+buildapcsales+BlackFridayDeals+GameDeals+frugalmalefashion+appleswap")
  .replace(/[^A-Za-z0-9_+]/g, "");

async function redditJson(path, { http, env }) {
  if (env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET) {
    const bearer = await token(() =>
      http.json("https://www.reddit.com/api/v1/access_token", {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      }),
    );
    return http.json(`https://oauth.reddit.com${path}`, { headers: { authorization: `Bearer ${bearer}` } });
  }
  return http.json(`https://www.reddit.com${path.replace("?", ".json?")}`);
}

function usable(post) {
  return (
    post &&
    !post.promoted &&
    !post.stickied &&
    !post.over_18 &&
    !post.distinguished &&
    !post.removed_by_category &&
    !isSponsoredText(post.title, post.link_flair_text)
  );
}

function posts(data) {
  return (data?.data?.children || []).map((child) => child.data).filter(usable);
}

export const redditDeals = {
  id: "reddit_deals",
  label: "Reddit deal communities",
  kind: "community",
  requires: [],
  async search(query, ctx) {
    const params = new URLSearchParams({ q: query, restrict_sr: "1", sort: "new", t: "month", limit: "50", raw_json: "1" });
    return redditDeals.parse(await redditJson(`/r/${DEAL_SUBS}/search?${params}`, ctx));
  },
  parse(data) {
    return posts(data)
      .filter((post) => !post.is_self && post.url && !/reddit\.com|redd\.it|imgur\.com/.test(post.url))
      .filter((post) => !/expired|oos|out of stock|dead/i.test(post.link_flair_text || ""))
      .map((post) => ({
        source: "reddit_deals",
        retailer: retailerFromUrl(post.url),
        title: post.title.replace(/^\[[^\]]+\]\s*/, ""),
        price: parsePrice(post.title),
        originalPrice: null,
        url: post.url,
        discussionUrl: `https://www.reddit.com${post.permalink}`,
        image: null,
        rating: null,
        reviewCount: 0,
        postedAt: post.created_utc ? post.created_utc * 1000 : null,
        votes: post.score,
        comments: post.num_comments,
        summary: `r/${post.subreddit} · ${post.score} votes · ${post.num_comments} comments`,
      }));
  },
};

export const redditReviews = {
  id: "reddit_reviews",
  label: "Reddit owner reviews",
  kind: "reviews",
  requires: [],
  async search(query, ctx) {
    const params = new URLSearchParams({ q: `${query} (review OR "after" OR "worth it" OR "long term")`, sort: "relevance", t: "year", limit: "40", type: "link", raw_json: "1" });
    return redditReviews.parse(await redditJson(`/search?${params}`, ctx));
  },
  parse(data) {
    return posts(data)
      .filter((post) => post.score >= 3 && !/deal|sale|\$\d/i.test(post.title))
      .map((post) => ({
        source: "reddit_reviews",
        site: `r/${post.subreddit}`,
        title: post.title,
        url: `https://www.reddit.com${post.permalink}`,
        snippet: snippet(post.selftext, 320),
        score: post.score,
        comments: post.num_comments,
        postedAt: post.created_utc ? post.created_utc * 1000 : null,
      }));
  },
};
