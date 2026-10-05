import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { CREDIT_UNIVERSE, assembleCredit } from "./credit.mjs";

const PORT = Number(process.env.PORT || 8787);
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const TTL_MS = 25_000;
const MAX_AGE_MS = 96 * 60 * 60 * 1000;

const INSTRUMENTS = [
  { symbol: "ES=F", name: "S&P fut", group: "futures", featured: true },
  { symbol: "NQ=F", name: "Nasdaq fut", group: "futures", featured: true },
  { symbol: "YM=F", name: "Dow fut", group: "futures", featured: true },
  { symbol: "RTY=F", name: "Russell fut", group: "futures" },
  { symbol: "SPY", name: "S&P 500", group: "equity", featured: true },
  { symbol: "QQQ", name: "Nasdaq", group: "equity", featured: true },
  { symbol: "DIA", name: "Dow", group: "equity" },
  { symbol: "IWM", name: "Russell", group: "equity" },
  { symbol: "^VIX", name: "VIX", group: "vol", kind: "vol" },
  { symbol: "^TNX", name: "US 10Y", group: "rates", kind: "yield" },
  { symbol: "TLT", name: "20Y+ bond", group: "rates" },
  { symbol: "HYG", name: "High yield", group: "credit" },
  { symbol: "DX-Y.NYB", name: "Dollar", group: "fx" },
  { symbol: "EURUSD=X", name: "EURUSD", group: "fx", kind: "fx" },
  { symbol: "CL=F", name: "WTI", group: "commodity" },
  { symbol: "GC=F", name: "Gold", group: "commodity" },
  { symbol: "SI=F", name: "Silver", group: "commodity" },
  { symbol: "BTC-USD", name: "Bitcoin", group: "crypto" },
  { symbol: "ETH-USD", name: "Ether", group: "crypto" },
  { symbol: "XLK", name: "Tech", group: "sector" },
  { symbol: "XLF", name: "Financials", group: "sector" },
  { symbol: "XLE", name: "Energy", group: "sector" },
  { symbol: "XLV", name: "Health", group: "sector" },
  { symbol: "XLY", name: "Discretionary", group: "sector" },
  { symbol: "XLP", name: "Staples", group: "sector" },
  { symbol: "XLI", name: "Industrials", group: "sector" },
  { symbol: "XLB", name: "Materials", group: "sector" },
  { symbol: "XLRE", name: "Real estate", group: "sector" },
  { symbol: "XLU", name: "Utilities", group: "sector" },
  { symbol: "XLC", name: "Comm. svcs", group: "sector" },
  { symbol: "AAPL", name: "Apple", group: "single" },
  { symbol: "MSFT", name: "Microsoft", group: "single" },
  { symbol: "NVDA", name: "Nvidia", group: "single" },
  { symbol: "AMZN", name: "Amazon", group: "single" },
  { symbol: "GOOGL", name: "Alphabet", group: "single" },
  { symbol: "META", name: "Meta", group: "single" },
  { symbol: "TSLA", name: "Tesla", group: "single" },
  { symbol: "AVGO", name: "Broadcom", group: "single" },
  { symbol: "AMD", name: "AMD", group: "single" },
  { symbol: "MU", name: "Micron", group: "single" },
  { symbol: "LLY", name: "Lilly", group: "single" },
  { symbol: "JPM", name: "JPMorgan", group: "single" },
  { symbol: "XOM", name: "Exxon", group: "single" },
  { symbol: "UNH", name: "UnitedHealth", group: "single" },
];

