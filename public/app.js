const main = document.querySelector("#main");
const clockEl = document.querySelector("#clock");
const pillsEl = document.querySelector("#pills");

const VIEWS = ["tape", "chart", "wire", "brief", "bonds"];
const initialView = location.hash.slice(1);

const state = {
  view: VIEWS.includes(initialView) ? initialView : "tape",
  data: null,
  error: "",
  symbol: "SPY",
  range: "1D",
  focusTime: null,
  wireFilter: "all",
  search: "",
  hits: [],
  chart: null,
  candle: null,
  volume: null,
  loadingChart: false,
  credit: null,
  creditError: "",
  creditSeries: "LQD",
  creditRange: "3M",
  creditChart: null,
  creditLine: null,
};

window.addEventListener("hashchange", () => {
  const view = location.hash.slice(1);
  if (VIEWS.includes(view) && view !== state.view) setView(view);
});

document.querySelector(".nav").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (!button) return;
  setView(button.dataset.view);
});

function setView(view) {
  state.view = view;
  if (location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
  for (const button of document.querySelectorAll(".nav button")) {
    const on = button.dataset.view === view;
    button.classList.toggle("on", on);
    if (on) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  if (view !== "chart") destroyChart();
  if (view !== "bonds") destroyCreditChart();
  paint(false);
  if (view === "chart") loadChart();
  if (view === "bonds") loadCredit();
}

async function loadSnapshot(fresh = false) {
  const response = await fetch(fresh ? "/api/snapshot?fresh=1" : "/api/snapshot");
  if (!response.ok) throw new Error("The tape did not answer.");
  state.data = await response.json();
  state.error = "";
  paint(true);
  if (state.view === "chart") loadChart();
}

function paint(preserveScroll) {
  for (const button of document.querySelectorAll(".nav button")) {
    const on = button.dataset.view === state.view;
    button.classList.toggle("on", on);
    if (on) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  renderChrome();
  if (state.view === "chart" && state.chart) {
    renderChartChrome();
    return;
  }
  if (state.view === "bonds" && document.querySelector("#credit-root")) {
    const wire = document.querySelector("#credit-wire");
    if (wire) {
      wire.innerHTML = creditWireHtml();
      bindMain();
    }
    return;
  }
  const y = preserveScroll ? window.scrollY : 0;
  if (!state.data && state.view !== "bonds") {
    main.innerHTML = state.error
      ? `<div class="banner bad">${escapeHtml(state.error)}</div>`
      : "";
    return;
  }
  if (state.view === "tape") main.innerHTML = tapeHtml();
  else if (state.view === "wire") main.innerHTML = wireHtml();
  else if (state.view === "brief") main.innerHTML = briefHtml();
  else if (state.view === "bonds") main.innerHTML = bondsHtml();
  else main.innerHTML = chartShellHtml();
  bindMain();
  if (state.view === "bonds" && state.credit) drawCredit();
  if (preserveScroll) window.scrollTo(0, y);
}

function renderChrome() {
  clockEl.textContent = nyLabel(new Date());
  const session = nySession(new Date());
  const age = state.data ? `Updated ${ago(state.data.asOf)}` : "Waiting";
  pillsEl.innerHTML = `
    <span class="pill ${pillClass(session.equity)}">Cash ${labelSession(session.equity)}</span>
    <span class="pill ${pillClass(session.futures)}">Futures ${labelSession(session.futures)}</span>
    <span class="ago">${age}</span>
  `;
}

function tapeHtml() {
  const quotes = state.data.quotes;
  const featured = quotes.filter((quote) => quote.featured);
  const rail = quotes.filter((quote) => ["vol", "rates", "credit", "fx", "commodity", "crypto"].includes(quote.group));
  const sectors = quotes.filter((quote) => quote.group === "sector");
  const names = quotes.filter((quote) => quote.group === "single");
  return `
    ${bannerHtml()}
    <div class="section-label"><span>Futures and cash beta</span><small>vs prior close</small></div>
    <div class="featured">${featured.map(quoteCard).join("")}</div>
    <div class="section-label"><span>Rates, dollar, commodity, crypto</span><small>swipe</small></div>
    <div class="rail">${rail.map(quoteCard).join("")}</div>
    <div class="section-label"><span>Sectors</span><small>SPDR book</small></div>
    <div class="heat">${sectors.map(sectorCard).join("")}</div>
    <div class="section-label"><span>Single names</span><small>tap for the chart</small></div>
    <div class="names">${names.map(quoteCard).join("")}</div>
    <div class="section-label"><span>Wires</span><button class="refresh" type="button" data-refresh>Refresh</button></div>
    <div class="sources">${state.data.sources.map(sourceChip).join("")}</div>
    <p class="fineprint">Prices and bars are Yahoo Finance. Headlines link out to the article. A green or red strip under a story is the measured print around that headline’s clock, not a claim that the story caused the move.</p>
  `;
}

function quoteCard(quote) {
  const direction = directionOf(quote);
  const change = quote.kind === "yield" ? `${signed(quote.bp, 1)} bp` : `${signed(quote.changePct, 2)}%`;
  return `
    <button class="quote" type="button" data-symbol="${escapeHtml(quote.symbol)}">
      <div class="q-top"><span class="q-name">${escapeHtml(quote.name)}</span><span class="chg ${direction}">${change}</span></div>
      <div class="q-px">${formatPrice(quote.price, quote.kind, quote.priceHint)}</div>
      <div class="q-sub">${quote.asOf ? escapeHtml(formatEt(quote.asOf)) : ""}</div>
      ${sparkSvg(quote.spark, direction)}
    </button>
  `;
}

function sectorCard(quote) {
  const direction = directionOf(quote);
  const intensity = Math.max(0.12, Math.min(0.62, Math.abs(quote.changePct || 0) / 1.6));
  const background = direction === "up"
    ? `rgba(183, 211, 106, ${intensity})`
    : direction === "down"
      ? `rgba(240, 113, 103, ${intensity})`
      : "rgba(42, 51, 44, 0.4)";
  return `
    <button class="sector" type="button" data-symbol="${escapeHtml(quote.symbol)}" style="background:${background}">
      <b>${escapeHtml(quote.name)}</b>
      <em>${escapeHtml(quote.symbol)}</em>
      <strong class="${direction}">${signed(quote.changePct, 2)}%</strong>
    </button>
  `;
}

function sparkSvg(values, direction) {
  if (!values || values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 26 - ((value - min) / span) * 22;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const color = direction === "down" ? "#f07167" : direction === "up" ? "#c5e07a" : "#93a094";
  return `<svg class="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="1.6" points="${points}"/></svg>`;
}

function sourceChip(source) {
  const mark = source.ok ? `${source.count}` : "down";
  return `<span class="source ${source.ok ? "" : "bad"}">${escapeHtml(source.name)} ${mark}</span>`;
}

function wireHtml() {
  const stories = filteredStories();
  return `
    ${bannerHtml()}
    <div class="filters">
      ${filterButton("all", "All")}
      ${filterButton("print", "With a print")}
      ${filterButton("named", "Named")}
      ${filterButton("macro", "Macro")}
      ${filterButton("quiet", "Quiet")}
    </div>
    ${stories.length ? stories.map(storyCard).join("") : `<div class="empty">Nothing in this cut of the wire.</div>`}
  `;
}

function filterButton(id, label) {
  return `<button class="chip ${state.wireFilter === id ? "on" : ""}" type="button" data-filter="${id}">${label}</button>`;
}

function filteredStories() {
  const news = state.data?.news || [];
  return news.filter((story) => {
    if (state.wireFilter === "print") return story.alignment?.material;
    if (state.wireFilter === "named") return story.tickers.length > 0;
    if (state.wireFilter === "macro") return story.themes.some((theme) => ["rates", "inflation", "labor", "oil", "dollar", "equities", "volatility"].includes(theme));
    if (state.wireFilter === "quiet") return story.alignment && !story.alignment.material;
    return true;
  });
}

function storyCard(story) {
  const chips = [
    ...story.tickers.map((ticker) => `<span class="tick">${escapeHtml(ticker)}</span>`),
    ...story.themes.map((theme) => `<span class="tick theme">${escapeHtml(theme)}</span>`),
  ].join("");
  const alignment = story.alignment
    ? `<button class="align ${directionFromPct(story.alignment.kind === "yield" ? story.alignment.bp : story.alignment.pct)}" type="button" data-symbol="${escapeHtml(story.alignment.symbol)}" data-time="${story.alignment.to}">
        <span class="k">${story.alignment.mode === "recap" ? "Session before the story" : "After publication"} · ${escapeHtml(story.alignment.note)}</span>
        <span class="line">${escapeHtml(story.alignment.line)}</span>
        ${story.alignment.also ? `<span class="also">${escapeHtml(story.alignment.also)}</span>` : ""}
      </button>`
    : "";
  return `
    <article class="story">
      <div class="meta"><span class="src">${escapeHtml(story.source)}</span><span>·</span><time>${escapeHtml(relTime(story.published))}</time></div>
      <a class="headline" href="${escapeHtml(story.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(story.title)}</a>
      ${chips ? `<div class="chips">${chips}</div>` : ""}
      ${alignment}
    </article>
  `;
}

function briefHtml() {
  const brief = state.data.brief;
  return `
    <article class="note">
      <p class="kicker">${escapeHtml(brief.kicker)} · ${escapeHtml(state.data.clock.label)}</p>
      <h1>${escapeHtml(brief.title)}</h1>
      <div class="stats">${brief.stats.map(statCard).join("")}</div>
      <div class="prose">${brief.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</div>
      <div class="section-label"><span>${escapeHtml(brief.alignedLabel)}</span></div>
      ${brief.aligned.map(linkedCard).join("") || `<div class="empty">No material clock match on this pass.</div>`}
      <div class="section-label"><span>On the wire, little tape</span></div>
      ${brief.quiet.map(linkedCard).join("") || `<p class="muted">No quiet-but-relevant headlines in this pass.</p>`}
      <p class="caveat">${escapeHtml(brief.caveat)}</p>
    </article>
  `;
}

function statCard(stat) {
  const direction = stat.direction > 0 ? "up" : stat.direction < 0 ? "down" : "flat";
  return `<div class="stat"><span>${escapeHtml(stat.label)}</span><b class="${direction}">${escapeHtml(stat.value)}</b><em class="chg ${direction}">${escapeHtml(stat.sub)}</em></div>`;
}

function linkedCard(item) {
  return `
    <a class="linked" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
      <strong>${escapeHtml(item.title)}</strong>
      <em>${escapeHtml(item.source)} · ${escapeHtml(item.line)}</em>
    </a>
  `;
}

function chartShellHtml() {
  const quote = findQuote(state.symbol);
  return `
    ${bannerHtml()}
    <div class="search">
      <input id="symbol-search" type="search" enterkeyhint="search" placeholder="Search Yahoo Finance, for example Brent or JPM" value="${escapeHtml(state.search)}" aria-label="Search symbols">
    </div>
    <div class="results" id="hits">${state.hits.map(hitButton).join("")}</div>
    <div class="toolbar" id="symbol-pills">${pillSymbols().map((symbol) => `<button class="seg ${symbol === state.symbol ? "on" : ""}" type="button" data-symbol="${escapeHtml(symbol)}">${escapeHtml(shortName(symbol))}</button>`).join("")}</div>
    <div class="chart-card">
      <div class="chart-head" id="chart-head">${chartHeadHtml(quote)}</div>
      <div class="legend" id="legend"><span>${escapeHtml(state.range)} · times follow your phone</span><span id="ohlc"></span></div>
      <div id="chart-root"></div>
      <div class="toolbar">
        ${["1D", "5D", "1M", "3M", "1Y"].map((range) => `<button class="seg ${state.range === range ? "on" : ""}" type="button" data-range="${range}">${range}</button>`).join("")}
      </div>
    </div>
    <div class="section-label"><span>Headlines on this symbol</span></div>
    <div id="chart-stories">${chartStoriesHtml()}</div>
  `;
}

function chartHeadHtml(quote) {
  if (!quote) return `<div class="q-name">${escapeHtml(state.symbol)}</div>`;
  const direction = directionOf(quote);
  const change = quote.kind === "yield" ? `${signed(quote.bp, 1)} bp` : `${signed(quote.changePct, 2)}%`;
  return `
    <div class="q-top"><span class="q-name">${escapeHtml(quote.name)} · ${escapeHtml(quote.exchange || quote.symbol)}</span><span class="chg ${direction}">${change}</span></div>
    <div class="q-px ${direction}">${formatPrice(quote.price, quote.kind, quote.priceHint)}</div>
  `;
}

function chartStoriesHtml() {
  const stories = (state.data?.news || []).filter((story) => story.alignment?.symbol === state.symbol || story.tickers.includes(state.symbol)).slice(0, 8);
  if (!stories.length) return `<div class="empty">No headline in this pass maps to ${escapeHtml(state.symbol)}.</div>`;
  return stories.map(storyCard).join("");
}

function hitButton(hit) {
  return `<button type="button" data-symbol="${escapeHtml(hit.symbol)}"><b>${escapeHtml(hit.symbol)}</b> <small>${escapeHtml(hit.name)} · ${escapeHtml(hit.exchange || hit.type)}</small></button>`;
}

function pillSymbols() {
  const base = ["SPY", "QQQ", "IWM", "TLT", "^TNX", "CL=F", "GC=F", "BTC-USD", "NVDA", "ES=F", "^VIX", "DX-Y.NYB"];
  if (!base.includes(state.symbol)) base.unshift(state.symbol);
  return base;
}

function renderChartChrome() {
  const head = document.querySelector("#chart-head");
  const stories = document.querySelector("#chart-stories");
  if (head) head.innerHTML = chartHeadHtml(findQuote(state.symbol));
  if (stories) {
    stories.innerHTML = chartStoriesHtml();
    bindStoryButtons(stories);
  }
}

function bindMain() {
  main.querySelectorAll("[data-symbol]").forEach((node) => {
    if (node.dataset.bound) return;
    node.dataset.bound = "1";
    node.addEventListener("click", () => {
      state.symbol = node.dataset.symbol;
      state.focusTime = node.dataset.time ? Number(node.dataset.time) : null;
      state.hits = [];
      setView("chart");
    });
  });
  main.querySelectorAll("[data-filter]").forEach((node) => {
    node.addEventListener("click", () => {
      state.wireFilter = node.dataset.filter;
      paint(false);
    });
  });
  main.querySelector("[data-refresh]")?.addEventListener("click", () => {
    loadSnapshot(true).catch((error) => {
      state.error = error.message;
      paint(true);
    });
  });
  const search = document.querySelector("#symbol-search");
  if (search) {
    search.addEventListener("input", () => {
      state.search = search.value;
      scheduleSearch();
    });
  }
  main.querySelectorAll("[data-range]").forEach((node) => {
    node.addEventListener("click", () => {
      state.range = node.dataset.range;
      state.focusTime = null;
      document.querySelectorAll("[data-range]").forEach((button) => button.classList.toggle("on", button.dataset.range === state.range));
      loadChart();
    });
  });
  bindStoryButtons(main);
}

function bindStoryButtons(root) {
  root.querySelectorAll(".align").forEach((node) => {
    if (node.dataset.bound) return;
    node.dataset.bound = "1";
    node.addEventListener("click", () => {
      state.symbol = node.dataset.symbol;
      state.focusTime = Number(node.dataset.time);
      setView("chart");
    });
  });
}

let searchTimer = 0;
function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const query = state.search.trim();
    if (query.length < 1) {
      state.hits = [];
      const box = document.querySelector("#hits");
      if (box) box.innerHTML = "";
      return;
    }
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const payload = await response.json();
      state.hits = payload.quotes || [];
      const box = document.querySelector("#hits");
      if (box) {
        box.innerHTML = state.hits.map(hitButton).join("");
        box.querySelectorAll("[data-symbol]").forEach((node) => {
          node.addEventListener("click", () => {
            state.symbol = node.dataset.symbol;
            state.focusTime = null;
            state.search = "";
            state.hits = [];
            destroyChart();
            paint(false);
            loadChart();
          });
        });
      }
    } catch {
      state.hits = [];
    }
  }, 250);
}

