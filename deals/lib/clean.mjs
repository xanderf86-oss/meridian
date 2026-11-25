// Text, price and URL hygiene shared by every source.

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "with", "of", "in", "on", "to", "new",
  "best", "deal", "deals", "black", "friday", "cyber", "monday", "cheap", "cheapest",
  "price", "prices", "sale", "buy",
]);

export function normalizeText(value) {
  return String(value ?? "")
    // Trademark signs would otherwise glue letters onto the model number
    // ("PS5™" → "ps5tm") and break exact-number matching.
    .replace(/[\u2122\u00ae\u00a9\u2120]/g, " ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9.+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rawTokens(text) {
  return text
    .trim()
    .split(" ")
    .map((token) => token.replace(/^[.+]+|[.+]+$/g, ""))
    .filter((token) => token && token !== "s" && !STOPWORDS.has(token));
}

// Every meaningful query word must appear in the title.
//  - Numbers are model/generation numbers and must match exactly: "5" matches
//    "PlayStation 5", "PS5" and "5th gen", but not "PlayStation 4", "65" or "5.1".
//  - A word may have its number glued on ("PlayStation5").
//  - Tokens that mix digits and letters ("1tb", "4070ti") also match when the
//    title spaces them out.
// Common short names, so "PlayStation 5" finds "PS5" titles and the reverse.
const SHORT_NAMES = [["playstation", "ps"]];

function expandShortNames(text) {
  let out = text;
  for (const [long, short] of SHORT_NAMES) {
    out = out.replace(new RegExp(` ${short} ?(\\d+) `, "g"), ` ${long} $1 `);
  }
  return out;
}

export function queryTokens(query) {
  return rawTokens(expandShortNames(` ${normalizeText(query)} `));
}

export function matchesQuery(title, tokens) {
  if (!tokens.some((token) => token.length >= 2)) return false;
  const words = expandShortNames(` ${normalizeText(title)} `);
  const compact = words.replace(/\s+/g, "");
  return tokens.every((token) => {
    if (/^\d+$/.test(token)) return new RegExp(`(^|[^0-9.])${token}(st|nd|rd|th)?(?![a-z0-9.])`).test(words);
    if (words.includes(` ${token} `)) return true;
    if (/\d/.test(token)) return compact.includes(token);
    // "playstation" also matches the glued form "PlayStation5".
    return new RegExp(` ${token.replace(/[.+]/g, "\\$&")}\\d+ `).test(words);
  });
}

const ACCESSORY_WORDS = [
  "case", "cases", "cover", "covers", "skin", "skins", "screen protector", "protector",
  "tempered glass", "charger", "charging cable", "cable", "strap", "band", "bands",
  "mount", "holder", "stand", "replacement", "compatible", "ear tips", "eartips",
  "sticker", "decal", "sleeve", "pouch", "adapter", "dock", "keychain", "lanyard",
  "film", "shell", "bumper", "remote only", "parts", "controller", "controllers",
  "headset", "faceplate", "plates", "game", "games", "gift card", "manual", "box only", "empty box",
];

const BUNDLE_WORDS = /(^| )(with|w|includes|including|included|plus|bundle|and|\+) /;

// A listing is an accessory when it is made *for* the product ("case for
// AirPods", "compatible with PS5"), or when it leads with an accessory noun the
// shopper did not type. An accessory noun after "with"/"includes"/"bundle" is
// part of a bundle ("Console with DualSense controller"), not an accessory.
export function looksLikeAccessory(title, query) {
  const t = expandShortNames(` ${normalizeText(String(title).replace(/[&/]/g, " and "))} `);
  const q = ` ${queryTokens(query).join(" ")} `;
  if (/ (compatible with|designed for|works with|fits|made for) /.test(t)) return true;
  const main = queryTokens(query).find((token) => token.length >= 3);
  if (main && !q.includes(" for ") && new RegExp(` for (\\S+ ){0,3}${main.replace(/[.+]/g, "\\$&")} `).test(t)) return true;
  const bundleAt = t.search(BUNDLE_WORDS);
  const head = bundleAt >= 0 ? t.slice(0, bundleAt + 1) : t;
  return ACCESSORY_WORDS.some((word) => head.includes(` ${word} `) && !q.includes(` ${word} `));
}

export function detectCondition(...hints) {
  const text = normalizeText(hints.filter(Boolean).join(" "));
  if (/\b(refurb|refurbished|renewed|reconditioned|remanufactured|open box|openbox)\b/.test(text)) return "refurbished";
  if (/\b(used|pre owned|preowned|second hand|secondhand|for parts)\b/.test(text)) return "used";
  return "new";
}

export function parsePrice(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? round2(value) : null;
  const text = String(value ?? "");
  if (/\bfree\b/i.test(text) && !/\$/.test(text)) return null;
  const match = text.match(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/);
  if (!match) return null;
  const number = Number(`${match[1].replace(/,/g, "")}.${match[2] || "0"}`);
  return number > 0 ? round2(number) : null;
}

export function round2(value) {
  return Math.round(value * 100) / 100;
}

const SPONSORED_RE =
  /\b(sponsored|promoted|advertisement|advertorial|paid (partnership|promotion|post)|affiliate link|ad partner)\b|(^|\s)#ad\b|[[(]ad[\])]/i;

export function isSponsoredText(...parts) {
  return parts.some((part) => part && SPONSORED_RE.test(String(part)));
}

const AD_HOSTS = [
  "googleadservices.com", "doubleclick.net", "googlesyndication.com", "amazon-adsystem.com",
  "adservice.google.com", "criteo.com", "criteo.net", "taboola.com", "outbrain.com",
  "adnxs.com", "adsrvr.org", "bing.com/aclk", "clickserve.dartsearch.net",
];

const REDIRECTORS = {
  "google.com": ["url", "q", "adurl"],
  "www.google.com": ["url", "q", "adurl"],
  "l.facebook.com": ["u"],
  "out.reddit.com": ["url"],
  "go.redirectingat.com": ["url"],
  "click.linksynergy.com": ["murl", "RD_PARM1"],
  "www.anrdoezrs.net": ["url"],
  "www.dpbolvw.net": ["url"],
  "www.jdoqocy.com": ["url"],
  "www.kqzyfj.com": ["url"],
  "www.tkqlhce.com": ["url"],
  "goto.walmart.com": ["u"],
  "goto.target.com": ["u"],
  "bestbuy.7tiv.net": ["u"],
  "howl.me": ["url"],
  "shop-links.co": ["url"],
};

const TRACKING_PARAMS = new Set([
  "gclid", "gclsrc", "dclid", "fbclid", "msclkid", "yclid", "mc_cid", "mc_eid", "igshid",
  "tag", "ascsubtag", "linkcode", "linkid", "camp", "creative", "creativeasin", "ref", "ref_",
  "pd_rd_r", "pd_rd_w", "pd_rd_wg", "pf_rd_p", "pf_rd_r", "psc", "spla", "sp_csd",
  "affid", "aff_id", "affiliate", "affiliateid", "affiliate_id", "aff", "afsrc", "subid",
  "subid1", "subid2", "subid3", "sharedid", "irclickid", "irgwc", "clickid", "click_id",
  "cjevent", "cjdata", "ranmid", "raneaid", "ransiteid", "siteid", "veh", "wmlspartner",
  "sourceid", "campid", "customid", "toolid", "mkcid", "mkrid", "mkevt", "mkgroupid", "mksrc",
  "lgeo", "afcid", "clkid", "icid", "intcmp", "partner", "partnerid", "irpid", "ircid", "adid", "ad_id", "adgroupid", "campaignid", "matchtype",
  "srsltid", "_trkparms", "_trksid", "amdata",
  "ul_noapp", "u1", "u2",
]);

export function isAdUrl(raw) {
  const text = String(raw || "").toLowerCase();
  return AD_HOSTS.some((host) => text.includes(host)) || /amazon\.[a-z.]+\/(gp\/)?slredirect/.test(text) || /\/sspa\/click/.test(text);
}

// Strip affiliate/tracking parameters and unwrap known redirect wrappers so the
// shopper lands directly on the retailer's listing.
export function cleanUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    return null;
  }
  for (let hop = 0; hop < 4; hop += 1) {
    const keys = REDIRECTORS[url.hostname.toLowerCase()];
    const isGoogleRedirect = /(^|\.)google\.[a-z.]+$/.test(url.hostname) && url.pathname === "/url";
    if (!keys || (url.hostname.endsWith("google.com") && !isGoogleRedirect)) break;
    const target = keys.map((key) => url.searchParams.get(key)).find(Boolean);
    if (!target) break;
    try {
      url = new URL(target);
    } catch {
      break;
    }
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (isAdUrl(url.href)) return null;
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith("utm_") || lower.startsWith("pf_rd_") || lower.startsWith("pd_rd_") || TRACKING_PARAMS.has(lower)) {
      url.searchParams.delete(key);
    }
  }
  if (/(^|\.)ebay\./.test(url.hostname)) url.searchParams.delete("hash");
  if (/(^|\.)amazon\./.test(url.hostname)) url.pathname = url.pathname.replace(/\/ref=[^/]*$/, "");
  url.hash = "";
  if (url.protocol === "http:") url.protocol = "https:";
  return url.href;
}