const FEEDS = [
  { name: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { name: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { name: "CNBC Markets", url: "https://www.cnbc.com/id/15839135/device/rss/rss.html" },
  { name: "CNBC Economy", url: "https://www.cnbc.com/id/10001147/device/rss/rss.html" },
  { name: "CNBC Finance", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664" },
  { name: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
  { name: "New York Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml" },
  { name: "NYT Economy", url: "https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml" },
  { name: "Financial Times", url: "https://www.ft.com/markets?format=rss" },
  { name: "The Guardian", url: "https://www.theguardian.com/business/rss" },
  { name: "Washington Post", url: "https://feeds.washingtonpost.com/rss/business" },
  { name: "NPR", url: "https://feeds.npr.org/1006/rss.xml" },
  { name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml" },
  { name: "ECB", url: "https://www.ecb.europa.eu/rss/press.html" },
  { name: "SEC", url: "https://www.sec.gov/news/pressreleases.rss" },
];

const YAHOO_QUERIES = [
  "stock market",
  "Federal Reserve",
  "Treasury yields",
  "oil prices",
  "Nvidia",
  "jobs report",
  "Bitcoin",
  "S&P 500",
  "earnings",
  "dollar",
  "Apple",
  "Tesla",
  "gold",
  "Micron",
  "corporate bonds",
  "high yield",
  "credit spreads",
];

const THEMES = [
  { id: "rates", label: "rates", re: /\b(federal reserve|\bfed\b|fomc|powell|treasury|yields?|bond sell-?off|bonds?|rate cut|rate hike|interest rates?|\brates\b)\b/i, symbols: ["TLT", "^TNX", "SPY"] },
  { id: "inflation", label: "inflation", re: /\b(inflation|cpi|pce|consumer prices)\b/i, symbols: ["^TNX", "TLT", "SPY"] },
  { id: "labor", label: "labor", re: /\b(jobs report|nonfarm|payrolls?|unemployment|jobless|labor market|\d[\d,]*\s+jobs|hiring slows)\b/i, symbols: ["SPY", "^TNX", "TLT"] },
  { id: "oil", label: "oil", re: /\b(crude|oil|brent|wti|opec|barrels|energy prices|energy costs|natural gas)\b/i, symbols: ["CL=F", "XLE"] },
  { id: "gold", label: "gold", re: /\b(gold|bullion|silver)\b/i, symbols: ["GC=F", "SI=F"] },
  { id: "dollar", label: "dollar", re: /\b(dollar index|u\.?s\.? dollar|greenback|dxy|eurusd|forex)\b/i, symbols: ["DX-Y.NYB", "EURUSD=X"] },
  { id: "crypto", label: "crypto", re: /\b(bitcoin|btc|ethereum|ether|crypto)\b/i, symbols: ["BTC-USD", "ETH-USD"] },
  { id: "chips", label: "semis", re: /\b(semiconductor|chipmaker|chips|ai infrastructure)\b/i, symbols: ["NVDA", "XLK", "QQQ"] },
  { id: "banks", label: "banks", re: /\b(bank stocks|lenders|regional banks|credit spreads?)\b/i, symbols: ["XLF", "HYG", "JPM"] },
  { id: "credit", label: "credit", re: /\b(high[- ]yield|investment[- ]grade|corporate bonds?|bond issuance|junk bonds?|credit spread)\b/i, symbols: ["HYG", "LQD"] },
  { id: "vol", label: "volatility", re: /\b(volatility|\bvix\b|market rout)\b/i, symbols: ["^VIX", "SPY"] },
  { id: "equities", label: "equities", re: /\b(equities|wall street|s&p|nasdaq|dow jones|stock market|share prices)\b/i, symbols: ["SPY", "QQQ"] },
  { id: "trade", label: "trade", re: /\b(tariffs?|trade war)\b/i, symbols: ["SPY", "QQQ"] },
  { id: "earnings", label: "earnings", re: /\b(earnings|guidance|profit warning|revenue beat)\b/i, symbols: [] },
];

const COMPANIES = [
  ["jpmorgan", "JPM"],
  ["jp morgan", "JPM"],
  ["bank of america", "BAC"],
  ["goldman sachs", "GS"],
  ["morgan stanley", "MS"],
  ["wells fargo", "WFC"],
  ["unitedhealth", "UNH"],
  ["eli lilly", "LLY"],
  ["lilly", "LLY"],
  ["novo nordisk", "NVO"],
  ["novo", "NVO"],
  ["lennar", "LEN"],
  ["taiwan semiconductor", "TSM"],
  ["nvidia", "NVDA"],
  ["broadcom", "AVGO"],
  ["microsoft", "MSFT"],
  ["alphabet", "GOOGL"],
  ["google", "GOOGL"],
  ["amazon", "AMZN"],
  ["apple", "AAPL"],
  ["meta", "META"],
  ["tesla", "TSLA"],
  ["netflix", "NFLX"],
  ["micron", "MU"],
  ["oracle", "ORCL"],
  ["salesforce", "CRM"],
  ["adobe", "ADBE"],
  ["intel", "INTC"],
  ["amd", "AMD"],
  ["asml", "ASML"],
  ["tsmc", "TSM"],
  ["berkshire", "BRK-B"],
  ["exxon", "XOM"],
  ["chevron", "CVX"],
  ["walmart", "WMT"],
  ["costco", "COST"],
  ["mastercard", "MA"],
  ["blackrock", "BLK"],
  ["blackstone", "BX"],
  ["disney", "DIS"],
  ["boeing", "BA"],
  ["pfizer", "PFE"],
  ["merck", "MRK"],
  ["johnson & johnson", "JNJ"],
  ["coinbase", "COIN"],
  ["microstrategy", "MSTR"],
  ["palantir", "PLTR"],
  ["super micro", "SMCI"],
  ["uber", "UBER"],
  ["robinhood", "HOOD"],
  ["qualcomm", "QCOM"],
  ["applied materials", "AMAT"],
  ["lam research", "LRCX"],
  ["marvell", "MRVL"],
  ["caterpillar", "CAT"],
  ["lockheed", "LMT"],
  ["citigroup", "C"],
  ["american express", "AXP"],
  ["home depot", "HD"],
  ["coca-cola", "KO"],
  ["mcdonald", "MCD"],
  ["starbucks", "SBUX"],
  ["general motors", "GM"],
  ["ford", "F"],
  ["shell", "SHEL"],
  ["bp", "BP"],
  ["visa", "V"],
];

const NOT_TICKERS = new Set([
  "US", "UK", "EU", "UN", "AI", "CEO", "CFO", "IPO", "ETF", "GDP", "CPI", "PCE",
  "FED", "FOMC", "SEC", "DOJ", "FDA", "IMF", "ECB", "BOJ", "BOE", "OPEC", "G7",
  "G20", "NYSE", "USD", "EUR", "GBP", "JPY", "WTI", "ATH", "YTD", "EPS", "IRS",
  "ET", "UTC", "TV", "PMI", "ISM", "NFP", "YOY", "ESG", "FTC", "WHO", "EV", "ICE",
  "LNG", "OTC", "ADR", "SPAC", "DJIA", "SPX", "API", "RSS", "FDA", "OIL", "GOLD",
  "DOW", "CNN", "BBC", "NYT", "WSJ", "FT", "AM", "PM", "EST", "EDT", "CST", "PST",
]);

const RANGE_MAP = {
  "1D": { interval: "5m", range: "1d" },
  "5D": { interval: "15m", range: "5d" },
  "1M": { interval: "1d", range: "1mo" },
  "3M": { interval: "1d", range: "3mo" },
  "1Y": { interval: "1d", range: "1y" },
};

const SOURCE_CODE = {
  "Financial Times": "FT",
  "BBC Business": "BBC",
  CNBC: "CNBC",
  "CNBC Markets": "CNBC",
  "CNBC Economy": "CNBC",
  "CNBC Finance": "CNBC",
  MarketWatch: "MW",
  "New York Times": "NYT",
  "NYT Economy": "NYT",
  "The Guardian": "GDN",
  "Washington Post": "WP",
  NPR: "NPR",
  "Federal Reserve": "FED",
  ECB: "ECB",
  SEC: "SEC",
  "Yahoo Finance": "YF",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        out[index] = { ok: true, value: await fn(items[index], index) };
      } catch (error) {
        out[index] = { ok: false, error };
      }
      await sleep(70);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const host = attempt % 2 === 0 ? "query1" : "query2";
    const target = url.replace("query1.finance.yahoo.com", `${host}.finance.yahoo.com`);
    try {
      const response = await fetch(target, {
        headers: { "user-agent": UA, accept: "*/*" },
        signal: AbortSignal.timeout(15000),
        redirect: "follow",
      });
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status}`);
        await sleep(500 * (attempt + 1) ** 2);
        continue;
      }
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const buffer = await response.arrayBuffer();
      return new TextDecoder("utf-8").decode(buffer.slice(0, 1_500_000));
    } catch (error) {
      if (error.status && error.status < 500) throw error;
      lastError = error;
      await sleep(350 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("fetch failed");
}

function decode(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&ndash;|&mdash;/g, "—")
    .replace(/&hellip;/g, "…")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tagText(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decode(match[1]) : "";
}

function safeUrl(value) {
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function parseRss(xml, source) {
  const items = [];
  const chunks = String(xml).split(/<item[\s>]/i).slice(1);
  for (const chunk of chunks) {
    const body = chunk.split(/<\/item>/i)[0];
    const title = tagText(body, "title");
    const linkMatch = body.match(/<link>([\s\S]*?)<\/link>/i);
    const hrefMatch = body.match(/<link[^>]*href=["'](https?:[^"']+)["']/i);
    const url = safeUrl(decode(linkMatch?.[1] || hrefMatch?.[1] || ""));
    const published = Date.parse(tagText(body, "pubDate") || tagText(body, "dc:date"));
    const publisher = tagText(body, "source") || source;
    const category = tagText(body, "category");
    if (!title || !url || !Number.isFinite(published)) continue;
    items.push({ title, url, published, source: publisher || source, wire: source, category });
  }
  return items;
}

function titleKey(title) {
  return title
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 140);
}

function isLowSignal(item) {
  const blob = `${item.title} ${item.category || ""}`;
  return /orders on banking applications|enforcement action|workshop|conference invitation|horoscope|celebrity|recipe|wedding|in addition to decisions setting interest rates/i.test(blob);
}

function mentionedTickers(title) {
  const found = [];
  const push = (symbol) => {
    if (!symbol) return;
    const clean = String(symbol).toUpperCase().replace("/", "-").replace(".", "-");
    if (!/^[A-Z]{1,5}(?:-[A-Z])?$/.test(clean)) return;
    if (NOT_TICKERS.has(clean)) return;
    if (!found.includes(clean)) found.push(clean);
  };
  for (const [name, symbol] of COMPANIES) {
    const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (pattern.test(title)) push(symbol);
  }
  for (const match of title.matchAll(/\(([A-Z]{1,5})\)|\$([A-Z]{1,5})\b/g)) push(match[1] || match[2]);
  return found.slice(0, 4);
}

function themesFor(title) {
  return THEMES.filter((theme) => theme.re.test(title)).flatMap((theme) => {
    if (theme.id === "rates" && /\b(gilt|gilts|mortgage|ecb)\b/i.test(title) && !/\b(treasury|treasuries|fed|fomc|t-note)\b/i.test(title)) return [];
    let symbols = theme.symbols;
    if (theme.id === "gold") {
      const silver = /\bsilver\b/i.test(title);
      const gold = /\bgold|bullion\b/i.test(title);
      if (gold && !silver) symbols = ["GC=F"];
      if (silver && !gold) symbols = ["SI=F"];
    }
    if (theme.id === "crypto") {
      const btc = /\bbitcoin|\bbtc\b/i.test(title);
      const eth = /\bethereum|\bether\b/i.test(title);
      if (btc && !eth) symbols = ["BTC-USD"];
      if (eth && !btc) symbols = ["ETH-USD"];
    }
    return [{ id: theme.id, label: theme.label, symbols }];
  });
}

function keepStory(item, tickers, themes) {
  if (isLowSignal(item)) return false;
  if (["Federal Reserve", "ECB", "SEC"].includes(item.wire)) return true;
  if (tickers.length || themes.length) return true;
  return /\b(stocks?|shares|equities|nasdaq|s&p|dow|treasury|yield|fomc|inflation|recession|earnings|ipo|bond|crude|bitcoin|wall street|futures?)\b/i.test(item.title);
}

async function loadFeeds() {
  const results = await mapPool(FEEDS, 6, async (feed) => {
    const xml = await fetchText(feed.url);
    return { feed, items: parseRss(xml, feed.name) };
  });
  const sources = [];
  const items = [];
  for (let i = 0; i < FEEDS.length; i += 1) {
    const result = results[i];
    if (!result.ok) {
      sources.push({ name: FEEDS[i].name, ok: false, count: 0, error: result.error.message });
      continue;
    }
    const fresh = result.value.items.filter((item) => Date.now() - item.published <= MAX_AGE_MS);
    sources.push({
      name: FEEDS[i].name,
      ok: fresh.length > 0,
      count: fresh.length,
      error: fresh.length ? null : "no items in the last four days",
    });
    items.push(...fresh);
  }
  return { sources, items };
}

async function loadYahooNews() {
  const results = await mapPool(YAHOO_QUERIES, 3, async (query) => {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=6&quotesCount=0&enableFuzzyQuery=false`;
    const payload = JSON.parse(await fetchText(url));
    return (payload.news || []).map((item) => ({
      title: decode(item.title),
      url: safeUrl(item.link),
      published: Number(item.providerPublishTime) * 1000,
      source: item.publisher || "Yahoo Finance",
      wire: "Yahoo Finance",
      category: "",
      related: Array.isArray(item.relatedTickers) ? item.relatedTickers : [],
    }));
  });
  const items = [];
  let failed = 0;
  for (const result of results) {
    if (!result.ok) {
      failed += 1;
      continue;
    }
    for (const item of result.value) {
      if (!item.title || !item.url || !Number.isFinite(item.published)) continue;
      if (Date.now() - item.published > MAX_AGE_MS) continue;
      items.push(item);
    }
  }
  return {
    source: {
      name: "Yahoo Finance",
      ok: failed === 0,
      count: items.length,
      error: failed ? `${failed} of ${YAHOO_QUERIES.length} searches failed` : null,
    },
    items,
  };
}

function dedupeNews(items) {
  const seen = new Set();
  const out = [];
  const sorted = [...items].sort((a, b) => b.published - a.published);
  for (const item of sorted) {
    const key = titleKey(item.title);
    if (!key || seen.has(key)) continue;
    const tickers = mentionedTickers(item.title);
    const themes = themesFor(item.title);
    if (!keepStory(item, tickers, themes)) continue;
    seen.add(key);
    out.push({
      id: key.slice(0, 48),
      title: item.title,
      url: item.url,
      source: item.source,
      wire: item.wire,
      published: item.published,
      tickers,
      themes: themes.map((theme) => theme.label),
      themeSymbols: [...new Set(themes.flatMap((theme) => theme.symbols))],
    });
  }
  return out.slice(0, 80);
}

function chartUrl(symbol, interval, range) {
  const params = new URLSearchParams({
    interval,
    range,
    includePrePost: "true",
    events: "div,splits",
  });
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;
}

function parseChart(payload) {
  const result = payload?.chart?.result?.[0];
  if (!result) {
    const description = payload?.chart?.error?.description || "empty chart";
    throw new Error(description);
  }
  const meta = result.meta || {};
  const stamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const bars = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const close = quote.close?.[i];
    if (close == null || !Number.isFinite(close)) continue;
    bars.push({
      time: stamps[i],
      open: quote.open?.[i] ?? close,
      high: quote.high?.[i] ?? close,
      low: quote.low?.[i] ?? close,
      close,
      volume: quote.volume?.[i] ?? 0,
    });
  }
  return { meta, bars };
}

function sessionMove(meta, kind) {
  const price = Number(meta.regularMarketPrice);
  let pct = Number(meta.regularMarketChangePercent);
  let prev = Number(meta.previousClose);
  if (!Number.isFinite(prev) && Number.isFinite(pct) && Number.isFinite(price)) {
    prev = price / (1 + pct / 100);
  }
  if (!Number.isFinite(pct) && Number.isFinite(prev) && prev !== 0 && Number.isFinite(price)) {
    pct = ((price - prev) / prev) * 100;
  }
  const change = Number.isFinite(prev) ? price - prev : Number(meta.fulldayChange);
  const bp = kind === "yield" && Number.isFinite(change) ? change * 100 : null;
  return {
    price: Number.isFinite(price) ? price : null,
    prev: Number.isFinite(prev) ? prev : null,
    change: Number.isFinite(change) ? change : null,
    changePct: Number.isFinite(pct) ? pct : null,
    bp: Number.isFinite(bp) ? bp : null,
  };
}

function downsample(values, count) {
  if (values.length <= count) return values;
  const out = [];
  const step = (values.length - 1) / (count - 1);
  for (let i = 0; i < count; i += 1) out.push(values[Math.round(i * step)]);
  return out;
}

const nyFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function nyParts(unixSeconds) {
  const parts = {};
  for (const part of nyFormatter.formatToParts(new Date(unixSeconds * 1000))) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return {
    ...parts,
    minutes,
    weekdayIndex,
    day: `${parts.year}-${parts.month}-${parts.day}`,
    regular: weekdayIndex >= 1 && weekdayIndex <= 5 && minutes >= 9 * 60 + 30 && minutes < 16 * 60,
  };
}

function isCashBook(spec) {
  if (!spec || spec.kind === "yield") return false;
  return !["futures", "fx", "crypto", "commodity"].includes(spec.group);
}

function sparkFrom(meta, bars, cash) {
  const regular = meta.currentTradingPeriod?.regular;
  const asOf = Number(meta.regularMarketTime);
  const fresh = Number.isFinite(asOf) && Date.now() / 1000 - asOf < 6 * 3600;
  if (regular?.start && regular?.end) {
    const session = bars.filter((bar) => bar.time >= regular.start && bar.time <= regular.end + 60);
    if (session.length >= 2) return downsample(session.map((bar) => bar.close), 36);
  }
  if (cash && !fresh) {
    const byDay = new Map();
    for (const bar of bars) {
      const part = nyParts(bar.time);
      if (!part.regular) continue;
      if (!byDay.has(part.day)) byDay.set(part.day, []);
      byDay.get(part.day).push(bar);
    }
    const last = [...byDay.values()].at(-1);
    if (last && last.length >= 2) return downsample(last.map((bar) => bar.close), 36);
  }
  return downsample(bars.slice(-80).map((bar) => bar.close), 36);
}

function quotePrint(spec, asOf) {
  const ageHours = Number.isFinite(asOf) ? (Date.now() / 1000 - asOf) / 3600 : 99;
  if (ageHours > 16) return "prior";
  if (isCashBook(spec) && ageHours > 8) return "prior";
  return "live";
}

async function loadChart(symbol, interval, range) {
  const payload = JSON.parse(await fetchText(chartUrl(symbol, interval, range)));
  return parseChart(payload);
}

const chartCache = new Map();

async function cachedChart(symbol, interval, range) {
  const key = `${symbol}|${interval}|${range}`;
  const hit = chartCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await loadChart(symbol, interval, range);
  chartCache.set(key, { at: Date.now(), value });
  return value;
}

function quoteFrom(spec, parsed) {
  const move = sessionMove(parsed.meta, spec.kind);
  return {
    symbol: spec.symbol,
    name: spec.name,
    group: spec.group,
    kind: spec.kind || "price",
    featured: Boolean(spec.featured),
    price: move.price,
    prev: move.prev,
    change: move.change,
    changePct: move.changePct,
    bp: move.bp,
    spark: sparkFrom(parsed.meta, parsed.bars, isCashBook(spec)),
    print: quotePrint(spec, Number(parsed.meta.regularMarketTime) || null),
    asOf: parsed.meta.regularMarketTime || null,
    priceHint: parsed.meta.priceHint ?? 2,
    exchange: parsed.meta.fullExchangeName || parsed.meta.exchangeName || "",
    bars: parsed.bars,
  };
}

function sessionBarsEndingAt(bars, endIndex) {
  const end = bars[endIndex];
  const collected = [end];
  for (let index = endIndex - 1; index >= 0; index -= 1) {
    if (end.time - bars[index].time > 16 * 3600) break;
    if (bars[index + 1].time - bars[index].time > 45 * 60) break;
    collected.push(bars[index]);
  }
  return collected.reverse();
}

function measureExtended(bars, published, kind) {
  let beforeIndex = -1;
  for (let index = 0; index < bars.length; index += 1) {
    if (bars[index].time <= published) beforeIndex = index;
    else break;
  }
  const afterIndex = bars.findIndex((bar) => bar.time > published);
  if (beforeIndex >= 0 && afterIndex >= 0 && bars[afterIndex].time - bars[beforeIndex].time <= 18 * 3600) {
    const start = bars[beforeIndex];
    let end = bars[afterIndex];
    for (let index = afterIndex; index < bars.length; index += 1) {
      if (index > afterIndex && bars[index].time - bars[index - 1].time > 30 * 60) break;
      end = bars[index];
      if (bars[index].time >= published + 30 * 60) break;
    }
    return buildMove(start, end, kind, "reaction", end.time - published);
  }
  if (beforeIndex >= 0 && published - bars[beforeIndex].time <= 60 * 3600) {
    const session = sessionBarsEndingAt(bars, beforeIndex);
    if (session.length >= 4) {
      return buildMove(session[0], session[session.length - 1], kind, "recap", 0);
    }
  }
  return null;
}

function measureCash(bars, published, kind) {
  const regular = bars.filter((bar) => nyParts(bar.time).regular);
  if (regular.length < 2) return null;
  let before = null;
  let after = null;
  for (const bar of regular) {
    if (bar.time <= published) before = bar;
    else if (!after) after = bar;
  }
  const publishedParts = nyParts(published);
  if (
    before
    && after
    && nyParts(before.time).day === nyParts(after.time).day
    && publishedParts.regular
    && after.time - published <= 18 * 3600
  ) {
    let end = after;
    for (const bar of regular) {
      if (bar.time <= after.time) continue;
      if (nyParts(bar.time).day !== nyParts(after.time).day) break;
      if (bar.time - end.time > 30 * 60) break;
      end = bar;
      if (bar.time >= published + 30 * 60) break;
    }
    return buildMove(before, end, kind, "reaction", end.time - published);
  }
  const sessions = new Map();
  for (const bar of regular) {
    if (bar.time > published) continue;
    const day = nyParts(bar.time).day;
    if (!sessions.has(day)) sessions.set(day, []);
    sessions.get(day).push(bar);
  }
  const session = sessions.get([...sessions.keys()].sort().at(-1));
  if (!session || session.length < 4) return null;
  return buildMove(session[0], session.at(-1), kind, "recap", 0);
}

function measureYield(bars, published) {
  const reaction = measureExtended(bars, published, "yield");
  if (reaction?.mode === "reaction") return reaction;
  let beforeIndex = -1;
  for (let index = 0; index < bars.length; index += 1) {
    if (bars[index].time <= published) beforeIndex = index;
    else break;
  }
  if (beforeIndex < 0 || published - bars[beforeIndex].time > 96 * 3600) return reaction;
  let end = bars[beforeIndex];
  const endParts = nyParts(end.time);
  if (endParts.day === nyParts(published).day && !endParts.regular && endParts.minutes < 9 * 60 + 30) {
    const prior = [...bars].reverse().find((bar) => nyParts(bar.time).day < endParts.day);
    if (prior) end = prior;
  }
  const endDay = nyParts(end.time).day;
  const prev = [...bars].reverse().find((bar) => nyParts(bar.time).day < endDay);
  const start = prev || bars.find((bar) => nyParts(bar.time).day === endDay);
  if (!start) return reaction;
  const move = buildMove(start, end, "yield", "recap", 0);
  if (!move) return reaction;
  const endLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(end.time * 1000));
  move.label = prev ? `from the prior close through ${endLabel} ET` : `across ${endLabel} ET`;
  return move;
}