async function loadChart() {
  if (state.view !== "chart") return;
  state.loadingChart = true;
  try {
    const response = await fetch(`/api/chart?symbol=${encodeURIComponent(state.symbol)}&range=${encodeURIComponent(state.range)}`);
    if (!response.ok) throw new Error("Yahoo had no bars for that symbol.");
    const payload = await response.json();
    if (!document.querySelector("#chart-root")) paint(false);
    drawChart(payload);
    const head = document.querySelector("#chart-head");
    if (head) {
      head.innerHTML = chartHeadHtml({
        name: payload.name,
        exchange: payload.exchange,
        kind: payload.kind,
        bp: payload.bp,
        changePct: payload.changePct,
        price: payload.price,
        priceHint: payload.priceHint,
      });
    }
    renderChartChrome();
  } catch (error) {
    const root = document.querySelector("#chart-root");
    if (root) root.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  } finally {
    state.loadingChart = false;
  }
}

function drawChart(payload) {
  const root = document.querySelector("#chart-root");
  if (!root || !window.LightweightCharts) return;
  if (!state.chart) {
    state.chart = window.LightweightCharts.createChart(root, {
      autoSize: true,
      layout: {
        background: { color: "#171c18" },
        textColor: "#93a094",
        fontFamily: "IBM Plex Sans, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(44, 54, 46, 0.7)" },
        horzLines: { color: "rgba(44, 54, 46, 0.7)" },
      },
      rightPriceScale: { borderColor: "#2c362e" },
      timeScale: { borderColor: "#2c362e", timeVisible: state.range === "1D" || state.range === "5D", secondsVisible: false },
      crosshair: { mode: window.LightweightCharts.CrosshairMode.Normal },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, pinch: true },
    });
    state.volume = state.chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: "rgba(143, 191, 196, 0.35)",
    });
    state.chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    state.candle = state.chart.addCandlestickSeries({
      upColor: "#c5e07a",
      downColor: "#f07167",
      borderVisible: false,
      wickUpColor: "#c5e07a",
      wickDownColor: "#f07167",
      priceFormat: priceFormat(payload),
    });
    state.chart.subscribeCrosshairMove((param) => {
      const ohlc = document.querySelector("#ohlc");
      if (!ohlc) return;
      const bar = param.seriesData.get(state.candle);
      if (!bar) {
        ohlc.textContent = "";
        return;
      }
      const when = typeof param.time === "number"
        ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }).format(new Date(param.time * 1000))
        : "";
      ohlc.textContent = `${when}  O ${bar.open.toFixed(2)}  H ${bar.high.toFixed(2)}  L ${bar.low.toFixed(2)}  C ${bar.close.toFixed(2)}`;
    });
  }
  state.candle.applyOptions({ priceFormat: priceFormat(payload) });
  state.candle.setData(payload.bars.map((bar) => ({
    time: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  })));
  state.volume.setData(payload.bars.map((bar) => ({
    time: bar.time,
    value: bar.volume || 0,
    color: bar.close >= bar.open ? "rgba(197, 224, 122, 0.35)" : "rgba(240, 113, 103, 0.35)",
  })));
  const markers = (payload.markers || []).slice(0, 12).map((marker) => ({
    time: marker.time,
    position: marker.pct >= 0 ? "aboveBar" : "belowBar",
    color: marker.pct >= 0 ? "#e0c48a" : "#f07167",
    shape: "circle",
    text: marker.code,
  }));
  state.candle.setMarkers(markers);
  state.chart.timeScale().applyOptions({
    timeVisible: state.range === "1D" || state.range === "5D",
    secondsVisible: false,
  });
  const fitKey = `${payload.symbol}|${state.range}|${state.focusTime || ""}`;
  if (fitKey === state.fitKey) return;
  state.fitKey = fitKey;
  if (state.focusTime) {
    const pad = state.range === "1D" || state.range === "5D" ? 6 * 3600 : 20 * 86400;
    try {
      state.chart.timeScale().setVisibleRange({
        from: state.focusTime - pad,
        to: state.focusTime + pad,
      });
    } catch {
      state.chart.timeScale().fitContent();
    }
  } else {
    state.chart.timeScale().fitContent();
  }
}

