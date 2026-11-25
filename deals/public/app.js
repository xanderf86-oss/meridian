const $ = (id) => document.getElementById(id);
const SUGGESTIONS = ["AirPods Pro 2", "PlayStation 5", "LG C4 65", "Dyson V15", "Kindle Paperwhite", "Nintendo Switch 2", "Samsung 990 Pro 2TB", "Instant Pot"];
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const relTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
let data = null;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "#";
  } catch {
    return "#";
  }
}
function link(href, text, cls = "") {
  return `<a class="${cls}" href="${esc(safeUrl(href))}" target="_blank" rel="noopener noreferrer nofollow">${text}</a>`;
}
function ago(ms) {
  if (!ms) return "";
  const days = Math.round((ms - Date.now()) / 86400_000);
  if (Math.abs(days) >= 1) return relTime.format(days, "day");
  return relTime.format(Math.round((ms - Date.now()) / 3600_000), "hour");
}
function stars(rating, count) {
  if (!rating) return "";
  return `★ ${rating.toFixed(1)}${count ? ` <span class="muted">(${count.toLocaleString()})</span>` : ""}`;
}

$("suggestions").innerHTML = SUGGESTIONS.map((s) => `<button type="button">${esc(s)}</button>`).join("");
$("suggestions").addEventListener("click", (event) => {
  if (event.target.tagName !== "BUTTON") return;
  $("q").value = event.target.textContent;
  search(event.target.textContent);
});
$("search").addEventListener("submit", (event) => {
  event.preventDefault();
  search($("q").value.trim());
});
["f-new", "f-acc", "f-flag", "f-store", "f-sort"].forEach((id) => $(id).addEventListener("change", renderOffers));
window.addEventListener("popstate", () => {
  const q = new URLSearchParams(location.search).get("q");
  if (q) {
    $("q").value = q;
    search(q, false);
  }
});

async function search(query, push = true) {
  if (query.length < 2) return;
  if (push) history.pushState(null, "", `?q=${encodeURIComponent(query)}`);
  document.title = `${query} — Deal Desk`;
  const button = $("search").querySelector("button");
  button.disabled = true;
  showStatus(`<span class="spinner"></span>Checking every connected store for “${esc(query)}”…`);
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Search failed.");
    data = body;
    render();
    loadHistory(query, body.summary.amazonAsin);
  } catch (error) {
    showStatus(esc(error.message || "Search failed."), true);
  } finally {
    button.disabled = false;
  }
}

function showStatus(html, isError = false) {
  const el = $("status");
  el.hidden = false;
  el.className = `status${isError ? " error" : ""}`;
  el.innerHTML = html;
}

