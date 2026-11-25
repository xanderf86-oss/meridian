// Keepa (https://keepa.com/#!api) — years of Amazon price history per ASIN.
// Paid API; optional. Keepa times are minutes since 2011-01-01 UTC, prices are cents,
// and -1 means no offer (out of stock) at that moment.

const KEEPA_EPOCH_MIN = 21564000;
const DAY = 86400_000;

export function asinFromUrl(raw) {
  try {
    const url = new URL(raw);
    if (!/(^|\.)amazon\.com$/.test(url.hostname)) return null;
    return url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1]?.toUpperCase() || null;
  } catch {
    return null;
  }
}

export function keepaTimeToMs(minutes) {
  return (minutes + KEEPA_EPOCH_MIN) * 60_000;
}

// Turns Keepa's [time, cents, time, cents, ...] step series into one point per
// UTC day: the lowest price that was in effect at any moment of that day.
export function dailyFromKeepa(csv, { now = Date.now(), maxDays = 730 } = {}) {
  if (!Array.isArray(csv) || csv.length < 2) return [];
  const events = [];
  for (let i = 0; i + 1 < csv.length; i += 2) events.push({ t: keepaTimeToMs(csv[i]), price: csv[i + 1] >= 0 ? csv[i + 1] / 100 : null });
  const start = Math.max(Math.floor(events[0].t / DAY) * DAY, Math.floor((now - maxDays * DAY) / DAY) * DAY);
  const points = [];
  let index = 0;
  let current = null;
  while (index < events.length && events[index].t < start) current = events[index++].price;
  for (let day = start; day <= now; day += DAY) {
    while (index < events.length && events[index].t <= day) current = events[index++].price;
    let low = current;
    while (index < events.length && events[index].t < day + DAY) {
      current = events[index++].price;
      if (current != null && (low == null || current < low)) low = current;
    }
    if (low != null) points.push({ t: day, price: Math.round(low * 100) / 100 });
  }
  return points;
}

export async function keepaHistory(asin, { http, env, now = Date.now() }) {
  const params = new URLSearchParams({ key: env.KEEPA_API_KEY, domain: "1", asin, days: "730" });
  const data = await http.json(`https://api.keepa.com/product?${params}`, { timeoutMs: 15000 });
  const product = data?.products?.[0];
  if (!product) return null;
  // csv[0] = sold by Amazon, csv[1] = lowest new from any seller.
  const amazon = dailyFromKeepa(product.csv?.[0], { now });
  const marketplace = dailyFromKeepa(product.csv?.[1], { now });
  const useAmazon = amazon.length >= Math.min(30, marketplace.length);
  return {
    asin,
    title: product.title || null,
    series: useAmazon ? "Sold by Amazon" : "Lowest new price on Amazon (any seller)",
    url: `https://www.amazon.com/dp/${asin}`,
    points: useAmazon ? amazon : marketplace,
  };
}