function destroyChart() {
  if (state.chart) {
    state.chart.remove();
    state.chart = null;
    state.candle = null;
    state.volume = null;
  }
}

function priceFormat(payload) {
  if (payload.kind === "fx") return { type: "price", precision: 4, minMove: 0.0001 };
  if (payload.kind === "yield") return { type: "price", precision: 3, minMove: 0.001 };
  const precision = payload.priceHint >= 3 ? payload.priceHint : 2;
  return { type: "price", precision, minMove: 10 ** -precision };
}

function findQuote(symbol) {
  return state.data?.quotes?.find((quote) => quote.symbol === symbol) || null;
}

function shortName(symbol) {
  return findQuote(symbol)?.name || symbol;
}

function bannerHtml() {
  if (!state.error) return "";
  return `<div class="banner bad">${escapeHtml(state.error)}</div>`;
}

function directionOf(quote) {
  const value = quote.kind === "yield" ? quote.bp : quote.changePct;
  if (value == null || Math.abs(value) < (quote.kind === "yield" ? 0.4 : 0.03)) return "flat";
  return value > 0 ? "up" : "down";
}

function directionFromPct(value) {
  if (value == null || Math.abs(value) < 0.0001) return "flat";
  return value > 0 ? "up" : "down";
}

function formatPrice(value, kind, hint = 2) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (kind === "yield") return `${value.toFixed(3)}%`;
  if (kind === "fx") return value.toFixed(4);
  const digits = hint >= 4 ? 4 : 2;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function signed(value, digits) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function ago(ms) {
  const seconds = Math.max(0, (Date.now() - ms) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 90) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function relTime(ms) {
  const seconds = (Date.now() - ms) / 1000;
  if (seconds < 90) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 18 * 3600) return `${Math.round(seconds / 3600)}h ago`;
  return formatEt(ms / 1000);
}