function render() {
  $("results").hidden = false;
  const { summary, removed } = data;
  const strippedTotal = removed.sponsored + removed.offTopic + removed.duplicate;
  const nothing = !data.offers.length && !data.community.length && !data.reviews.length;
  if (nothing) {
    showStatus(`No matching listings for “${esc(data.query)}”. Try fewer words or a model number.`);
  } else {
    $("status").hidden = true;
  }

  const stats = [];
  if (summary.lowestNew) {
    stats.push(`<div class="stat hero"><div class="k">Lowest new price</div><div class="v">${money.format(summary.lowestNew.price)}</div>
      <div class="s">${link(summary.lowestNew.url, `at ${esc(summary.lowestNew.retailer)} ↗`)}</div></div>`);
  }
  if (summary.typicalPrice) {
    const spread = summary.lowestNew ? summary.typicalPrice - summary.lowestNew.price : 0;
    stats.push(`<div class="stat"><div class="k">Typical price</div><div class="v">${money.format(summary.typicalPrice)}</div>
      <div class="s">${spread > 0 ? `Best is ${money.format(spread)} below` : "Median of new listings"}</div></div>`);
  }
  stats.push(`<div class="stat"><div class="k">Compared</div><div class="v">${data.offers.length}</div>
    <div class="s">listings across ${summary.retailers} store${summary.retailers === 1 ? "" : "s"}</div></div>`);
  if (summary.rating) {
    stats.push(`<div class="stat"><div class="k">Buyer rating</div><div class="v">★ ${summary.rating.average.toFixed(1)}</div>
      <div class="s">${summary.rating.reviews.toLocaleString()} retailer reviews</div></div>`);
  }
  stats.push(`<div class="stat"><div class="k">Filtered out</div><div class="v">${strippedTotal}</div>
    <div class="s">${removed.sponsored} sponsored/ad · ${removed.offTopic} off-topic</div></div>`);
  $("summary").innerHTML = stats.join("");

  const stores = [...new Set(data.offers.map((o) => o.retailer))].sort((a, b) => a.localeCompare(b));
  const current = $("f-store").value;
  $("f-store").innerHTML = `<option value="">All stores</option>${stores.map((s) => `<option${s === current ? " selected" : ""}>${esc(s)}</option>`).join("")}`;

  renderOffers();

  const REASONS = { offTopic: "not this product", sponsored: "sponsored/ad", incomplete: "no price or link", duplicate: "duplicate" };
  const droppedList = data.dropped || [];
  $("dropped").hidden = !droppedList.length;
  $("dropped-summary").textContent = `See the ${strippedTotal + removed.incomplete} store results that were removed, and why`;
  $("dropped-list").innerHTML = droppedList.map((d) =>
    `<li><span class="badge">${esc(REASONS[d.reason] || d.reason)}</span> ${esc(d.title || "(no title)")}
      <span class="small">${d.price ? `${money.format(d.price)} · ` : ""}${esc(d.retailer || d.source)}</span></li>`).join("");

  $("stores").innerHTML = summary.bestPerRetailer.length
    ? summary.bestPerRetailer.map((r) => `<tr><td>${link(r.url, esc(r.retailer))}</td><td class="p">${money.format(r.price)}</td></tr>`).join("")
    : `<tr><td class="empty-note">No new-condition listings from connected stores.</td></tr>`;

  $("reviews").innerHTML = data.reviews.length
    ? data.reviews.map((r) => `<li>${link(r.url, esc(r.title))}
        <div class="small">${esc(r.site)}${r.score ? ` · ${r.score.toLocaleString()} upvotes` : ""}${r.comments ? ` · ${r.comments} comments` : ""}${r.postedAt ? ` · ${ago(r.postedAt)}` : ""}</div>
        ${r.snippet ? `<p>${esc(r.snippet)}</p>` : ""}</li>`).join("")
    : `<li class="empty-note">No independent review threads found yet.</li>`;

  $("community").innerHTML = data.community.length
    ? data.community.map((c) => `<li>${link(c.url, esc(c.title))}
        <div class="small">${c.price ? `<strong>${money.format(c.price)}</strong> · ` : ""}${esc(c.retailer)}${c.postedAt ? ` · ${ago(c.postedAt)}` : ""}
        ${c.discussionUrl && c.discussionUrl !== c.url ? ` · ${link(c.discussionUrl, "discussion")}` : ""}</div>
        ${c.summary ? `<p>${esc(c.summary)}</p>` : ""}</li>`).join("")
    : `<li class="empty-note">No community deal posts for this in the last month.</li>`;

  $("sources").innerHTML = data.sources.map((s) => {
    const cls = s.state === "ok" ? "ok" : s.state === "error" ? "error" : "off";
    const text = s.state === "ok" ? (s.kept != null ? `${s.count} found, ${s.kept} kept` : `${s.count}`) : s.state === "error" ? "unavailable" : "not connected";
    const title = s.state === "not-configured" ? `Set ${s.requires.join(" + ")} to enable` : s.error || "";
    return `<span class="src ${cls}" title="${esc(title)}">${esc(s.label)} · ${esc(text)}</span>`;
  }).join("");
}

