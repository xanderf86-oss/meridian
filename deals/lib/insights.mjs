// "Best time to buy": turns a daily price series into a verdict, using only the
// data itself. General category guidance is kept separate and labelled as such.
import { median, normalizeText, round2 } from "./clean.mjs";

const DAY = 86400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function blackFriday(year) {
  const firstDow = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const firstThursday = 1 + ((4 - firstDow + 7) % 7);
  return Date.UTC(year, 10, firstThursday + 22);
}

function inWindow(points, from, to) {
  return points.filter((p) => p.t >= from && p.t < to).map((p) => p.price);
}

function avg(values) {
  return values.length ? round2(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

// How much cheaper each past Black Friday → Cyber Monday stretch was than the 30
// days before it.
function blackFridayDrops(points) {
  const years = [...new Set(points.map((p) => new Date(p.t).getUTCFullYear()))];
  const drops = [];
  for (const year of years) {
    const bf = blackFriday(year);
    const before = avg(inWindow(points, bf - 37 * DAY, bf - 7 * DAY));
    const during = inWindow(points, bf - 7 * DAY, bf + 4 * DAY);
    if (!before || during.length < 3) continue;
    const low = Math.min(...during);
    drops.push({ year, before, low, percent: Math.round((1 - low / before) * 100) });
  }
  return drops;
}

function seasonality(points, now) {
  const recent = points.filter((p) => p.t >= now - 730 * DAY);
  const spanDays = recent.length ? (recent.at(-1).t - recent[0].t) / DAY : 0;
  if (spanDays < 300) return null;
  // Compare each month to the trailing average around it so a long price slide
  // doesn't make the newest months look "cheap".
  const buckets = Array.from({ length: 12 }, () => []);
  for (const p of recent) {
    const local = avg(inWindow(recent, p.t - 45 * DAY, p.t + 45 * DAY));
    if (local) buckets[new Date(p.t).getUTCMonth()].push(p.price / local);
  }
  const months = buckets.map((values, month) => ({
    month: MONTHS[month],
    index: values.length >= 7 ? round2((avg(values) - 1) * 100) : null,
  }));
  if (months.filter((m) => m.index != null).length < 8) return null;
  const cheapest = months.filter((m) => m.index != null).sort((a, b) => a.index - b.index).slice(0, 3);
  return { months, cheapest: cheapest.filter((m) => m.index < -0.5).map((m) => m.month) };
}

export function analyzeHistory(points, { now = Date.now() } = {}) {
  const series = (points || []).filter((p) => Number.isFinite(p.price) && p.price > 0).sort((a, b) => a.t - b.t);
  const spanDays = series.length ? Math.round((series.at(-1).t - series[0].t) / DAY) + 1 : 0;
  const result = { days: series.length, spanDays, verdict: "not-enough-history", headline: null, reasons: [] };
  const bf = blackFriday(new Date(now).getUTCFullYear());
  const cyberMonday = bf + 3 * DAY;
  const daysToBf = Math.ceil((bf - now) / DAY);
  const inBfWindow = now >= bf - 7 * DAY && now < cyberMonday + DAY;
  result.event = { blackFriday: bf, cyberMonday, daysToBlackFriday: daysToBf, inWindow: inBfWindow };
  if (series.length < 14 || spanDays < 21) {
    result.headline = series.length
      ? `Only ${spanDays} day${spanDays === 1 ? "" : "s"} of price history so far — not enough to call a trend.`
      : "No price history yet.";
    if (series.length) Object.assign(result, { current: series.at(-1).price, low: Math.min(...series.map((p) => p.price)) });
    return result;
  }

  const current = series.at(-1).price;
  const year = series.filter((p) => p.t >= now - 365 * DAY);
  const yearPrices = year.map((p) => p.price);
  const lowPoint = year.reduce((best, p) => (p.price < best.price ? p : best), year[0]);
  const highYear = Math.max(...yearPrices);
  const avg90 = avg(inWindow(series, now - 90 * DAY, now + DAY));
  // Mid-rank percentile: ties count half, so a flat regular price reads ~50%, not "cheapest".
  const below = yearPrices.filter((p) => p < current).length;
  const equal = yearPrices.filter((p) => p === current).length;
  const percentile = Math.round(((below + equal / 2) / yearPrices.length) * 100);
  const drops = blackFridayDrops(series.filter((p) => p.t < bf - 7 * DAY || new Date(p.t).getUTCFullYear() < new Date(now).getUTCFullYear()));
  const typicalBfDrop = drops.length ? median(drops.map((d) => d.percent)) : null;
  const season = seasonality(series, now);
  const target = round2(Math.min(lowPoint.price * 1.03, avg90 ?? Infinity));

  Object.assign(result, {
    current,
    low: lowPoint.price,
    lowDate: lowPoint.t,
    high: highYear,
    average90: avg90,
    median365: median(yearPrices),
    percentile,
    targetPrice: target,
    blackFridayHistory: drops,
    typicalBlackFridayDrop: typicalBfDrop,
    seasonality: season,
  });

  const nearLow = current <= lowPoint.price * 1.02;
  if (nearLow) {
    result.verdict = "buy";
    result.headline = current <= lowPoint.price ? "Lowest price of the past year — buy now." : "Within 2% of its lowest price of the past year — a good time to buy.";
  } else if (daysToBf > 0 && daysToBf <= 21 && typicalBfDrop >= 5 && current > lowPoint.price * 1.05) {
    result.verdict = "wait";
    result.headline = `Wait for Black Friday (${daysToBf} day${daysToBf === 1 ? "" : "s"} away): it has dropped a median ${typicalBfDrop}% then.`;
  } else if (percentile <= 15) {
    result.verdict = "buy";
    result.headline = `Cheaper than about ${100 - percentile}% of days in the past year — a good time to buy.`;
  } else if (avg90 && current > avg90 * 1.05) {
    result.verdict = "wait";
    result.headline = `Above its 90-day average of $${avg90.toFixed(2)} — it has been cheaper recently.`;
  } else {
    result.verdict = "fair";
    result.headline = "Around its usual price — fine to buy, but not a standout deal.";
  }

  if (!nearLow) result.reasons.push(`The past-year low was $${lowPoint.price.toFixed(2)}; set an alert near $${target.toFixed(2)}.`);
  if (inBfWindow && daysToBf <= 0 && !nearLow && typicalBfDrop >= 5) {
    result.reasons.push(`It's Black Friday week, and past years bottomed out ${typicalBfDrop}% below the prior month. Cyber Monday is the last big markdown.`);
  }
  if (season?.cheapest.length) result.reasons.push(`Historically cheapest in ${season.cheapest.join(", ")}.`);
  return result;
}

const GUIDANCE = [
  { match: /\b(tv|oled|qled|television)\b/, text: "TVs are usually cheapest around Black Friday and in the weeks before the Super Bowl (late Jan–early Feb); new models arrive in spring, which pushes older models down." },
  { match: /\b(iphone|ipad|macbook|airpods|apple watch|imac|mac mini)\b/, text: "Apple products rarely drop at Apple itself; the deepest retailer discounts usually come around Black Friday and right after a new model launches, which clears out the previous one." },
  { match: /\b(laptop|notebook|chromebook|macbook)\b/, text: "Laptops tend to be cheapest during back-to-school sales (July–August) and Black Friday." },
  { match: /\b(ps5|playstation|xbox|switch|console)\b/, text: "Game consoles mostly see bundles or real discounts around Black Friday; outside that, prices tend to hold." },
  { match: /\b(ssd|nvme|hard drive|ram|ddr5|gpu|rtx|radeon|cpu|ryzen|intel core)\b/, text: "PC parts follow supply and new launches more than the calendar; older generations drop when new ones ship." },
  { match: /\b(vacuum|dyson|roomba|instant pot|air fryer|kitchenaid|blender|mixer)\b/, text: "Small appliances usually hit their lows on Black Friday and Prime Day (July)." },
  { match: /\b(kindle|echo|fire tv|ring|blink|eero)\b/, text: "Amazon devices are usually cheapest on Prime Day (July), Prime Big Deal Days (October) and Black Friday." },
  { match: /\b(mattress)\b/, text: "Mattresses tend to be discounted on holiday weekends: Presidents' Day, Memorial Day, Labor Day and Black Friday." },
];

export function generalGuidance(query) {
  const text = ` ${normalizeText(query)} `;
  return GUIDANCE.filter((g) => g.match.test(text)).map((g) => g.text).slice(0, 2);
}
