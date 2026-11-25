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

## Price history and best time to buy

Above the listings, a chart shows the product's daily lowest price, with a
verdict:

- **Buy now**: at or within 2% of its lowest price in the past year, or cheaper
  than about 85% of days.
- **Wait**: Black Friday is less than three weeks away and the price has
  historically dropped then, or it's more than 5% above its 90-day average.
- **Fair price**: around its usual level.
- **Too early**: less than three weeks of history.

It also shows the one-year low, the 90-day average, a target price to set an
alert at, how much past Black Fridays cut the price, and which months have been
cheapest (once there's about a year of data). Every verdict is computed from
that product's own price data. Seasonal tips for a product category (for
example "TVs are cheapest before the Super Bowl") are shown separately and
labelled as general patterns.

There are two history sources:

- **Amazon history via Keepa** (`KEEPA_API_KEY`). Up to two years of daily
  prices for the cheapest Amazon listing, available right away.
- **Deal Desk's own tracker** (no key). Each search records that day's lowest
  trustworthy new price across all connected stores, in
  `DATA_DIR/price-history.json`. It starts empty and fills in over time. Set
  `TRACK_REFRESH_HOURS` to re-check recently searched products on a schedule,
  and give `DATA_DIR` a persistent disk so the history survives redeploys.

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
| Keepa | Amazon price history | `KEEPA_API_KEY` (paid) |

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
- Mount a persistent disk at `DATA_DIR` (`/data` in the image) to keep the
  tracked price history. On Render, add a disk. On Fly, add a volume.

Results are cached for 10 minutes per query, and each visitor is limited to 20
searches a minute, which keeps API usage predictable.