function renderOffers() {
  if (!data) return;
  const newOnly = $("f-new").checked;
  const hideAcc = $("f-acc").checked;
  const hideFlag = $("f-flag").checked;
  const store = $("f-store").value;
  const sort = $("f-sort").value;
  let list = data.offers.filter((o) =>
    (!newOnly || o.condition === "new") && (!hideAcc || !o.accessory) && (!hideFlag || !o.flags.length) && (!store || o.retailer === store));
  if (sort === "off") list = [...list].sort((a, b) => (b.percentOff || 0) - (a.percentOff || 0) || a.price - b.price);
  if (sort === "rating") list = [...list].sort((a, b) => (b.rating || 0) * Math.log10(10 + b.reviewCount) - (a.rating || 0) * Math.log10(10 + a.reviewCount));
  const cheapest = Math.min(...list.map((o) => o.price));
  // Say what the filters are hiding, so a short list is never a mystery.
  const scoped = data.offers.filter((o) => !store || o.retailer === store);
  const hidden = scoped.length - list.length;
  const parts = [
    [hideAcc && scoped.filter((o) => o.accessory).length, "accessories"],
    [newOnly && scoped.filter((o) => o.condition !== "new").length, "used or refurbished"],
    [hideFlag && scoped.filter((o) => o.flags.length).length, "risky"],
  ].filter(([n]) => n).map(([n, label]) => `${n} ${label}`);
  $("offer-count").innerHTML = `· ${list.length} shown${hidden > 0 ? ` · ${hidden} hidden by filters (${parts.join(", ")}) · <button type="button" class="linkish" id="show-all">show all</button>` : ""}`;
  $("offers").innerHTML = list.length
    ? list.slice(0, 150).map((o) => {
        const best = o.price === cheapest;
        const badges = [
          `<span class="badge${best ? " best" : ""}">${esc(o.retailer)}</span>`,
          best ? `<span class="badge best">Lowest</span>` : "",
          o.condition !== "new" ? `<span class="badge cond">${esc(o.condition)}</span>` : "",
          o.accessory ? `<span class="badge warn">accessory?</span>` : "",
          o.flags.includes("resale-site") ? `<span class="badge warn">resale site — individual seller</span>` : "",
          o.flags.includes("far-below-typical") ? `<span class="badge warn">far below typical — check seller</span>` : "",
        ].join("");
        return `<li class="offer${best ? " best" : ""}">
          ${o.image ? `<img class="thumb" src="${esc(safeUrl(o.image))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="thumb empty"></div>`}
          <div>
            ${link(o.url, esc(o.title), "title")}
            <div class="meta">${badges}${o.rating ? `<span>${stars(o.rating, o.reviewCount)}</span>` : ""}${o.note ? `<span>${esc(o.note)}</span>` : ""}</div>
          </div>
          <div class="price">
            <div class="now">${money.format(o.price)}</div>
            ${o.originalPrice ? `<div class="was">${money.format(o.originalPrice)}</div><div class="off">${o.percentOff}% off</div>` : ""}
            ${link(o.url, "View listing ↗", "btn")}
          </div>
        </li>`;
      }).join("")
    : `<li class="empty-note">${data.offers.length ? "Nothing matches these filters — try including used/refurbished or accessories." : "No store listings. Connect more sources (see the list at the bottom)."}</li>`;
}

$("offer-count").addEventListener("click", (event) => {
  if (event.target.id !== "show-all") return;
  ["f-new", "f-acc", "f-flag"].forEach((id) => { $(id).checked = false; });
  renderOffers();
});

const initial = new URLSearchParams(location.search).get("q");
if (initial) {
  $("q").value = initial;
  search(initial, false);
}
fetch("/api/sources").then((r) => r.json()).then(({ sources }) => {
  if (data) return;
  $("sources").innerHTML = sources.map((s) =>
    `<span class="src ${s.configured ? "ok" : "off"}" title="${s.configured ? "" : esc(`Set ${s.requires.join(" + ")} to enable`)}">${esc(s.label)}${s.configured ? "" : " · not connected"}</span>`).join("");
}).catch(() => {});

/* ---------- Price history & best time to buy ---------- */
const DAY = 86400_000;
const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const VERDICT_LABEL = { buy: "Buy now", wait: "Wait", fair: "Fair price", "not-enough-history": "Too early" };
let hist = null;
let histSeries = "amazon";
let histRange = 365;
let histToken = 0;

async function loadHistory(query, asin) {
  const token = ++histToken;
  const panel = $("history");
  panel.hidden = false;
  $("h-series").innerHTML = "";
  $("h-track").innerHTML = "";
  $("h-body").innerHTML = `<p class="empty-note"><span class="spinner"></span>Loading price history…</p>`;
  try {
    const params = new URLSearchParams({ q: query });
    if (asin) params.set("asin", asin);
    const response = await fetch(`/api/history?${params}`);
    const body = await response.json();
    if (token !== histToken) return;
    if (!response.ok) throw new Error(body.error || "Could not load price history.");
    hist = body;
    renderTrack();
    histSeries = body.amazon?.state === "ok" && body.amazon.points.length ? "amazon" : "tracked";
    renderHistory();
  } catch (error) {
    if (token === histToken) $("h-body").innerHTML = `<p class="empty-note">${esc(error.message)}</p>`;
  }
}

function currentSeries() {
  return histSeries === "amazon" && hist.amazon?.state === "ok" ? hist.amazon : hist.tracked;
}

function renderHistory() {
  const hasAmazon = hist.amazon?.state === "ok" && hist.amazon.points.length;
  $("h-series").innerHTML = hasAmazon
    ? [["amazon", "Amazon history"], ["tracked", "All stores (tracked)"]]
        .map(([id, label]) => `<button type="button" role="tab" data-series="${id}" aria-selected="${histSeries === id}">${label}</button>`).join("")
    : "";
  const s = currentSeries();
  const i = s.insight;
  const notes = [];
  if (histSeries === "amazon") {
    notes.push(`${esc(s.series)} for ${link(s.url, esc(s.title || s.asin))}, via Keepa.`);
  } else {
    notes.push(`The lowest trustworthy new price across connected stores, recorded each day someone searches this product${hist.tracked.since ? ` (tracking since ${dateFmt.format(hist.tracked.since)})` : ""}.`);
    if (hist.amazon?.state === "not-configured") notes.push("Add a Keepa API key to see years of Amazon price history right away.");
  }
  hist.guidance.forEach((g) => notes.push(`General pattern, not from this product's prices: ${esc(g)}`));

  const reasons = (i.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("");
  const stats = i.verdict === "not-enough-history" ? "" : `<div class="hist-stats">
      ${stat("Now", i.current)}
      ${stat("1-year low", i.low, i.lowDate ? dateFmt.format(i.lowDate) : "")}
      ${stat("90-day average", i.average90)}
      ${stat("Good price to wait for", i.targetPrice)}
      ${i.typicalBlackFridayDrop != null ? `<div><div class="k">Typical Black Friday drop</div><div class="v">${i.typicalBlackFridayDrop}%</div><div class="s">${i.blackFridayHistory.map((d) => `${d.year}: ${money.format(d.low)}`).join(" · ")}</div></div>` : ""}
    </div>`;
  $("h-body").innerHTML = `
    <div class="verdict ${esc(i.verdict)}"><span class="pill">${VERDICT_LABEL[i.verdict] || ""}</span>
      <div><div class="head">${esc(i.headline)}</div>${reasons ? `<ul>${reasons}</ul>` : ""}</div></div>
    ${stats}
    ${s.points.length > 1 ? `<div class="range" role="group" aria-label="Time range">${[[90, "3M"], [365, "1Y"], [0, "All"]].map(([d, l]) =>
      `<button type="button" data-range="${d}" aria-pressed="${histRange === d}">${l}</button>`).join("")}</div>
      <div class="chart" id="h-chart"><svg role="img" aria-label="Daily lowest price over time"></svg><div class="tip" hidden></div></div>` : ""}
    ${i.seasonality ? `<div class="season"><div class="label">Price by month vs. its usual level (lower bars = cheaper). Cheapest: ${esc(i.seasonality.cheapest.join(", ") || "no clear pattern")}</div><svg id="h-season" role="img" aria-label="Price by month"></svg></div>` : ""}
    <ul class="notes">${notes.map((n) => `<li>${n}</li>`).join("")}</ul>
    ${s.points.length ? `<details><summary>Show price data (${s.points.length} days)</summary><div class="scroll"><table><thead><tr><th>Date</th><th>Lowest price</th>${histSeries === "tracked" ? "<th>Store</th>" : ""}</tr></thead><tbody>${
      [...s.points].reverse().map((p) => `<tr><td>${dateFmt.format(p.t)}</td><td>${money.format(p.price)}</td>${histSeries === "tracked" ? `<td>${esc(p.retailer || "")}</td>` : ""}</tr>`).join("")
    }</tbody></table></div></details>` : ""}`;
  drawChart();
  drawSeason(i.seasonality);
}

function stat(label, value, sub = "") {
  if (value == null) return "";
  return `<div><div class="k">${label}</div><div class="v">${money.format(value)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ""}</div>`;
}

$("history").addEventListener("click", (event) => {
  const series = event.target.closest("[data-series]")?.dataset.series;
  const range = event.target.closest("[data-range]")?.dataset.range;
  if (series && series !== histSeries) {
    histSeries = series;
    renderHistory();
  }
  if (range != null) {
    histRange = Number(range);
    renderHistory();
  }
});

const SVGNS = "http://www.w3.org/2000/svg";
function el(name, attrs, parent, text) {
  const node = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  parent.appendChild(node);
  return node;
}

function niceTicks(min, max, count = 4) {
  const span = max - min || max || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= step0);
  const ticks = [];
  const top = Math.ceil(max / step) * step;
  for (let v = Math.max(0, Math.floor(min / step) * step); v <= top + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

function drawChart() {
  const box = document.getElementById("h-chart");
  if (!box) return;
  const svg = box.querySelector("svg");
  const tip = box.querySelector(".tip");
  const s = currentSeries();
  const last = s.points.at(-1).t;
  const pts = histRange ? s.points.filter((p) => p.t >= last - histRange * DAY) : s.points;
  if (pts.length < 2) return;
  const W = box.clientWidth || 600;
  const H = 220;
  const m = { top: 12, right: 12, bottom: 22, left: 52 };
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.replaceChildren();
  const lo = Math.min(...pts.map((p) => p.price));
  const hi = Math.max(...pts.map((p) => p.price));
  const ticks = niceTicks(lo - (hi - lo) * 0.1, hi + (hi - lo) * 0.05 || hi * 1.1);
  const y0 = ticks[0];
  const y1 = ticks.at(-1) === y0 ? y0 + 1 : ticks.at(-1);
  const t0 = pts[0].t;
  const t1 = pts.at(-1).t;
  const x = (t) => m.left + ((t - t0) / (t1 - t0 || 1)) * (W - m.left - m.right);
  const y = (v) => m.top + (1 - (v - y0) / (y1 - y0)) * (H - m.top - m.bottom);

  for (const tick of ticks) {
    el("line", { class: "grid", x1: m.left, x2: W - m.right, y1: y(tick), y2: y(tick) }, svg);
    el("text", { class: "axis", x: m.left - 6, y: y(tick) + 4, "text-anchor": "end" }, svg, `$${tick % 1 ? tick.toFixed(2) : tick.toLocaleString()}`);
  }
  const spanDays = (t1 - t0) / DAY;
  const stepMonths = spanDays > 500 ? 3 : spanDays > 200 ? 2 : 1;
  const first = new Date(t0);
  let tickLabels = 0;
  for (let d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1)); d.getTime() <= t1; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + stepMonths, 1))) {
    if (x(d.getTime()) > W - m.right - 20) break;
    const label = d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : monthFmt.format(d);
    if (W < 480 && tickLabels++ % 2) continue;
    el("text", { class: "axis", x: x(d.getTime()), y: H - 6, "text-anchor": "middle" }, svg, label);
  }

  // Low reference line with a direct label.
  el("line", { class: "ref", x1: m.left, x2: W - m.right, y1: y(lo), y2: y(lo) }, svg);
  el("text", { class: "ref-label", x: W - m.right, y: y(lo) - 5, "text-anchor": "end" }, svg, `Low ${money.format(lo)}`);

  // Step line: a price holds until it changes. Gaps over a day (out of stock / not tracked) break the line.
  let d = "";
  pts.forEach((p, idx) => {
    const prev = pts[idx - 1];
    if (!prev || p.t - prev.t > DAY * 1.5) d += `M${x(p.t).toFixed(1)},${y(p.price).toFixed(1)}`;
    else d += `H${x(p.t).toFixed(1)}V${y(p.price).toFixed(1)}`;
  });
  el("path", { class: "line", d }, svg);
  const endDot = el("circle", { class: "dot", cx: x(t1), cy: y(pts.at(-1).price), r: 4 }, svg);

  const cross = el("line", { class: "cross", y1: m.top, y2: H - m.bottom, visibility: "hidden" }, svg);
  const dot = el("circle", { class: "dot", r: 4, visibility: "hidden" }, svg);
  const hit = el("rect", { x: m.left, y: 0, width: W - m.left - m.right, height: H, fill: "transparent", tabindex: 0 }, svg);
  let focusIndex = pts.length - 1;
  function show(index) {
    focusIndex = Math.max(0, Math.min(pts.length - 1, index));
    const p = pts[focusIndex];
    const px = x(p.t);
    cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", px); dot.setAttribute("cy", y(p.price)); dot.setAttribute("visibility", "visible");
    endDot.setAttribute("visibility", "hidden");
    tip.replaceChildren();
    const strong = document.createElement("strong");
    strong.textContent = money.format(p.price);
    tip.append(strong, document.createTextNode(`${dateFmt.format(p.t)}${p.retailer ? ` · ${p.retailer}` : ""}`));
    tip.hidden = false;
    const left = Math.min(Math.max(px - tip.offsetWidth / 2, 0), box.clientWidth - tip.offsetWidth);
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, y(p.price) - tip.offsetHeight - 12)}px`;
  }
  function hide() {
    cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden");
    endDot.setAttribute("visibility", "visible"); tip.hidden = true;
  }
  function nearest(clientX) {
    const rect = svg.getBoundingClientRect();
    const t = t0 + ((clientX - rect.left) * (W / rect.width) - m.left) / (W - m.left - m.right) * (t1 - t0);
    let best = 0;
    pts.forEach((p, idx) => { if (Math.abs(p.t - t) < Math.abs(pts[best].t - t)) best = idx; });
    return best;
  }
  hit.addEventListener("pointermove", (e) => show(nearest(e.clientX)));
  hit.addEventListener("pointerdown", (e) => show(nearest(e.clientX)));
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("focus", () => show(focusIndex));
  hit.addEventListener("blur", hide);
  hit.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      show(focusIndex + (e.key === "ArrowRight" ? 1 : -1));
    }
  });
}

function drawSeason(season) {
  const svg = document.getElementById("h-season");
  if (!svg || !season) return;
  const W = svg.clientWidth || 600;
  const H = 74;
  const mid = 30;
  const maxAbs = Math.max(1, ...season.months.map((mo) => Math.abs(mo.index || 0)));
  const slot = W / 12;
  const bw = Math.min(24, slot - 6);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.replaceChildren();
  el("line", { class: "base", x1: 0, x2: W, y1: mid, y2: mid }, svg);
  season.months.forEach((mo, idx) => {
    const cx = slot * idx + slot / 2;
    if (mo.index != null) {
      const h = Math.max(2, (Math.abs(mo.index) / maxAbs) * 26);
      const cheap = season.cheapest.includes(mo.month);
      // Cheaper months hang below the baseline, pricier ones rise above it.
      const top = mo.index < 0 ? mid + 1 : mid - 1 - h;
      const bar = el("rect", { class: `bar${cheap ? " cheap" : ""}`, x: cx - bw / 2, y: top, width: bw, height: h, rx: 3 }, svg);
      el("title", {}, bar, `${mo.month}: ${mo.index > 0 ? "+" : ""}${mo.index}% vs usual`);
    }
    el("text", { x: cx, y: H - 4, "text-anchor": "middle" }, svg, mo.month);
  });
}

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (hist) { drawChart(); drawSeason(currentSeries().insight.seasonality); } }, 150);
});

/* ---------- Watchlist: track a product daily ---------- */
function renderTrack(message = "") {
  if (!hist) return;
  const w = hist.watch;
  const t = hist.tracker || {};
  const warn = !t.healthy
    ? "Saved price history can't be reached right now, so new prices aren't being recorded."
    : !t.durable
      ? "Price history is kept on this server only and is lost when it restarts. Connect GitHub storage to keep it (see README)."
      : "";
  $("h-track").innerHTML = `
    <button type="button" class="btn-ghost" id="track-btn" aria-pressed="${w ? "true" : "false"}">${w ? "✓ Tracking — stop" : "＋ Track this product daily"}</button>
    <span class="small">${w
      ? `Tracking since ${dateFmt.format(w.since)}${w.startPrice ? ` at ${money.format(w.startPrice)}` : ""}. Price is checked once a day.`
      : `Checks the price every day and builds its history. ${t.watched ?? 0} of ${t.watchLimit ?? 10} slots used.`}</span>
    ${message ? `<div class="small warn-text">${esc(message)}</div>` : ""}
    ${warn ? `<div class="small warn-text">${esc(warn)}</div>` : ""}`;
}

$("h-track").addEventListener("click", async (event) => {
  if (event.target.id !== "track-btn" || !hist) return;
  event.target.disabled = true;
  try {
    const response = await fetch("/api/watch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: hist.query, on: !hist.watch }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not update tracking.");
    hist.watch = body.watch;
    hist.tracker = body.tracker;
    renderTrack();
    loadWatchlist();
  } catch (error) {
    renderTrack(error.message);
  }
});

function sparkline(points) {
  if (points.length < 2) return "";
  const W = 96, H = 28, pad = 4;
  const lo = Math.min(...points.map((p) => p.price));
  const hi = Math.max(...points.map((p) => p.price));
  const x = (i) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const y = (v) => (hi === lo ? H / 2 : pad + (1 - (v - lo) / (hi - lo)) * (H - pad * 2));
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join("");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}"/><circle cx="${x(points.length - 1).toFixed(1)}" cy="${y(points.at(-1).price).toFixed(1)}" r="3"/></svg>`;
}

