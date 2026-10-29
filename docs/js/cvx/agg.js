// CV DATA 특장·가격 — aggregation.
//
// Pure functions over decoded registration rows: no DOM, no fetch, no i18n,
// so tests/cvx-agg.test.mjs runs them under plain Node. The pages compose
// these and hand the results to js/cvx/ui.js.
//
// A row: { m, brandRaw, brand, imp, model, axle, cat, sub, bb, priceWon, price }
//   brand  — 원제작사, with minor brands folded into 기타 수입 / 기타 국산
//   imp    — true for 외산
//   price  — 백만원 (null when the workbook has none)
//   blanks — null

import {
  CAT_ORDER, AXLE_ORDER, AXLE_GROUPS, MINOR_BRAND_SHARE, OTHER_IMPORT, OTHER_DOMESTIC,
} from "./schema.js";

// ---- decoding ---------------------------------------------------------------

/** cvrows_{year}.json → { year, rows, lastMonth }. */
export function decodeRows(json) {
  const { dict, cols } = json;
  const pick = (key, i) => {
    const k = cols[key][i];
    return k < 0 ? null : dict[key][k];
  };
  const rows = [];
  for (let i = 0; i < json.n; i++) {
    const won = cols.price[i] || 0;
    rows.push({
      m: cols.m[i],
      brandRaw: pick("brand", i),
      brand: null,
      imp: cols.imp[i] === 1,
      model: pick("model", i),
      axle: pick("axle", i),
      cat: pick("cat", i),
      sub: pick("sub", i),
      bb: pick("bb", i),
      priceWon: won > 0 ? won : null,
      price: won > 0 ? won / 1_000_000 : null,
    });
  }
  foldMinorBrands(rows);
  const lastMonth = rows.reduce((a, r) => Math.max(a, r.m || 0), 0);
  return { year: json.year, rows, lastMonth };
}

/**
 * Set row.brand: the raw brand, or 기타 수입 / 기타 국산 when the brand holds
 * under MINOR_BRAND_SHARE of its own side of the year. Read over the whole
 * year, so the columns do not come and go as the filters change.
 */
export function foldMinorBrands(rows, threshold = MINOR_BRAND_SHARE) {
  const side = { true: 0, false: 0 };
  const per = new Map();
  for (const r of rows) {
    side[r.imp]++;
    const k = `${r.imp}|${r.brandRaw}`;
    per.set(k, (per.get(k) || 0) + 1);
  }
  for (const r of rows) {
    const n = per.get(`${r.imp}|${r.brandRaw}`);
    const minor = r.brandRaw === null || n < side[r.imp] * threshold;
    r.brand = minor ? (r.imp ? OTHER_IMPORT : OTHER_DOMESTIC) : r.brandRaw;
  }
  return rows;
}

// ---- orders -----------------------------------------------------------------

/** `preferred` in its own order, then every other value in `values` by count. */
export function orderWith(preferred, values) {
  const counts = new Map();
  for (const v of values) if (v !== null) counts.set(v, (counts.get(v) || 0) + 1);
  const rest = [...counts.keys()].filter(v => !preferred.includes(v))
    .sort((a, b) => counts.get(b) - counts.get(a) || String(a).localeCompare(String(b), "ko"));
  return [...preferred, ...rest];
}

export const catOrder = (rows) => orderWith(CAT_ORDER, rows.map(r => r.cat));
export const axleOrder = (rows) => orderWith(AXLE_ORDER, rows.map(r => r.axle));

/** The group an axle belongs to; an axle in no group is its own. */
export function axleGroupOf(axle) {
  const g = AXLE_GROUPS.find(g => g.members.includes(axle));
  return g ? g.key : axle;
}

/** Axle columns for a mode: the axles themselves, or their groups in order. */
export function axleKeys(axles, mode) {
  if (mode !== "group") return axles;
  const out = [];
  for (const a of axles) {
    const g = axleGroupOf(a);
    if (!out.includes(g)) out.push(g);
  }
  return out;
}