function measure(bars, publishedMs, kind, cash) {
  if (!bars?.length) return null;
  const published = publishedMs / 1000;
  if (kind === "yield") return measureYield(bars, published);
  if (cash) return measureCash(bars, published, kind);
  return measureExtended(bars, published, kind);
}

function buildMove(start, end, kind, mode, elapsedSec) {
  const fromPx = start.close;
  const toPx = end.close;
  if (!Number.isFinite(fromPx) || fromPx === 0 || !Number.isFinite(toPx)) return null;
  const pct = ((toPx - fromPx) / fromPx) * 100;
  const bp = kind === "yield" ? (toPx - fromPx) * 100 : null;
  let label;
  if (mode === "reaction") {
    const minutes = Math.max(1, Math.round(elapsedSec / 60));
    label = minutes <= 8 ? "on the next bar after publication" : `over the ${minutes}m after publication`;
  } else {
    const when = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
    }).format(new Date(end.time * 1000));
    label = `across ${when}'s session, which ended before publication`;
  }
  const magnitude = kind === "yield" ? Math.abs(bp) : Math.abs(pct);
  const cutoff = mode === "recap" ? (kind === "yield" ? 1.5 : 0.35) : kind === "yield" ? 0.8 : 0.15;
  return {
    mode,
    label,
    from: start.time,
    to: end.time,
    fromPx,
    toPx,
    pct,
    bp,
    magnitude,
    material: magnitude >= cutoff,
  };
}

