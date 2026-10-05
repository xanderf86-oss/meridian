// Corporate credit desk.
// Excess basis points are a trading proxy, not a quoted OAS.
// Positive excess means the credit ETF lagged a duration-scaled Treasury ETF (wider).
// Negative excess means it outperformed (tighter).

export const CREDIT_UNIVERSE = [
  { symbol: "^IRX", name: "13-week", group: "curve", kind: "yield" },
  { symbol: "^FVX", name: "5-year", group: "curve", kind: "yield" },
  { symbol: "^TNX", name: "10-year", group: "curve", kind: "yield" },
  { symbol: "^TYX", name: "30-year", group: "curve", kind: "yield" },
  { symbol: "SHY", name: "1–3Y Treasury", group: "hedge", duration: 1.9 },
  { symbol: "IEI", name: "3–7Y Treasury", group: "hedge", duration: 4.3 },
  { symbol: "IEF", name: "7–10Y Treasury", group: "hedge", duration: 7.1 },
  { symbol: "TLT", name: "20Y+ Treasury", group: "hedge", duration: 16 },
  { symbol: "VCSH", name: "Short IG", group: "ig", duration: 2.7, hedge: "SHY", chart: true },
  { symbol: "VCIT", name: "Intermediate IG", group: "ig", duration: 6, hedge: "IEF", chart: true },
  { symbol: "LQD", name: "Broad IG", group: "ig", duration: 8.2, hedge: "IEF", chart: true },
  { symbol: "VCLT", name: "Long IG", group: "ig", duration: 13, hedge: "TLT", chart: true },
  { symbol: "SHYG", name: "Short HY", group: "hy", duration: 2.2, hedge: "SHY" },
  { symbol: "HYG", name: "Broad HY", group: "hy", duration: 3.5, hedge: "IEI", chart: true },
  { symbol: "JNK", name: "HY SPDR", group: "hy", duration: 3.6, hedge: "IEI" },
  { symbol: "ANGL", name: "Fallen angels", group: "hy", duration: 5.2, hedge: "IEF", chart: true },
  { symbol: "BKLN", name: "Senior loans", group: "loan", floating: true },
  { symbol: "EMB", name: "EM dollar", group: "em", duration: 6.8, hedge: "IEF", chart: true },
  { symbol: "PFF", name: "Preferreds", group: "hybrid", duration: 4.2, hedge: "IEI" },
];

const GROUP_LABEL = {
  ig: "Investment grade",
  hy: "High yield",
  loan: "Loans",
  em: "Emerging markets",
  hybrid: "Hybrids",
};

function signed(value, digits) {
  if (!Number.isFinite(value)) return "n/a";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function levelMove(meta, kind) {
  const price = Number(meta?.regularMarketPrice);
  let pct = Number(meta?.regularMarketChangePercent);
  let prev = Number(meta?.previousClose);
  if (!Number.isFinite(prev) && Number.isFinite(pct) && Number.isFinite(price)) prev = price / (1 + pct / 100);
  if (!Number.isFinite(pct) && Number.isFinite(prev) && prev && Number.isFinite(price)) pct = ((price - prev) / prev) * 100;
  const change = Number.isFinite(price) && Number.isFinite(prev) ? price - prev : null;
  return {
    price: Number.isFinite(price) ? price : null,
    changePct: Number.isFinite(pct) ? pct : null,
    bp: kind === "yield" && Number.isFinite(change) ? change * 100 : null,
  };
}

function dayKey(unix) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(unix * 1000));
}