export const axleKeyFn = (mode) => (mode === "group" ? (r) => axleGroupOf(r.axle) : (r) => r.axle);

/** Import brands then domestic, each in Korean collation, 기타 last on its side. */
export function brandOrder(rows) {
  const imp = new Map();
  for (const r of rows) if (r.brand !== null) imp.set(r.brand, r.imp);
  const side = (want, other) => [...imp.keys()]
    .filter(b => imp.get(b) === want && b !== other)
    .sort((a, b) => a.localeCompare(b, "ko"))
    .concat(imp.has(other) ? [other] : []);
  return { imports: side(true, OTHER_IMPORT), domestics: side(false, OTHER_DOMESTIC) };
}

// ---- period & filters -------------------------------------------------------

/**
 * `month` is "ytd" or 1–12. YTD runs January to the data's last month; a single
 * month is that month alone, and is also the "당월" the tiles report.
 */
export function periodOf(month, lastMonth) {
  const n = parseInt(month, 10);
  if (n >= 1 && n <= 12) return { mode: "month", from: n, to: n, sel: n };
  return { mode: "ytd", from: 1, to: lastMonth, sel: lastMonth };
}

/**
 * Rows passing every filter given. Unset / "all" filters pass everything.
 * f: { from, to, oem: all|import|domestic, cat, axle, axleMode, bb, brand,
 *      model, bodied }
 * `brand` takes a brand name or "import" (수입 전체). `bodied` keeps only
 * rows that name a 특장업체.
 */
export function filterRows(rows, f = {}) {
  const axleFn = axleKeyFn(f.axleMode);
  const set = (v) => v !== undefined && v !== null && v !== "" && v !== "all";
  return rows.filter(r =>
    (!f.from || r.m >= f.from) && (!f.to || r.m <= f.to) &&
    (f.oem !== "import" || r.imp) && (f.oem !== "domestic" || !r.imp) &&
    (!set(f.cat) || r.cat === f.cat) &&
    (!set(f.axle) || axleFn(r) === f.axle) &&
    (!set(f.bb) || r.bb === f.bb) &&
    (!set(f.brand) || (f.brand === "import" ? r.imp : r.brand === f.brand)) &&
    (!set(f.model) || r.model === f.model) &&
    (!f.bodied || r.bb !== null));
}

// ---- counting ---------------------------------------------------------------

export function countBy(rows, fn) {
  const out = new Map();
  for (const r of rows) {
    const k = fn(r);
    out.set(k, (out.get(k) || 0) + 1);
  }
  return out;
}

/**
 * Cross-tab. Every row lands in exactly one cell: keys the caller did not list
 * are appended, so row sums, column sums and the total always agree.
 */
export function pivot(rows, rowFn, colFn, rowKeys = [], colKeys = []) {
  const rk = [...rowKeys], ck = [...colKeys];
  const cells = new Map();
  for (const r of rows) {
    const a = rowFn(r), b = colFn(r);
    if (!rk.includes(a)) rk.push(a);
    if (!ck.includes(b)) ck.push(b);
    const k = `${a}\u0000${b}`;
    cells.set(k, (cells.get(k) || 0) + 1);
  }
  const cell = (a, b) => cells.get(`${a}\u0000${b}`) || 0;
  const rowTotal = (a) => ck.reduce((s, b) => s + cell(a, b), 0);
  const colTotal = (b) => rk.reduce((s, a) => s + cell(a, b), 0);
  return { rowKeys: rk, colKeys: ck, cell, rowTotal, colTotal, total: rows.length };
}

/** Months 1..12 of a count; months after `last` are null (not yet reported). */
export function monthly(rows, last, fn = () => true) {
  const out = Array(12).fill(0);
  for (const r of rows) if (r.m >= 1 && r.m <= 12 && fn(r)) out[r.m - 1]++;
  return out.map((v, i) => (i < last ? v : null));
}