function scoreMove(move, named) {
  const base = move.bp != null ? Math.abs(move.bp) / 2 : Math.abs(move.pct);
  return base * (named ? 1.5 : 1);
}

function chooseAlignment(story, book) {
  const named = [];
  const themed = [];
  const push = (list, symbol, note) => {
    if (!symbol || list.some((item) => item.symbol === symbol)) return;
    const series = book.get(symbol);
    if (!series) return;
    const move = measure(series.bars, story.published, series.kind, isCashBook(series));
    if (!move) return;
    if (move.mode === "recap" && note === "equities complex") return;
    list.push({ symbol, note, ...move, score: scoreMove(move, list === named) });
  };
  for (const ticker of story.tickers) push(named, ticker, `${ticker} is named in the headline`);
  if (named.length) {
    named.sort((a, b) => b.score - a.score);
    const best = named[0];
    const also = named.slice(1).find((item) => item.material);
    return packAlignment(best, also, book);
  }
  for (const symbol of story.themeSymbols) {
    const theme = story.themes[0] || "theme";
    push(themed, symbol, `${theme} complex`);
  }
  if (!themed.length) return null;
  themed.sort((a, b) => b.score - a.score);
  const best = themed[0];
  const also = themed.find((item) => item.symbol !== best.symbol && item.material);
  return packAlignment(best, also && also.symbol !== best.symbol ? also : null, book);
}

