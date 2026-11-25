// Deal Desk's own price tracker: every fresh search records the day's lowest
// trustworthy new price (and the lowest per store). Over time this becomes a
// cross-store price history that needs no third-party key.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeText } from "./clean.mjs";

const MAX_DAYS = 730;
const MAX_QUERIES = 3000;

export function dayKey(ms, timeZone = "America/New_York") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

export function historyKey(query) {
  return normalizeText(query).split(" ").filter(Boolean).sort().join(" ");
}

export function createHistoryStore({ dir = null, now = () => Date.now() } = {}) {
  const file = dir ? join(dir, "price-history.json") : null;
  let data = { version: 1, queries: {} };
  let loading = null;
  let saveTimer = null;

  function load() {
    if (!loading) {
      loading = file
        ? readFile(file, "utf8")
            .then((text) => {
              const parsed = JSON.parse(text);
              if (parsed?.queries) data = parsed;
            })
            .catch((error) => {
              if (error.code !== "ENOENT") console.warn("history load failed:", error.message);
            })
        : Promise.resolve();
    }
    return loading;
  }

  function scheduleSave() {
    if (!file || saveTimer) return;
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      try {
        await mkdir(dir, { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify(data));
        await rename(`${file}.tmp`, file);
      } catch (error) {
        console.warn("history save failed:", error.message);
      }
    }, 1500);
  }

  function prune() {
    const keys = Object.keys(data.queries);
    if (keys.length <= MAX_QUERIES) return;
    keys
      .sort((a, b) => (data.queries[a].lastSearched || 0) - (data.queries[b].lastSearched || 0))
      .slice(0, keys.length - MAX_QUERIES)
      .forEach((key) => delete data.queries[key]);
  }

  return {
    async record(query, result) {
      await load();
      const key = historyKey(query);
      if (!key) return;
      const at = now();
      const entry = (data.queries[key] ||= { label: query, firstSeen: at, days: {} });
      entry.label = query;
      entry.lastSearched = at;
      const low = result?.summary?.lowestNew;
      if (low?.price) {
        const day = dayKey(at);
        const prev = entry.days[day];
        const byRetailer = { ...(prev?.byRetailer || {}) };
        for (const r of result.summary.bestPerRetailer || []) {
          if (!byRetailer[r.retailer] || r.price < byRetailer[r.retailer]) byRetailer[r.retailer] = r.price;
        }
        entry.days[day] =
          !prev || low.price < prev.low
            ? { low: low.price, retailer: low.retailer, url: low.url, byRetailer }
            : { ...prev, byRetailer };
        const days = Object.keys(entry.days).sort();
        days.slice(0, Math.max(0, days.length - MAX_DAYS)).forEach((d) => delete entry.days[d]);
      }
      prune();
      scheduleSave();
    },
    async series(query) {
      await load();
      const entry = data.queries[historyKey(query)];
      if (!entry) return { since: null, points: [] };
      const points = Object.entries(entry.days)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, d]) => ({ t: Date.parse(`${date}T00:00:00Z`), price: d.low, retailer: d.retailer, url: d.url }));
      return { since: entry.firstSeen, points };
    },
    async recentQueries(withinMs) {
      await load();
      const cutoff = now() - withinMs;
      return Object.values(data.queries)
        .filter((q) => (q.lastSearched || 0) >= cutoff)
        .sort((a, b) => b.lastSearched - a.lastSearched)
        .map((q) => q.label);
    },
  };
}
