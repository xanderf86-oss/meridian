// Deal Desk's own price tracker: every fresh search records the day's lowest
// trustworthy new price (and the lowest per store). Over time this becomes a
// cross-store price history that needs no third-party key. Products on the
// watchlist are re-checked daily so their history has no gaps.
import { normalizeText } from "./clean.mjs";
import { fileStorage, memoryStorage } from "./storage.mjs";

const MAX_DAYS = 730;
const MAX_QUERIES = 3000;
const RELOAD_RETRY_MS = 5 * 60_000;

export function dayKey(ms, timeZone = "America/New_York") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

export function historyKey(query) {
  return normalizeText(query).split(" ").filter(Boolean).sort().join(" ");
}

function toPoints(entry) {
  return Object.entries(entry.days)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({ t: Date.parse(`${date}T00:00:00Z`), price: d.low, retailer: d.retailer, url: d.url }));
}

export function createHistoryStore({ dir = null, storage = dir ? fileStorage(dir) : memoryStorage(), now = () => Date.now(), watchLimit = 10 } = {}) {
  let data = { version: 1, queries: {}, meta: {} };
  let loading = null;
  let loadFailedAt = 0;
  let saveTimer = null;
  let saving = Promise.resolve();
  let dirty = false;

  // If the stored history can't be read (network/auth error, not "missing"),
  // never write: saving now would replace real history with an empty file.
  function load() {
    if (loading && !(loadFailedAt && now() - loadFailedAt > RELOAD_RETRY_MS)) return loading;
    loadFailedAt = 0;
    loading = storage
      .read()
      .then((text) => {
        if (!text) return;
        const parsed = JSON.parse(text);
        if (parsed?.queries) data = { meta: {}, ...parsed };
      })
      .catch((error) => {
        loadFailedAt = now();
        console.warn(`history load failed (${storage.name}):`, error.message);
      });
    return loading;
  }

  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (loadFailedAt || !dirty) return saving;
    dirty = false;
    saving = saving
      .then(() => storage.write(JSON.stringify(data)))
      .catch((error) => console.warn(`history save failed (${storage.name}):`, error.message));
    return saving;
  }

  function scheduleSave() {
    dirty = true;
    if (saveTimer || loadFailedAt) return;
    saveTimer = setTimeout(flush, storage.saveDelayMs);
    saveTimer.unref?.();
  }

  function prune() {
    const keys = Object.keys(data.queries);
    if (keys.length <= MAX_QUERIES) return;
    keys
      .filter((key) => !data.queries[key].watch)
      .sort((a, b) => (data.queries[a].lastSearched || 0) - (data.queries[b].lastSearched || 0))
      .slice(0, keys.length - MAX_QUERIES)
      .forEach((key) => delete data.queries[key]);
  }

  const watched = () => Object.values(data.queries).filter((q) => q.watch);

  return {
    storage: { name: storage.name, durable: storage.durable },
    flush,
    async record(query, result) {
      await load();
      const key = historyKey(query);
      if (!key) return;
      const at = now();
      const isNew = !data.queries[key];
      const entry = (data.queries[key] ||= { label: query, firstSeen: at, days: {} });
      entry.lastSearched = at;
      let changed = isNew;
      const low = result?.summary?.lowestNew;
      if (low?.price) {
        const day = dayKey(at);
        const prev = entry.days[day];
        const byRetailer = { ...(prev?.byRetailer || {}) };
        for (const r of result.summary.bestPerRetailer || []) {
          if (!byRetailer[r.retailer] || r.price < byRetailer[r.retailer]) {
            byRetailer[r.retailer] = r.price;
            changed = true;
          }
        }
        if (!prev || low.price < prev.low) {
          entry.days[day] = { low: low.price, retailer: low.retailer, url: low.url, byRetailer };
          changed = true;
        } else {
          entry.days[day] = { ...prev, byRetailer };
        }
        const days = Object.keys(entry.days).sort();
        days.slice(0, Math.max(0, days.length - MAX_DAYS)).forEach((d) => delete entry.days[d]);
      }
      prune();
      // Only real price changes are worth a write (and, on GitHub, a commit).
      if (changed) scheduleSave();
    },
    async series(query) {
      await load();
      const entry = data.queries[historyKey(query)];
      if (!entry) return { since: null, points: [], watch: null };
      return { since: entry.firstSeen, points: toPoints(entry), watch: entry.watch || null };
    },
    async setWatch(query, on) {
      await load();
      const entry = data.queries[historyKey(query)];
      if (!entry) return { ok: false, reason: "Search for this product first." };
      if (on && !entry.watch) {
        if (watched().length >= watchLimit) return { ok: false, reason: `The watchlist is full (${watchLimit} products). Stop tracking one first.` };
        const points = toPoints(entry);
        entry.watch = { since: now(), startPrice: points.at(-1)?.price ?? null };
      } else if (!on && entry.watch) {
        delete entry.watch;
      } else {
        return { ok: true, watch: entry.watch || null };
      }
      scheduleSave();
      return { ok: true, watch: entry.watch || null };
    },
    async watchlist() {
      await load();
      return watched()
        .sort((a, b) => a.watch.since - b.watch.since)
        .map((entry) => {
          const points = toPoints(entry);
          const latest = points.at(-1) || null;
          const start = entry.watch.startPrice ?? points[0]?.price ?? null;
          return {
            query: entry.label,
            since: entry.watch.since,
            startPrice: start,
            price: latest?.price ?? null,
            retailer: latest?.retailer ?? null,
            url: latest?.url ?? null,
            updated: latest?.t ?? null,
            low: points.length ? Math.min(...points.map((p) => p.price)) : null,
            changePercent: start && latest ? Math.round((latest.price / start - 1) * 1000) / 10 : null,
            spark: points.slice(-90).map((p) => ({ t: p.t, price: p.price })),
          };
        });
    },
    // Hands out the daily refresh at most once per `everyMs`, even across restarts.
    async claimRefresh(everyMs) {
      await load();
      if (loadFailedAt || now() - (data.meta.lastRefresh || 0) < everyMs) return null;
      const queries = watched().map((q) => q.label);
      if (!queries.length) return null;
      data.meta.lastRefresh = now();
      scheduleSave();
      return queries;
    },
    async status() {
      await load();
      return { storage: storage.name.split(" ")[0], durable: storage.durable, healthy: !loadFailedAt, watched: watched().length, watchLimit, lastRefresh: data.meta.lastRefresh || null };
    },
  };
}