function packAlignment(best, also, book) {
  const primary = book.get(best.symbol);
  const second = also ? book.get(also.symbol) : null;
  return {
    symbol: best.symbol,
    name: primary?.name || best.symbol,
    kind: primary?.kind || "price",
    mode: best.mode,
    label: best.label,
    note: best.note,
    from: best.from,
    to: best.to,
    fromPx: best.fromPx,
    toPx: best.toPx,
    pct: best.pct,
    bp: best.bp,
    material: best.material,
    line: formatMove(best, primary),
    also: also && second ? formatMove(also, second) : null,
  };
}

function formatPrice(value, kind, hint = 2) {
  if (!Number.isFinite(value)) return "—";
  if (kind === "yield") return `${value.toFixed(3)}%`;
  if (kind === "fx") return value.toFixed(4);
  const digits = hint >= 4 ? 4 : Math.abs(value) >= 1000 ? 2 : hint;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function signed(value, digits) {
  if (!Number.isFinite(value)) return "n/a";
  const text = value.toFixed(digits);
  return `${value > 0 ? "+" : ""}${text}`;
}

function formatMove(move, quote) {
  const kind = quote?.kind || "price";
  const name = quote?.name || move.symbol;
  if (quote?.symbol === "HYG" && Number.isFinite(move.toPx)) {
    const delta = Number.isFinite(move.fromPx) ? move.toPx - move.fromPx : null;
    return `${hygPriceLine(move.toPx, delta)} ${move.label}`;
  }
  const path = `${formatPrice(move.fromPx, kind, quote?.priceHint)} → ${formatPrice(move.toPx, kind, quote?.priceHint)}`;
  if (kind === "yield") return `${name} ${signed(move.bp, 1)} bp ${move.label} · ${path}`;
  return `${name} ${signed(move.pct, 2)}% ${move.label} · ${path}`;
}

function nySession(date = new Date()) {
  const parts = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)) {
    parts[part.type] = part.value;
  }
  const weekday = parts.weekday;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  let equity = "closed";
  if (weekdayIndex >= 1 && weekdayIndex <= 5) {
    if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) equity = "open";
    else if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) equity = "pre";
    else if (minutes >= 16 * 60 && minutes < 20 * 60) equity = "post";
  }
  let futures = "closed";
  if (weekday === "Sun") futures = minutes >= 18 * 60 ? "open" : "closed";
  else if (weekday === "Sat") futures = "closed";
  else if (weekday === "Fri" && minutes >= 17 * 60) futures = "closed";
  else if (minutes >= 17 * 60 && minutes < 18 * 60) futures = "halt";
  else futures = "open";
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
  return { equity, futures, label };
}