const RETAILER_NAMES = {
  "amazon.com": "Amazon", "walmart.com": "Walmart", "target.com": "Target", "bestbuy.com": "Best Buy",
  "ebay.com": "eBay", "newegg.com": "Newegg", "costco.com": "Costco", "samsclub.com": "Sam's Club",
  "bhphotovideo.com": "B&H Photo", "adorama.com": "Adorama", "microcenter.com": "Micro Center",
  "homedepot.com": "Home Depot", "lowes.com": "Lowe's", "kohls.com": "Kohl's", "macys.com": "Macy's",
  "apple.com": "Apple", "dell.com": "Dell", "lenovo.com": "Lenovo", "hp.com": "HP",
  "samsung.com": "Samsung", "gamestop.com": "GameStop", "wayfair.com": "Wayfair",
  "nordstrom.com": "Nordstrom", "woot.com": "Woot", "staples.com": "Staples", "officedepot.com": "Office Depot",
  "bjs.com": "BJ's", "rei.com": "REI", "nike.com": "Nike", "sephora.com": "Sephora", "ulta.com": "Ulta",
  "dyson.com": "Dyson", "steampowered.com": "Steam", "playstation.com": "PlayStation", "xbox.com": "Xbox",
};

// Person-to-person resale sites: listings are from individuals, often used even
// when labelled new, so they never set the headline "lowest new price".
const RESALE_SITES = /^(poshmark|mercari|offerup|depop|whatnot|craigslist|facebook marketplace|facebook|vinted|swappa|stockx|ebay - |aliexpress|temu|wish|dhgate)/i;

export function isResaleSite(retailer) {
  return RESALE_SITES.test(String(retailer || "").trim());
}

export function retailerFromUrl(raw) {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    const key = Object.keys(RETAILER_NAMES).find((domain) => host === domain || host.endsWith(`.${domain}`));
    return key ? RETAILER_NAMES[key] : host;
  } catch {
    return "Unknown";
  }
}

export function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : round2((sorted[mid - 1] + sorted[mid]) / 2);
}

export function snippet(text, length = 280) {
  const clean = decodeEntities(String(text || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  return clean.length > length ? `${clean.slice(0, length - 1).trimEnd()}…` : clean;
}

export function decodeEntities(text) {
  return String(text || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
