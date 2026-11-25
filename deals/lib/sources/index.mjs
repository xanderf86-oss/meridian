import { bestbuy } from "./bestbuy.mjs";
import { ebay } from "./ebay.mjs";
import { googleShopping } from "./googleshopping.mjs";
import { redditDeals, redditReviews } from "./reddit.mjs";
import { slickdeals } from "./slickdeals.mjs";
import { youtubeReviews } from "./youtube.mjs";

export const SOURCES = [googleShopping, bestbuy, ebay, slickdeals, redditDeals, redditReviews, youtubeReviews];

export function isConfigured(source, env) {
  return source.requires.every((key) => Boolean(env[key]));
}