function dailyCloses(bars) {
  const byDay = new Map();
  for (const bar of bars || []) {
    if (!Number.isFinite(bar.close)) continue;
    byDay.set(dayKey(bar.time), bar.close);
  }
  return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

function dailyReturns(closes) {
  const out = [];
  for (let index = 1; index < closes.length; index += 1) {
    const prev = closes[index - 1][1];
    const close = closes[index][1];
    if (!prev) continue;
    out.push({ time: closes[index][0], pct: ((close - prev) / prev) * 100 });
  }
  return out;
}

function excessBp(creditPct, hedgePct, creditDuration, hedgeDuration) {
  if (![creditPct, hedgePct, creditDuration, hedgeDuration].every(Number.isFinite)) return null;
  if (creditDuration <= 0 || hedgeDuration <= 0) return null;
  const scaledHedge = hedgePct * (creditDuration / hedgeDuration);
  return -((creditPct - scaledHedge) / creditDuration) * 100;
}

function sumLast(points, count) {
  const slice = points.slice(-count);
  if (!slice.length) return null;
  return Math.round(slice.reduce((total, point) => total + point.excess, 0) * 10) / 10;
}

function findSpec(symbol) {
  return CREDIT_UNIVERSE.find((item) => item.symbol === symbol);
}

function buildSleeve(spec, loaded) {
  const parsed = loaded.get(spec.symbol);
  if (!parsed) return null;
  const move = levelMove(parsed.meta, "price");
  const hedgeSpec = spec.hedge ? findSpec(spec.hedge) : null;
  const hedgeParsed = spec.hedge ? loaded.get(spec.hedge) : null;
  const creditReturns = dailyReturns(dailyCloses(parsed.bars));
  const hedgeReturns = new Map(dailyReturns(dailyCloses(hedgeParsed?.bars)).map((point) => [point.time, point.pct]));
  const history = [];
  if (!spec.floating && hedgeSpec && hedgeParsed) {
    for (const point of creditReturns) {
      const hedgePct = hedgeReturns.get(point.time);
      const excess = excessBp(point.pct, hedgePct, spec.duration, hedgeSpec.duration);
      if (!Number.isFinite(excess)) continue;
      history.push({ time: point.time, excess: Number(excess.toFixed(2)) });
    }
  }
  return {
    symbol: spec.symbol,
    name: spec.name,
    group: spec.group,
    groupLabel: GROUP_LABEL[spec.group] || spec.group,
    price: move.price,
    changePct: move.changePct,
    floating: Boolean(spec.floating),
    duration: spec.duration || null,
    hedge: spec.hedge || null,
    hedgeName: hedgeSpec?.name || null,
    hedgeDuration: hedgeSpec?.duration || null,
    chart: Boolean(spec.chart),
    excess1: spec.floating ? null : sumLast(history, 1),
    excess5: spec.floating ? null : sumLast(history, 5),
    excess21: spec.floating ? null : sumLast(history, 21),
    asOf: history.at(-1)?.time || null,
    history: spec.chart ? history.slice(-260) : undefined,
  };
}

function slope(long, short) {
  if (!long || !short || !Number.isFinite(long.yield) || !Number.isFinite(short.yield)) return null;
  return {
    level: (long.yield - short.yield) * 100,
    change: Number.isFinite(long.bp) && Number.isFinite(short.bp) ? long.bp - short.bp : null,
  };
}

function spreadPhrase(bp) {
  if (!Number.isFinite(bp)) return "unavailable";
  if (Math.abs(bp) < 0.6) return `about flat (${signed(bp, 1)} bp)`;
  return bp > 0 ? `${bp.toFixed(1)} bp wider` : `${Math.abs(bp).toFixed(1)} bp tighter`;
}

function nyToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function sessionLabel(dateKey) {
  if (!dateKey) return "the last session";
  if (dateKey === nyToday()) return "today";
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 16)));
}

function creditTitle(sleeves, curve) {
  const hy = sleeves.find((item) => item.symbol === "HYG");
  const ig = sleeves.find((item) => item.symbol === "LQD");
  const tnx = curve?.find((item) => item.symbol === "^TNX");
  if (!hy || !ig || !tnx || !Number.isFinite(hy.excess1) || !Number.isFinite(ig.excess1)) return "The credit book is incomplete";
  const long = sleeves.find((item) => item.symbol === "VCLT")?.excess5;
  const front = sleeves.find((item) => item.symbol === "VCSH")?.excess5;
  const dayGap = hy.excess1 - ig.excess1;
  const weekGap = Number.isFinite(hy.excess5) && Number.isFinite(ig.excess5) ? hy.excess5 - ig.excess5 : null;
  const when = sessionLabel(hy.asOf || ig.asOf);
  if (Number.isFinite(weekGap) && weekGap >= 8 && hy.excess1 < -1) {
    return when === "today"
      ? "High yield widened on the week, and today is only a bounce"
      : `High yield widened on the week; ${when} was only a bounce`;
  }
  if (Number.isFinite(weekGap) && weekGap >= 8) return "High yield has widened versus investment grade";
  if (Number.isFinite(weekGap) && weekGap <= -8) return "High yield has tightened versus investment grade";
  if (Number.isFinite(dayGap) && dayGap >= 2.5) return "High yield is lagging investment grade";
  if (Number.isFinite(dayGap) && dayGap <= -2.5) return "Investment grade is lagging high yield";
  if (Number.isFinite(hy?.excess1) && Number.isFinite(ig?.excess1) && hy.excess1 <= -2 && ig.excess1 <= -1) return "Credit is tighter versus Treasuries";
  if (Number.isFinite(hy?.excess1) && Number.isFinite(ig?.excess1) && hy.excess1 >= 2 && ig.excess1 >= 1) return "Credit is wider versus Treasuries";
  if (Number.isFinite(long) && Number.isFinite(front) && long - front >= 2.5) return "Long corporates are the weak sleeve over five sessions";
  if ([hy?.excess1, ig?.excess1, long, front].every((value) => !Number.isFinite(value) || Math.abs(value) < 1.2)) return "Credit is quiet versus the Treasury move";
  return "A split corporate book";
}