/** Month by month ratio of two monthly series, in %. */
export const monthlyShare = (num, den) =>
  num.map((v, i) => (v === null || den[i] === null ? null : share(v, den[i])));

/** Simple 3-month average including the month; null until three months exist. */
export function movingAvg3(series) {
  return series.map((v, i) => {
    if (i < 2) return null;
    const w = series.slice(i - 2, i + 1);
    return w.some(x => x === null || x === undefined) ? null : (w[0] + w[1] + w[2]) / 3;
  });
}

// ---- ratios -----------------------------------------------------------------

export const share = (n, d) => (d ? (n / d) * 100 : null);
export const ppDiff = (a, b) => (a === null || a === undefined || b === null || b === undefined ? null : a - b);
export const yoy = (cur, prev) => (prev ? ((cur - prev) / prev) * 100 : null);
export const pctChange = (cur, prev) =>
  (cur === null || cur === undefined || !prev ? null : (cur / prev - 1) * 100);

/**
 * Entries of a count map, largest first; equal counts keep `order`'s order,
 * so the "주력" item of a tie is the one listed first.
 */
export function ranked(counts, order = []) {
  const idx = (k) => { const i = order.indexOf(k); return i < 0 ? Infinity : i; };
  return [...counts.entries()]
    .filter(([, n]) => n > 0)
    .map(([key, n]) => ({ key, n }))
    .sort((a, b) => b.n - a.n || idx(a.key) - idx(b.key));
}

/**
 * Competition ranks over a ranked list: equal counts share a rank and the next
 * rank skips (1, 2, 2, 4). `tied` marks a rank more than one entry holds.
 */
export function withRanks(list) {
  const out = [];
  list.forEach((e, i) => {
    const rank = i > 0 && e.n === list[i - 1].n ? out[i - 1].rank : i + 1;
    out.push({ ...e, rank });
  });
  for (const e of out) e.tied = out.filter(x => x.rank === e.rank).length > 1;
  return out;
}

/**
 * Up to three podium places: each place lists every entry tied on it, and the
 * place after a tie is skipped (1위 벤츠·만, then 3위).
 */
export function podium(list, places = 3) {
  const out = [];
  for (const e of withRanks(list)) {
    if (e.rank > places) break;
    const slot = out.find(p => p.rank === e.rank);
    if (slot) slot.keys.push(e.key);
    else out.push({ rank: e.rank, keys: [e.key], n: e.n });
  }
  return Array.from({ length: places }, (_, i) => out.find(p => p.rank === i + 1) || null);
}

// ---- ① bodybuilder ranking --------------------------------------------------

/**
 * One line per bodybuilder over `cur`, the top `topN` by volume, the rest as
 * one line, and the total. `prev` (same filters, last year) gives the pp move;
 * pass null when last year is missing.
 */
export function bbRanking(cur, prev, { topN, MB, cats, axleKeysList, axleMode }) {
  const total = cur.length;
  const prevTotal = prev ? prev.length : 0;
  const prevBy = prev ? countBy(prev, r => r.bb) : null;
  const axleFn = axleKeyFn(axleMode);

  const line = (bb, rs) => {
    const n = rs.length;
    const imp = rs.filter(r => r.imp).length;
    const mb = rs.filter(r => r.brand === MB).length;
    const s = share(n, total);
    return {
      bb, n, share: s,
      pp: prev && prevTotal ? ppDiff(s, share(prevBy.get(bb) || 0, prevTotal)) : null,
      mainCat: ranked(countBy(rs, r => r.cat), cats)[0] || null,
      mainAxle: ranked(countBy(rs, axleFn), axleKeysList)[0] || null,
      imp, impShare: share(imp, n),
      mb, mbShare: share(mb, n),
    };
  };

  const groups = new Map();
  for (const r of cur) {
    if (!groups.has(r.bb)) groups.set(r.bb, []);
    groups.get(r.bb).push(r);
  }
  const all = [...groups.entries()]
    .map(([bb, rs]) => line(bb, rs))
    .sort((a, b) => b.n - a.n || String(a.bb).localeCompare(String(b.bb), "ko"));
  all.forEach((l, i) => { l.rank = i + 1; });

  const top = all.slice(0, topN);
  const restKeys = new Set(all.slice(topN).map(l => l.bb));
  const restRows = cur.filter(r => restKeys.has(r.bb));
  const other = restKeys.size ? { ...line(null, restRows), count: restKeys.size } : null;
  if (other) {
    const prevRest = prev ? prev.filter(r => restKeys.has(r.bb)).length : 0;
    other.pp = prev && prevTotal ? ppDiff(other.share, share(prevRest, prevTotal)) : null;
  }
  const sum = line(null, cur);
  sum.pp = null;

  return { top, other, total: sum, active: all.length, all };
}

