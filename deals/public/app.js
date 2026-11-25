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
    const text = s.state === "ok" ? `${s.count}` : s.state === "error" ? "unavailable" : "not connected";
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
  $("offer-count").textContent = `· ${list.length} shown`;
  $("offers").innerHTML = list.length
    ? list.slice(0, 150).map((o) => {
        const best = o.price === cheapest;
        const badges = [
          `<span class="badge${best ? " best" : ""}">${esc(o.retailer)}</span>`,
          best ? `<span class="badge best">Lowest</span>` : "",
          o.condition !== "new" ? `<span class="badge cond">${esc(o.condition)}</span>` : "",
          o.accessory ? `<span class="badge warn">accessory?</span>` : "",
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