function creditNote(sleeves, curve, slopes) {
  const bySymbol = new Map(sleeves.map((item) => [item.symbol, item]));
  const lqd = bySymbol.get("LQD");
  const hyg = bySymbol.get("HYG");
  const vclt = bySymbol.get("VCLT");
  const vcsh = bySymbol.get("VCSH");
  const bkln = bySymbol.get("BKLN");
  const tnx = curve.find((item) => item.symbol === "^TNX");
  const tenThirty = slopes.find((item) => item.id === "10s30s");
  const paragraphs = [];
  paragraphs.push("These are not quoted option-adjusted spreads. The excess scales a Treasury ETF by the ratio of assumed durations, then turns the residual price gap into basis points. Positive means the corporate ETF lagged that rates move, a wider-spread proxy. Negative means it outperformed, a tighter proxy.");
  const when = sessionLabel(hyg?.asOf || lqd?.asOf);
  const onSession = when === "today" ? "on the day" : `on ${when}`;
  if (!lqd || !hyg) {
    const missing = [!lqd ? "LQD" : null, !hyg ? "HYG" : null].filter(Boolean).join(" and ");
    paragraphs.push(`The credit book is incomplete. ${missing} did not load, so this pass does not call the spread quiet.`);
  }
  if (lqd && hyg) {
    paragraphs.push(`Broad investment grade, LQD versus the 7–10 year Treasury, is ${spreadPhrase(lqd.excess1)} ${onSession} and ${spreadPhrase(lqd.excess5)} over five sessions. Broad high yield, HYG versus the 3–7 year Treasury, is ${spreadPhrase(hyg.excess1)} ${onSession} and ${spreadPhrase(hyg.excess5)} over five sessions.`);
    if (Number.isFinite(hyg.excess1) && Number.isFinite(lqd.excess1) && Number.isFinite(hyg.excess5) && Number.isFinite(lqd.excess5)) {
      const gap = hyg.excess1 - lqd.excess1;
      const week = hyg.excess5 - lqd.excess5;
      if (week >= 5 && gap < 0) paragraphs.push(`${when === "today" ? "Today" : when} high yield beat investment grade by ${Math.abs(gap).toFixed(1)} bp. Over five sessions, high yield is still ${week.toFixed(1)} bp wider than investment grade. Treat that session as a bounce inside a week of decompression.`);
      else if (week <= -5 && gap > 0) paragraphs.push(`${when === "today" ? "Today" : when} high yield lagged investment grade by ${gap.toFixed(1)} bp, against a five-session stretch in which high yield had been ${Math.abs(week).toFixed(1)} bp tighter. That session is the give-back.`);
      else if (week >= 5) paragraphs.push(`Over five sessions, high yield is ${week.toFixed(1)} bp wider than investment grade. That is decompression: the market is charging more for lower quality, not only for duration.`);
      else if (gap <= -2.5) paragraphs.push(`High yield beat investment grade by ${Math.abs(gap).toFixed(1)} bp ${onSession}. In the ETF proxy, quality spreads are compressing.`);
      else if (gap >= 2.5) paragraphs.push(`High yield lagged investment grade by ${gap.toFixed(1)} bp ${onSession}. That is decompression.`);
      else paragraphs.push("Investment grade and high yield are moving together versus rates, so this is not a quality event.");
    }
  }
  if (vclt && vcsh && Number.isFinite(vclt.excess5) && Number.isFinite(vcsh.excess5)) {
    const gap = vclt.excess5 - vcsh.excess5;
    if (gap >= 2.5) paragraphs.push(`Over five sessions, long investment grade is weaker than short investment grade by ${gap.toFixed(1)} bp after the duration scale. Look at the credit curve before you call it a broad spread move.`);
    else if (gap <= -2.5) paragraphs.push(`Over five sessions, short investment grade is weaker than the long sleeve by ${Math.abs(gap).toFixed(1)} bp. The front end of credit is the soft part of the curve.`);
    else paragraphs.push(`Over five sessions, short and long investment grade differ by ${Math.abs(gap).toFixed(1)} bp. Anything inside 2.5 bp is noise in this Treasury match.`);
  }
  const loudest = sleeves.filter((item) => Number.isFinite(item.excess1)).sort((a, b) => Math.abs(b.excess1) - Math.abs(a.excess1))[0];
  if (loudest?.symbol === "PFF" && Math.abs(loudest.excess1) >= 8) {
    paragraphs.push(`The largest one-day cell is preferreds, ${signed(loudest.excess1, 1)} bp. That residual is the equity-like preferred against its Treasury hedge, not a corporate spread.`);
  }
  if (bkln && Number.isFinite(bkln.changePct)) {
    paragraphs.push(`Senior loans, BKLN, are ${signed(bkln.changePct, 2)}% on price. They float, so that print is mostly credit and discount margin. If loans are calm while fixed-rate high yield is moving, rates are doing more of the work than default risk.`);
  }
  if (tnx && tenThirty) {
    paragraphs.push(`The 10-year quote here is ${tnx.yield.toFixed(3)}% (${signed(tnx.bp, 1)} bp versus its prior close). The 10s30s slope is ${tenThirty.level.toFixed(0)} bp. The credit excess above is ${when}, so do not treat that residual as this minute's spread.`);
  }
  paragraphs.push("Assumed durations are round figures, not today’s fund holdings: SHY 1.9, IEI 4.3, IEF 7.1, TLT 16, VCSH 2.7, VCIT 6.0, LQD 8.2, VCLT 13, SHYG 2.2, HYG 3.5, JNK 3.6, ANGL 5.2, EMB 6.8, preferreds 4.2. The scale assumes a parallel curve shift. Over a month the cumulative chart drifts with carry; a one-day or five-day sum is the cleaner spread impulse. This is a corporate-bond trading proxy, not a TRACE print.");
  const hy = hyg?.excess1;
  const ig = lqd?.excess1;
  return {
    kicker: "Corporate credit",
    title: creditTitle(sleeves, curve),
    paragraphs,
    stats: [
      statExcess("IG vs UST", ig, "LQD · 1 day"),
      statExcess("HY vs UST", hy, "HYG · 1 day"),
      statExcess("HY vs IG, 5d", Number.isFinite(hyg?.excess5) && Number.isFinite(lqd?.excess5) ? hyg.excess5 - lqd.excess5 : null, "quality"),
      {
        label: "US 10Y",
        value: tnx ? `${tnx.yield.toFixed(3)}%` : "—",
        sub: tnx ? `${signed(tnx.bp, 1)} bp` : "",
        tone: "brass",
      },
    ],
  };
}