function lookupName(symbol) {
  const known = INSTRUMENTS.find((item) => item.symbol === symbol);
  if (known) return known.name;
  const company = COMPANIES.find(([, ticker]) => ticker === symbol);
  if (!company) return symbol;
  return company[0].replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function quoteSentence(quote) {
  if (!quote || quote.changePct == null) return null;
  if (quote.kind === "yield") return `${quote.name} ${quote.price.toFixed(3)}% (${signed(quote.bp, 1)} bp)`;
  if (quote.symbol === "HYG" && Number.isFinite(quote.price)) return hygPriceLine(quote.price, quote.change);
  return `${quote.name} ${signed(quote.changePct, 2)}%`;
}

function hygPriceLine(price, change) {
  const px = `$${Number(price).toFixed(2)}`;
  if (!Number.isFinite(change)) return `HYG ${px}`;
  const verb = change > 0.01 ? "up" : change < -0.01 ? "down" : "little changed";
  if (verb === "little changed") return `HYG little changed at ${px}`;
  return `HYG ${verb} $${Math.abs(change).toFixed(2)} at ${px}`;
}

function readTape(bySymbol, clock) {
  const sentences = [];
  const nq = bySymbol.get("NQ=F")?.changePct;
  const es = bySymbol.get("ES=F")?.changePct;
  const spy = bySymbol.get("SPY")?.changePct;
  const tlt = bySymbol.get("TLT")?.changePct;
  const bp = bySymbol.get("^TNX")?.bp;
  const cl = bySymbol.get("CL=F")?.changePct;
  const xle = bySymbol.get("XLE")?.changePct;
  const dxy = bySymbol.get("DX-Y.NYB")?.changePct;
  const eur = bySymbol.get("EURUSD=X")?.changePct;
  const vix = bySymbol.get("^VIX")?.changePct;
  const btc = bySymbol.get("BTC-USD")?.changePct;
  const hygQuote = bySymbol.get("HYG");
  const hyg = hygQuote?.changePct;

  if (clock.equity === "open") {
    sentences.push("The New York cash session is open. Changes are versus the prior regular close, and futures are the live lead if they disagree with the ETFs.");
  } else if (clock.equity === "pre") {
    sentences.push("Cash equities are in the premarket. Treat futures and the 24-hour book as the live tape, and the ETF changes as the official prior close until the open.");
  } else if (clock.equity === "post") {
    sentences.push("The cash session has closed. Post-market prints can still move single names; the index ETFs below are the official day versus the prior close.");
  } else {
    sentences.push("The New York cash market is closed. Every cash figure is versus the prior session close. Futures, dollar, and crypto are the live book only while their own sessions are open.");
  }

  if (bp != null && Math.abs(bp) >= 3) {
    const bond = clock.equity !== "open" || tlt == null
      ? ""
      : Math.abs(tlt) < 0.45
        ? ` The long-bond ETF is only ${signed(tlt, 2)}%, so this is not a full duration shock in the ETF.`
        : ` The long-bond ETF is ${signed(tlt, 2)}% and is moving with the yield.`;
    const lean = bp > 0 ? "Yields are higher." : "Yields are lower.";
    sentences.push(`${lean} The 10-year is ${signed(bp, 1)} bp, at ${bySymbol.get("^TNX").price.toFixed(3)}%.${bond}`);
  }

  if (nq != null && es != null && nq - es >= 0.35) {
    sentences.push(`Nasdaq futures lead S&P futures by ${(nq - es).toFixed(2)} percentage points. The bid is in growth, not the whole book.`);
  } else if (nq != null && es != null && es - nq >= 0.35) {
    sentences.push(`S&P futures lead Nasdaq futures by ${(es - nq).toFixed(2)} percentage points. The market is not paying up for the growth complex.`);
  }

  const equityLive = clock.equity === "open" ? spy : es;
  const equityName = clock.equity === "open" ? "equities" : "S&P futures";
  if (equityLive != null && vix != null && equityLive <= -0.15 && vix >= 3) {
    sentences.push(`VIX is ${signed(vix, 1)}% with ${equityName} offered, so the decline has a volatility bid under it.`);
  } else if (equityLive != null && vix != null && vix >= 4 && equityLive <= 0.2) {
    sentences.push(`VIX is ${signed(vix, 1)}% while ${equityName} are ${signed(equityLive, 2)}%. The vol bid is ahead of the equity book.`);
  } else if (spy != null && vix != null && clock.equity === "open" && spy >= 0.3 && vix <= -2) {
    sentences.push(`VIX is ${signed(vix, 1)}% while the S&P ETF is higher. The rally is happening with volatility offered.`);
  }

  if (cl != null && cl <= -1) {
    if (clock.equity !== "open" && es != null) {
      const follow = es > -0.3
        ? "Equity futures are not following crude lower."
        : "Equity futures are offered with crude.";
      sentences.push(`WTI is ${signed(cl, 2)}%. S&P futures are ${signed(es, 2)}%. ${follow}`);
    } else {
      const energy = xle != null ? ` Energy equities (XLE) are ${signed(xle, 2)}%.` : "";
      sentences.push(`WTI is ${signed(cl, 2)}%.${energy} If equities are not falling with crude, this looks like supply rather than a demand scare.`);
    }
  } else if (cl != null && cl >= 1) {
    sentences.push(`WTI is ${signed(cl, 2)}%. A sticky oil bid is an inflation impulse at the margin.`);
  }

  if (dxy != null && Math.abs(dxy) >= 0.25) {
    const euro = eur != null ? ` EURUSD is ${signed(eur, 2)}%.` : "";
    const equityWord = clock.equity === "open" ? "the S&P is green" : "equity futures are calm";
    sentences.push(`The dollar index is ${signed(dxy, 2)}%.${euro} A firmer dollar tightens financial conditions even when ${equityWord}.`);
  }

  if (hygQuote && Number.isFinite(hygQuote.price) && hyg != null && Math.abs(hyg) >= 0.3) {
    sentences.push(`${hygPriceLine(hygQuote.price, hygQuote.change)}.`);
  }

  if (btc != null && Math.abs(btc) >= 1 && nq != null) {
    const same = Math.sign(btc) === Math.sign(nq) || nq === 0;
    sentences.push(same
      ? `Bitcoin is ${signed(btc, 2)}% and moving with Nasdaq futures, which is the high-beta liquidity pattern.`
      : `Bitcoin is ${signed(btc, 2)}% against the Nasdaq future. That divergence is worth a second look before treating crypto as a separate macro factor.`);
  }

  return sentences.slice(0, 5);
}

function num(quote, field) {
  const value = quote?.[field];
  return Number.isFinite(value) ? value : null;
}

function noteTitle(bySymbol, clock) {
  const nq = num(bySymbol.get("NQ=F"), "changePct");
  const es = num(bySymbol.get("ES=F"), "changePct");
  const cl = num(bySymbol.get("CL=F"), "changePct");
  const dxy = num(bySymbol.get("DX-Y.NYB"), "changePct");
  const vix = num(bySymbol.get("^VIX"), "changePct");
  const cash = clock.equity === "open";
  const spy = cash ? num(bySymbol.get("SPY"), "changePct") : null;
  const tlt = cash ? num(bySymbol.get("TLT"), "changePct") : null;
  const bp = num(bySymbol.get("^TNX"), "bp");
  const equity = cash ? spy : es;
  if ([nq, es, cl, dxy, vix].every((value) => value == null)) return "The tape is missing the live book";
  if (vix != null && vix >= 4 && equity != null && equity <= 0.2) return "Volatility is bid against a soft equity book";
  if (cl != null && cl <= -1 && equity != null && equity > -0.3) {
    return cash ? "Crude is offered, and equities are not following it" : "Crude is offered, and equity futures are not following it";
  }
  if (cl != null && cl <= -1 && equity != null && equity <= -0.4) return "Crude and equities are both offered";
  if (nq != null && es != null && nq - es >= 0.45) return "Nasdaq futures are carrying the tape";
  if (nq != null && es != null && es - nq >= 0.45) return "The broad future is ahead of the Nasdaq";
  if (dxy != null && dxy >= 0.35 && equity != null && equity < 0) return "A firmer dollar against a soft equity tape";
  if (tlt != null && bp != null && tlt <= -1 && bp >= 2 && nq != null && nq >= 0.3) return "Yields up, and Nasdaq futures are still bid";
  if (tlt != null && spy != null && tlt <= -1 && spy <= -0.25) return "A bond selloff is leaking into equities";
  if (spy != null && vix != null && spy <= -0.5 && vix >= 4) return "Risk off, and volatility is confirming";
  if (spy != null && vix != null && spy >= 0.35 && vix <= -3 && (bp == null || bp < 1.5)) return "Equities higher, with volatility offered";
  if (tlt != null && spy != null && Math.abs(tlt) >= Math.abs(spy) && Math.abs(tlt) >= 0.8) return "Duration is the larger move";
  return cash ? "A mixed cross-asset book" : "A mixed futures book";
}

function themeCounts(news) {
  const counts = new Map();
  for (const story of news) {
    for (const theme of story.themes) counts.set(theme, (counts.get(theme) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function joinAnd(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function magnitude(story) {
  if (!story.alignment) return 0;
  if (story.alignment.kind === "yield") return Math.abs(story.alignment.bp || 0);
  return Math.abs(story.alignment.pct || 0);
}

function buildBrief(quotes, news, clock) {
  const bySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
  const byMove = (quote) => Math.abs(quote.changePct);
  const liveLeaders = [...quotes]
    .filter((quote) => ["futures", "commodity", "fx", "crypto"].includes(quote.group) && quote.changePct != null && quote.kind !== "yield")
    .sort((a, b) => byMove(b) - byMove(a))
    .slice(0, 3);
  const leaders = [...quotes]
    .filter((quote) => quote.changePct != null && quote.kind !== "yield" && quote.kind !== "vol")
    .sort((a, b) => byMove(b) - byMove(a))
    .slice(0, 3);
  const cashNames = [...quotes]
    .filter((quote) => quote.group === "single" && quote.changePct != null)
    .sort((a, b) => byMove(b) - byMove(a))
    .slice(0, 3);
  const biggestSingle = cashNames[0];
  const spyMove = bySymbol.get("SPY")?.changePct;
  const tape = readTape(bySymbol, clock);
  if (clock.equity === "open") {
    const leaderLine = leaders.map((quote) => quoteSentence(quote)).filter(Boolean).join("; ");
    if (leaderLine) tape.splice(1, 0, `Largest marks versus the prior close: ${leaderLine}.`);
    if (biggestSingle && spyMove != null && Math.abs(biggestSingle.changePct) >= 2 && Math.abs(biggestSingle.changePct - spyMove) >= 1.5) {
      tape.splice(2, 0, `${biggestSingle.name} is ${signed(biggestSingle.changePct, 2)}% against the S&P ETF at ${signed(spyMove, 2)}%. The index is not the story at the single-name level.`);
    }
  } else {
    const liveLine = liveLeaders.map((quote) => quoteSentence(quote)).filter(Boolean).join("; ");
    const cashLine = cashNames.map((quote) => quoteSentence(quote)).filter(Boolean).join("; ");
    if (liveLine) tape.splice(1, 0, `Largest live marks: ${liveLine}.`);
    if (cashLine) tape.splice(2, 0, `Prior cash close, not this morning's tape: ${cashLine}.`);
  }

  const reactions = news.filter((story) => story.alignment?.material && story.alignment.mode === "reaction");
  const recaps = news.filter((story) => story.alignment?.material && story.alignment.mode === "recap");
  const leadScore = (story) => {
    let score = magnitude(story);
    if (/biggest moves|stocks to watch|swears by|should you buy|investors should|rules that|retirees|dividend stocks/i.test(story.title)) score *= 0.2;
    if (["CL=F", "XLE", "SPY", "QQQ", "^TNX", "TLT", "NQ=F", "ES=F", "DX-Y.NYB", "GC=F", "^VIX"].includes(story.alignment.symbol)) score *= 1.35;
    return score;
  };
  reactions.sort((a, b) => leadScore(b) - leadScore(a));
  recaps.sort((a, b) => leadScore(b) - leadScore(a));
  const diversify = (stories, limit) => {
    const picked = [];
    const seen = new Set();
    for (const story of stories) {
      const key = story.alignment.symbol;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(story);
      if (picked.length >= limit) return picked;
    }
    for (const story of stories) {
      if (picked.includes(story)) continue;
      picked.push(story);
      if (picked.length >= limit) break;
    }
    return picked;
  };
  const themes = themeCounts(news).slice(0, 3).map(([label]) => label);
  const wire = [];
  if (themes.length) wire.push(`The wires that answered are clustered around ${joinAnd(themes)}.`);
  const leadStories = diversify(reactions.length ? reactions : recaps, 5);
  if (reactions[0]) {
    wire.push(`The largest post-publication print is “${leadStories[0].title}” (${leadStories[0].source}): ${leadStories[0].alignment.line}. ${leadStories[0].alignment.note}.`);
  } else if (recaps[0]) {
    wire.push(`Nothing fresh has a print after it. The wires are mostly recounting the last session. The largest of those recap matches is “${leadStories[0].title}” (${leadStories[0].source}): ${leadStories[0].alignment.line}.`);
  } else {
    wire.push("No headline currently sits on a material print. Either the story is ahead of the tape, or it is explaining a move too small to mark.");
  }
  if (leadStories[1]) wire.push(`The next distinct clock match is “${leadStories[1].title}”.`);

  const toCard = (story) => ({
    title: story.title,
    url: story.url,
    source: story.source,
    line: story.alignment.line,
    symbol: story.alignment.symbol,
    time: story.alignment.to,
    published: story.published,
    mode: story.alignment.mode,
  });

  const quiet = news
    .filter((story) => story.alignment && !story.alignment.material && Math.abs(story.alignment.pct || 0) >= 0.08)
    .slice(0, 4)
    .map(toCard);

  const stats = ["SPY", "NQ=F", "TLT", "^TNX", "^VIX", "CL=F", "DX-Y.NYB", "BTC-USD"]
    .map((symbol) => bySymbol.get(symbol))
    .filter(Boolean)
    .map((quote) => ({
      label: quote.name,
      value: quote.kind === "yield"
        ? `${quote.price.toFixed(3)}%`
        : formatPrice(quote.price, quote.kind, quote.priceHint),
      sub: quote.kind === "yield" ? `${signed(quote.bp, 1)} bp` : `${signed(quote.changePct, 2)}%`,
      direction: quote.kind === "yield" ? Math.sign(quote.bp || 0) : Math.sign(quote.changePct || 0),
    }));

  return {
    kicker: clock.equity === "open" ? "Session note" : "Book note",
    title: noteTitle(bySymbol, clock),
    paragraphs: [...tape, ...wire],
    stats,
    aligned: leadStories.map(toCard),
    alignedLabel: reactions.length ? "Prints after the headline" : "Last session, recounted by the wire",
    quiet,
    caveat: "A headline clock is not the event clock. Reporters file after a move, and markets move before a story exists. Meridian measures the 5-minute print around publication, or the prior session when the story lands after the close. Named companies are matched before macro themes. Under about 0.15% in a half hour, 0.35% across a finished session, or 0.8 basis points on the 10-year, the tape is treated as quiet. Alignment is not causation.",
  };
}

function stripBars(quote) {
  const { bars, ...rest } = quote;
  return rest;
}

let cache = null;
let refreshing = null;

async function buildSnapshot() {
  const started = Date.now();
  const [feedResult, yahooResult, charts] = await Promise.all([
    loadFeeds(),
    loadYahooNews(),
    mapPool(INSTRUMENTS, 4, async (spec) => {
      const parsed = await cachedChart(spec.symbol, "5m", "5d");
      return quoteFrom(spec, parsed);
    }),
  ]);

  const book = new Map();
  const quotes = [];
  for (let i = 0; i < INSTRUMENTS.length; i += 1) {
    const result = charts[i];
    if (!result.ok) {
      console.warn("quote failed", INSTRUMENTS[i].symbol, result.error.message);
      continue;
    }
    book.set(result.value.symbol, result.value);
    quotes.push(result.value);
  }

  const news = dedupeNews([...yahooResult.items, ...feedResult.items]);
  const missing = new Map();
  for (const story of news) {
    for (const ticker of story.tickers) {
      if (book.has(ticker)) continue;
      missing.set(ticker, (missing.get(ticker) || 0) + 1);
    }
  }
  const extras = [...missing.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([symbol]) => symbol);
  const extraCharts = await mapPool(extras, 3, async (symbol) => {
    const parsed = await cachedChart(symbol, "5m", "5d");
    return quoteFrom({ symbol, name: lookupName(symbol), group: "mentioned", kind: "price" }, parsed);
  });
  for (const result of extraCharts) {
    if (!result.ok) continue;
    book.set(result.value.symbol, result.value);
  }

  for (const story of news) story.alignment = chooseAlignment(story, book);

  const clock = nySession();
  const brief = buildBrief(quotes, news, clock);
  const sources = [yahooResult.source, ...feedResult.sources];
  const snapshot = {
    asOf: Date.now(),
    buildMs: Date.now() - started,
    clock,
    quotes: quotes.map(stripBars),
    news: news.map((story) => ({
      id: story.id,
      title: story.title,
      url: story.url,
      source: story.source,
      wire: story.wire,
      published: story.published,
      tickers: story.tickers,
      themes: story.themes,
      alignment: story.alignment,
    })),
    brief,
    sources,
  };
  console.log(`snapshot quotes=${quotes.length} news=${news.length} sources=${sources.filter((s) => s.ok).length}/${sources.length} in ${snapshot.buildMs}ms`);
  return snapshot;
}

function withAge(data, at) {
  if (!data || Date.now() - at <= 90_000) return data;
  return { ...data, stale: true };
}

function getSnapshot(fresh = false) {
  const freshEnough = cache && Date.now() - cache.at < TTL_MS;
  if (!fresh && freshEnough) return Promise.resolve(withAge(cache.data, cache.at));
  if (!refreshing) {
    refreshing = buildSnapshot()
      .then((data) => {
        cache = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  if (!fresh && cache) return Promise.resolve(withAge(cache.data, cache.at));
  return refreshing;
}

function publicAlignment(story, symbol) {
  if (!story.alignment) return null;
  if (story.alignment.symbol !== symbol && !story.tickers.includes(symbol)) return null;
  return {
    time: story.alignment.to,
    title: story.title,
    url: story.url,
    source: story.source,
    code: SOURCE_CODE[story.wire] || SOURCE_CODE[story.source] || story.source.slice(0, 4).toUpperCase(),
    line: story.alignment.line,
    mode: story.alignment.mode,
    pct: story.alignment.pct,
    material: story.alignment.material,
  };
}

async function chartPayload(symbol, rangeKey) {
  const spec = RANGE_MAP[rangeKey] || RANGE_MAP["1D"];
  const known = INSTRUMENTS.find((item) => item.symbol === symbol);
  const parsed = await cachedChart(symbol, spec.interval, spec.range);
  const quote = quoteFrom(known || { symbol, name: symbol, group: "search", kind: symbol.startsWith("^T") ? "yield" : "price" }, parsed);
  const snapshot = cache?.data;
  const markers = [];
  if (snapshot) {
    for (const story of snapshot.news) {
      const mark = publicAlignment(story, symbol);
      if (!mark?.material) continue;
      const bar = quote.bars.reduce((best, item) => {
        if (!best) return item;
        return Math.abs(item.time - mark.time) < Math.abs(best.time - mark.time) ? item : best;
      }, null);
      if (!bar) continue;
      const limit = rangeKey === "1D" ? 6 * 3600 : rangeKey === "5D" ? 3 * 86400 : 8 * 86400;
      if (Math.abs(bar.time - mark.time) > limit) continue;
      markers.push({ ...mark, time: bar.time });
    }
  }
  const unique = [];
  const seen = new Set();
  for (const marker of markers.sort((a, b) => b.time - a.time)) {
    const key = `${marker.time}|${marker.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(marker);
  }
  const capped = unique.slice(0, 12).sort((a, b) => a.time - b.time);
  return {
    symbol: quote.symbol,
    name: quote.name,
    kind: quote.kind,
    group: quote.group,
    price: quote.price,
    prev: quote.prev,
    change: quote.change,
    changePct: quote.changePct,
    bp: quote.bp,
    priceHint: quote.priceHint,
    exchange: quote.exchange,
    asOf: quote.asOf,
    interval: spec.interval,
    range: rangeKey,
    bars: quote.bars,
    markers: capped,
  };
}

async function searchSymbols(query) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0&enableFuzzyQuery=false`;
  const payload = JSON.parse(await fetchText(url));
  return (payload.quotes || [])
    .filter((quote) => quote.symbol && quote.quoteType !== "OPTION")
    .slice(0, 8)
    .map((quote) => ({
      symbol: quote.symbol,
      name: quote.shortname || quote.longname || quote.symbol,
      type: quote.typeDisp || quote.quoteType || "",
      exchange: quote.exchDisp || "",
    }));
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function send(response, status, body, type = "application/json; charset=utf-8") {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  response.writeHead(status, {
    "content-type": type,
    "content-length": payload.length,
    "cache-control": type.startsWith("application/json") ? "no-store" : "public, max-age=300",
  });
  response.end(payload);
}

function cleanSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9^=.-]{1,16}$/.test(symbol)) return null;
  return symbol;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname === "/api/health") {
      send(response, 200, { ok: true });
      return;
    }
    if (url.pathname === "/api/snapshot") {
      const data = await getSnapshot(url.searchParams.get("fresh") === "1");
      send(response, 200, data);
      return;
    }
    if (url.pathname === "/api/chart") {
      const symbol = cleanSymbol(url.searchParams.get("symbol"));
      const range = RANGE_MAP[url.searchParams.get("range") || "1D"] ? url.searchParams.get("range") || "1D" : "1D";
      if (!symbol) {
        send(response, 400, { error: "Unknown symbol." });
        return;
      }
      send(response, 200, await chartPayload(symbol, range));
      return;
    }
    if (url.pathname === "/api/credit") {
      send(response, 200, await getCredit(url.searchParams.get("fresh") === "1"));
      return;
    }
    if (url.pathname === "/api/search") {
      const query = String(url.searchParams.get("q") || "").trim().slice(0, 40);
      if (query.length < 1) {
        send(response, 200, { quotes: [] });
        return;
      }
      send(response, 200, { quotes: await searchSymbols(query) });
      return;
    }
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = normalize(join(ROOT, pathname));
    if (!filePath.startsWith(ROOT)) {
      send(response, 403, { error: "Forbidden." });
      return;
    }
    const file = await readFile(filePath);
    send(response, 200, file, TYPES[extname(filePath)] || "application/octet-stream");
  } catch (error) {
    if (error?.code === "ENOENT") {
      if (!response.headersSent) send(response, 404, { error: "Not found." });
      return;
    }
    console.error(error);
    if (!response.headersSent) send(response, 500, { error: "The desk could not complete that request." });
  }
});

let creditCache = null;
let creditFlight = null;

async function buildCredit() {
  const symbols = [...new Set(CREDIT_UNIVERSE.flatMap((item) => [item.symbol, item.hedge].filter(Boolean)))];
  const results = await mapPool(symbols, 4, (symbol) => cachedChart(symbol, "1d", "1y"));
  const loaded = new Map();
  results.forEach((result, index) => {
    if (!result.ok) {
      console.warn("credit failed", symbols[index], result.error?.message || result.error);
      return;
    }
    loaded.set(symbols[index], result.value);
  });
  const data = assembleCredit(loaded);
  data.asOf = Date.now();
  console.log(`credit sleeves=${data.sleeves.length} curve=${data.curve.length}`);
  return data;
}

function getCredit(fresh = false) {
  const freshEnough = creditCache && Date.now() - creditCache.at < 60_000;
  if (!fresh && freshEnough) return Promise.resolve(creditCache.data);
  if (!creditFlight) {
    creditFlight = buildCredit()
      .then((data) => {
        creditCache = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        creditFlight = null;
      });
  }
  if (!fresh && creditCache) return Promise.resolve(creditCache.data);
  return creditFlight;
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Meridian listening on ${PORT}`);
  getSnapshot(true)
    .then(() => getCredit(true))
    .catch((error) => console.error("warmup failed", error));
});