async function loadWatchlist() {
  try {
    const { items } = await (await fetch("/api/watchlist")).json();
    $("watchlist").hidden = !items.length;
    $("watch-note").textContent = items.length ? "· checked daily" : "";
    $("watch-items").innerHTML = items.map((item) => {
      const c = item.changePercent;
      const change = c == null || !item.price ? "" : c === 0
        ? `<span class="chg flat">no change</span>`
        : `<span class="chg ${c < 0 ? "down" : "up"}">${c < 0 ? "▼" : "▲"} ${Math.abs(c)}% since tracking</span>`;
      return `<li><button type="button" class="watch-card" data-q="${esc(item.query)}">
        <span class="w-title">${esc(item.query)}</span>
        <span class="w-row"><span class="w-price">${item.price ? money.format(item.price) : "—"}</span>${sparkline(item.spark)}</span>
        <span class="small">${change}${item.retailer ? ` · ${esc(item.retailer)}` : ""}${item.low && item.price > item.low ? ` · low ${money.format(item.low)}` : ""}</span>
      </button></li>`;
    }).join("");
  } catch {
    $("watchlist").hidden = true;
  }
}
$("watch-items").addEventListener("click", (event) => {
  const q = event.target.closest("[data-q]")?.dataset.q;
  if (!q) return;
  $("q").value = q;
  search(q);
  window.scrollTo({ top: 0, behavior: "smooth" });
});
loadWatchlist();