function formatEt(unix) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(unix * 1000));
}

function nyLabel(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function nySession(date) {
  const parts = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)) parts[part.type] = part.value;
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
  return { equity, futures };
}

function labelSession(value) {
  if (value === "open") return "open";
  if (value === "pre") return "pre";
  if (value === "post") return "post";
  if (value === "halt") return "halt";
  return "closed";
}

function pillClass(value) {
  if (value === "open") return "open";
  if (value === "pre" || value === "post" || value === "halt") return "live";
  return "shut";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

main.addEventListener("click", (event) => {
  const seriesButton = event.target.closest("[data-series]");
  if (seriesButton && state.view === "bonds") {
    state.creditSeries = seriesButton.dataset.series;
    document.querySelectorAll("[data-series]").forEach((node) => {
      node.classList.toggle("on", node.dataset.series === state.creditSeries);
    });
    drawCredit();
  }
  const rangeButton = event.target.closest("[data-credit-range]");
  if (rangeButton && state.view === "bonds") {
    state.creditRange = rangeButton.dataset.creditRange;
    document.querySelectorAll("[data-credit-range]").forEach((node) => {
      node.classList.toggle("on", node.dataset.creditRange === state.creditRange);
    });
    state.creditFit = "";
    drawCredit();
  }
});

function bondsHtml() {
  if (!state.credit) {
    const message = state.creditError || "Building the credit book.";
    return `<section class="loading"><p class="kicker">Corporate credit</p><h1>${escapeHtml(message)}</h1><p class="muted">Treasury curve, duration-scaled corporate ETFs, and the bond wire.</p></section>`;
  }
  return `
    ${bannerHtml()}
    <div id="credit-copy">${creditCopyHtml()}</div>
    <div id="credit-board">${creditBoardHtml()}</div>
    <div class="section-label"><span>Spread proxy</span><small>cumulative excess, bp</small></div>
    <div class="toolbar">
      ${chartSeries().map((symbol) => `<button class="seg ${state.creditSeries === symbol ? "on" : ""}" type="button" data-series="${symbol}">${escapeHtml(seriesLabel(symbol))}</button>`).join("")}
    </div>
    <div class="chart-card">
      <div class="legend" id="credit-legend"><span>Excess versus duration-scaled Treasuries</span></div>
      <div id="credit-root"></div>
      <div class="toolbar">
        ${["1M", "3M", "1Y"].map((range) => `<button class="seg ${state.creditRange === range ? "on" : ""}" type="button" data-credit-range="${range}">${range}</button>`).join("")}
      </div>
    </div>
    <p class="fineprint">A falling line is a tighter proxy. A rising line means the corporate ETF lagged Treasuries. Over a month the drift includes carry. A kink is the spread move.</p>
    <div class="section-label"><span>Bond wire</span><small>the headline opens the article</small></div>
    <div id="credit-wire">${creditWireHtml()}</div>
  `;
}

function creditCopyHtml() {
  const note = state.credit.note;
  return `
    <p class="kicker">${escapeHtml(note.kicker)}</p>
    <h1>${escapeHtml(note.title)}</h1>
    <div class="stats">${note.stats.map(creditStat).join("")}</div>
    <div class="prose">${note.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</div>
  `;
}

function creditStat(stat) {
  return `<div class="stat"><span>${escapeHtml(stat.label)}</span><b class="${escapeHtml(stat.tone)}">${escapeHtml(stat.value)}</b><em class="${escapeHtml(stat.tone)}">${escapeHtml(stat.sub)}</em></div>`;
}

function creditBoardHtml() {
  const curve = state.credit.curve.map((point) => `
    <button class="quote" type="button" data-symbol="${escapeHtml(point.symbol)}">
      <div class="q-top"><span class="q-name">${escapeHtml(point.name)}</span><span class="chg brass">${signed(point.bp, 1)} bp</span></div>
      <div class="q-px">${Number(point.yield).toFixed(3)}%</div>
    </button>
  `).join("");
  const slopes = state.credit.slopes.map((item) => `
    <div class="slope"><span class="q-name">${escapeHtml(item.name)}</span><b>${Number(item.level).toFixed(0)} bp</b><span class="chg brass">${signed(item.change, 1)} bp</span></div>
  `).join("");
  const groups = ["ig", "hy", "loan", "em", "hybrid"];
  const boards = groups.map((group) => {
    const rows = state.credit.sleeves.filter((sleeve) => sleeve.group === group);
    if (!rows.length) return "";
    return `
      <div class="section-label"><span>${escapeHtml(rows[0].groupLabel)}</span></div>
      <div class="sleeve-head"><span>Sleeve</span><span>Price</span><span>1 day</span><span>5 day</span></div>
      ${rows.map(sleeveRow).join("")}
    `;
  }).join("");
  return `
    <div class="section-label"><span>Treasury curve</span><small>yield change</small></div>
    <div class="rail">${curve}</div>
    <div class="slope-row">${slopes}</div>
    ${boards}
  `;
}

function sleeveRow(sleeve) {
  const day = sleeve.floating ? "float" : excessText(sleeve.excess1);
  const week = sleeve.floating ? "—" : excessText(sleeve.excess5);
  const hedge = sleeve.floating ? "Floating rate" : `vs ${sleeve.hedge}`;
  const action = sleeve.chart ? `data-series="${sleeve.symbol}"` : `data-symbol="${sleeve.symbol}"`;
  return `
    <button class="sleeve ${state.creditSeries === sleeve.symbol ? "on" : ""}" type="button" ${action}>
      <span><b>${escapeHtml(sleeve.name)}</b><small>${escapeHtml(sleeve.symbol)} · ${escapeHtml(hedge)}</small></span>
      <span class="px">${formatPrice(sleeve.price, "price", 2)}<small class="${directionFromPct(sleeve.changePct)}"> ${signed(sleeve.changePct, 2)}%</small></span>
      <span class="ex ${excessTone(sleeve.excess1)}">${day}</span>
      <span class="ex ${sleeve.floating ? "flat" : excessTone(sleeve.excess5)}">${week}</span>
    </button>
  `;
}

function excessText(bp) {
  if (!Number.isFinite(bp)) return "—";
  return signed(bp, 1);
}

function excessTone(bp) {
  if (!Number.isFinite(bp) || Math.abs(bp) < 0.6) return "flat";
  return bp > 0 ? "wider" : "tighter";
}

function chartSeries() {
  return (state.credit?.sleeves || []).filter((sleeve) => sleeve.chart).map((sleeve) => sleeve.symbol);
}

function seriesLabel(symbol) {
  return state.credit?.sleeves?.find((sleeve) => sleeve.symbol === symbol)?.name || symbol;
}

function creditWireHtml() {
  const stories = creditStories();
  if (!stories.length) return `<div class="empty">No credit headlines in this pass of the wire.</div>`;
  return stories.map(storyCard).join("");
}

function creditStories() {
  const pattern = /\b(bonds?|yields?|treasur(?:y|ies)|credit|spreads?|high[- ]yield|investment[- ]grade|issuance|default|coupon|fixed income|corporate debt|junk)\b/i;
  return (state.data?.news || []).filter((story) => (
    pattern.test(story.title)
    || story.themes?.includes("credit")
    || story.themes?.includes("rates")
    || story.tickers?.some((ticker) => ["LQD", "HYG", "JNK", "TLT"].includes(ticker))
  )).slice(0, 12);
}

async function loadCredit() {
  try {
    const response = await fetch("/api/credit");
    if (!response.ok) throw new Error("The credit book did not answer.");
    state.credit = await response.json();
    state.creditError = "";
    if (!chartSeries().includes(state.creditSeries)) state.creditSeries = chartSeries()[0] || "LQD";
    if (state.view !== "bonds") return;
    if (!document.querySelector("#credit-root")) {
      destroyCreditChart();
      main.innerHTML = bondsHtml();
      bindMain();
    } else {
      document.querySelector("#credit-copy").innerHTML = creditCopyHtml();
      document.querySelector("#credit-board").innerHTML = creditBoardHtml();
      document.querySelector("#credit-wire").innerHTML = creditWireHtml();
      bindMain();
    }
    drawCredit();
  } catch (error) {
    state.creditError = error.message;
    if (state.view === "bonds" && !state.credit) main.innerHTML = bondsHtml();
  }
}

function drawCredit() {
  const root = document.querySelector("#credit-root");
  if (!root || !window.LightweightCharts || !state.credit) return;
  const pack = state.credit.history?.[state.creditSeries] || [];
  const days = state.creditRange === "1M" ? 22 : state.creditRange === "3M" ? 66 : 260;
  let cumulative = 0;
  const data = [];
  for (const point of pack.slice(-days)) {
    if (!Number.isFinite(point.excess)) continue;
    cumulative += point.excess;
    data.push({ time: point.time, value: Math.round(cumulative * 10) / 10 });
  }
  if (!data.length) {
    destroyCreditChart();
    root.textContent = "No overlapping Treasury hedge for this sleeve.";
    return;
  }
  if (!state.creditChart) {
    state.creditChart = window.LightweightCharts.createChart(root, {
      autoSize: true,
      layout: { background: { color: "#171c18" }, textColor: "#93a094", fontFamily: "IBM Plex Sans, sans-serif" },
      grid: { vertLines: { color: "rgba(44, 54, 46, 0.7)" }, horzLines: { color: "rgba(44, 54, 46, 0.7)" } },
      rightPriceScale: { borderColor: "#2c362e" },
      timeScale: { borderColor: "#2c362e" },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, pinch: true },
    });
    state.creditLine = state.creditChart.addAreaSeries({
      lineWidth: 2,
      priceFormat: { type: "price", precision: 1, minMove: 0.1 },
    });
  }
  const last = data.at(-1)?.value ?? 0;
  const tighter = last <= 0;
  state.creditLine.applyOptions({
    lineColor: tighter ? "#c5e07a" : "#f07167",
    topColor: tighter ? "rgba(197,224,122,0.3)" : "rgba(240,113,103,0.28)",
    bottomColor: "rgba(23,28,24,0.02)",
  });
  state.creditLine.setData(data);
  const legend = document.querySelector("#credit-legend");
  if (legend) {
    const word = last > 0.6 ? "wider" : last < -0.6 ? "tighter" : "flat";
    legend.textContent = `${seriesLabel(state.creditSeries)} · ${state.creditRange} · ${last > 0 ? "+" : ""}${last.toFixed(1)} bp ${word}`;
  }
  const fitKey = `${state.creditSeries}|${state.creditRange}|${data[0].time}`;
  if (state.creditFit !== fitKey) {
    state.creditFit = fitKey;
    state.creditChart.timeScale().fitContent();
  }
}

function destroyCreditChart() {
  if (state.creditChart) {
    state.creditChart.remove();
    state.creditChart = null;
    state.creditLine = null;
    state.creditFit = "";
  }
}

setInterval(renderChrome, 1000);
loadSnapshot().catch((error) => {
  state.error = error.message;
  if (state.view !== "bonds") main.innerHTML = `<div class="banner bad">${escapeHtml(error.message)}</div>`;
});
if (state.view === "bonds") loadCredit();
if (state.view === "chart") loadChart();
setInterval(() => {
  loadSnapshot(false).catch((error) => {
    state.error = error.message;
    renderChrome();
  });
  if (state.view === "bonds") loadCredit();
}, 30000);
