# Deal Desk

A no-ads price comparison app for Black Friday (and every other day). Type a
product, and it queries every connected store at once, then shows:

- **Every matching listing, cheapest first**, each with a direct link to the
  retailer's product page.
- **Lowest new price per store**, the typical (median) price, and a
  review-weighted buyer rating.
- **What owners and reviewers say**: Reddit threads from real owners and
  YouTube review videos.
- **Community-found deals** from Slickdeals and Reddit deal subreddits
  (Costco, Woot and other stores that have no public API often show up here).

## What gets removed

- Sponsored and paid placements. Google Shopping `ads` and inline sponsored
  blocks are never read, and listings flagged sponsored or promoted are dropped.
  So are Reddit promoted, stickied and mod posts, and anything labelled
  "sponsored", "#ad" or "paid partnership".
- Ad and click-tracking redirects such as `googleadservices`, `doubleclick` and
  Amazon `sspa/click`.
- Affiliate and tracking parameters (`tag=`, `utm_*`, eBay `mkcid`/`campid`,
  Walmart `wmlspartner`, Rakuten/CJ/Impact ids). Known affiliate redirect
  wrappers are unwrapped, so every link goes straight to the listing.
- Off-topic results: every meaningful word you typed must be in the title.
- Accessories ("case for…", "compatible with…") and suspiciously low "new"
  prices (under 35% of the median) are flagged and hidden by default.
  There's a toggle to show them.

## Sources

| Source | Covers | Key |
| --- | --- | --- |
| Google Shopping (via SerpApi) | Amazon, Walmart, Target, Costco, Newegg, B&H, brand stores… | `SERPAPI_KEY` (paid, has a free tier) |
| Best Buy Products API | Best Buy | `BESTBUY_API_KEY` (free) |
| eBay Browse API | eBay fixed-price listings | `EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET` (free) |
| Slickdeals RSS | Community-posted deals | none |
| Reddit | Deal subreddits + owner reviews | none (optional OAuth app for higher limits) |
| YouTube Data API | Review videos | `YOUTUBE_API_KEY` (free) |

The app only uses official APIs and public feeds. It doesn't scrape retailer
sites: Amazon, Walmart and others forbid that and block it, so their prices
come through Google Shopping instead. Sources without keys are skipped, and the
footer shows which ones are connected.

## Run locally

```sh
cd deals
cp .env.example .env   # fill in whichever keys you have
node --env-file=.env server.mjs
# open http://localhost:8788
npm test
```

No dependencies. It needs Node 22.

## Deploy (reachable from anywhere)

It's a single stateless Node process. Anywhere that runs Node or Docker works:

- **Render / Railway**: new Web Service from this repo, root directory `deals`,
  start command `node server.mjs`, add the keys as environment variables.
- **Fly.io / Cloud Run / any container host**: `docker build -t deal-desk deals/`
  and deploy the image. It listens on `$PORT` (8080 in the image).

Results are cached for 10 minutes per query, and each visitor is limited to 20
searches a minute, which keeps API usage predictable.