// ---- prices -----------------------------------------------------------------

/** N / min / max / median / mean over the prices given, nulls and ≤0 dropped. */
export function priceStats(values) {
  const v = values.filter(x => x !== null && x !== undefined && x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return { n: v.length, min: v[0], max: v[v.length - 1], median, mean };
}

/**
 * Groups of rows sharing `keyFn`, with N ≥ minN, by spread (max − min) widest
 * first. Each: { key, rows, stats, spread, spreadPct }.
 */
export function dispersion(rows, keyFn, { minN = 2, top = 10 } = {}) {
  const groups = new Map();
  for (const r of rows) {
    if (!(r.price > 0)) continue;
    const k = keyFn(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.entries()]
    .map(([key, rs]) => {
      const stats = priceStats(rs.map(r => r.price));
      const spread = stats.max - stats.min;
      return { key, rows: rs, stats, spread, spreadPct: share(spread, stats.mean) };
    })
    .filter(g => g.stats.n >= minN)
    .sort((a, b) => b.spread - a.spread)
    .slice(0, top);
}

// ---- axes -------------------------------------------------------------------

/**
 * Range-bar axis: min..max padded 5% each side, five ticks on a 40 or 50
 * 백만원 step — whichever wastes less. Narrow ranges fall back to 5/10/20.
 */
export function rangeAxis(min, max) {
  if (min === null || max === null || !isFinite(min) || !isFinite(max)) return null;
  const pad = Math.max((max - min) * 0.05, max * 0.01, 0.5);
  const lo = Math.max(0, min - pad), hi = max + pad;
  const units = hi - lo >= 160 ? [40, 50] : [5, 10, 20];
  let best = null;
  for (const u of units) {
    const step = Math.max(u, Math.ceil((hi - lo) / 4 / u) * u);
    const start = Math.floor(lo / u) * u;
    const end = start + step * 4;
    if (end < hi) continue;
    if (!best || end - start < best.max - best.min) best = { min: start, max: end, step };
  }
  if (!best) {
    const u = units[units.length - 1];
    const step = Math.ceil((hi - Math.floor(lo / u) * u) / 4 / u) * u;
    const start = Math.floor(lo / u) * u;
    best = { min: start, max: start + step * 4, step };
  }
  best.ticks = [0, 1, 2, 3, 4].map(i => best.min + best.step * i);
  return best;
}

/** Symmetric scale for a diverging bar: the largest |value| rounded up onto `steps`, at least `floor`. */
export function divergeScale(values, { floor = 1, steps = [1, 2, 3, 5, 10, 15, 20, 30, 50, 100] } = {}) {
  const m = Math.max(0, ...values.filter(v => v !== null && isFinite(v)).map(Math.abs));
  const hit = steps.find(s => s >= m && s >= floor);
  return hit || Math.ceil(m / 10) * 10;
}

/** Count axis: max rounded up onto a 1/2/5 × 10^k step, five ticks from 0. */
export function countAxis(max) {
  if (!(max > 0)) return { max: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(x => x * p).find(s => s >= raw);
  return { max: step * 4, ticks: [0, 1, 2, 3, 4].map(i => step * i) };
}
