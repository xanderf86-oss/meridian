// YouTube Data API v3 review videos (free key: https://console.cloud.google.com).
import { decodeEntities, isSponsoredText, snippet } from "../clean.mjs";

export const youtubeReviews = {
  id: "youtube_reviews",
  label: "YouTube reviews",
  kind: "reviews",
  requires: ["YOUTUBE_API_KEY"],
  signup: "https://developers.google.com/youtube/v3/getting-started",
  async search(query, { http, env }) {
    const params = new URLSearchParams({
      part: "snippet",
      q: `${query} review`,
      type: "video",
      maxResults: "15",
      order: "relevance",
      relevanceLanguage: "en",
      publishedAfter: new Date(Date.now() - 400 * 86400_000).toISOString(),
      key: env.YOUTUBE_API_KEY,
    });
    return youtubeReviews.parse(await http.json(`https://www.googleapis.com/youtube/v3/search?${params}`));
  },
  parse(data) {
    return (data?.items || [])
      .filter((item) => item.id?.videoId && !isSponsoredText(item.snippet?.title, item.snippet?.description))
      .map((item) => ({
        source: "youtube_reviews",
        site: decodeEntities(item.snippet.channelTitle || "YouTube"),
        title: decodeEntities(item.snippet.title),
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(item.id.videoId)}`,
        snippet: snippet(item.snippet.description, 220),
        postedAt: Date.parse(item.snippet.publishedAt) || null,
      }));
  },
};