function statExcess(label, bp, sub) {
  let tone = "flat";
  let value = "—";
  if (Number.isFinite(bp)) {
    tone = bp > 0.6 ? "wider" : bp < -0.6 ? "tighter" : "flat";
    const word = tone === "wider" ? "wider" : tone === "tighter" ? "tighter" : "flat";
    value = `${signed(bp, 1)} bp`;
    sub = `${word} · ${sub}`;
  }
  return { label, value, sub, tone };
}

export function assembleCredit(loaded) {
  const curve = [];
  const sleeves = [];
  const history = {};
  for (const spec of CREDIT_UNIVERSE) {
    const parsed = loaded.get(spec.symbol);
    if (!parsed) continue;
    if (spec.group === "curve") {
      const move = levelMove(parsed.meta, "yield");
      if (!Number.isFinite(move.price)) continue;
      curve.push({ symbol: spec.symbol, name: spec.name, yield: move.price, bp: move.bp });
      continue;
    }
    if (spec.group === "hedge") continue;
    const sleeve = buildSleeve(spec, loaded);
    if (!sleeve) continue;
    if (sleeve.history) {
      history[sleeve.symbol] = sleeve.history;
      delete sleeve.history;
    }
    sleeves.push(sleeve);
  }
  const bySymbol = new Map(curve.map((item) => [item.symbol, item]));
  const slopes = [
    { id: "5s10s", name: "5s10s", ...slope(bySymbol.get("^TNX"), bySymbol.get("^FVX")) },
    { id: "10s30s", name: "10s30s", ...slope(bySymbol.get("^TYX"), bySymbol.get("^TNX")) },
    { id: "bill10s", name: "Bill–10s", ...slope(bySymbol.get("^TNX"), bySymbol.get("^IRX")) },
  ].filter((item) => Number.isFinite(item.level));
  return {
    curve,
    slopes,
    sleeves,
    history,
    note: creditNote(sleeves, curve, slopes),
  };
}
