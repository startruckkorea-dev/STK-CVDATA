// CV DATA 특장·가격 — components.
//
// Each returns an HTML string from data and a scale handed in; none of them
// computes a figure. Laid out after the executive overview (KPI tiles, the
// ranking table, the share bars) but sized to the 특장·가격 spec, under the
// .cvx class so nothing here can restyle a page that already exists.

import { fmtNum } from "../format.js";
import {
  COLOR, HEAT_STEPS, CAT_CHIP, CAT_CHIP_DEFAULT, catColor,
} from "./schema.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const isNum = (v) => v !== null && v !== undefined && !Number.isNaN(v) && isFinite(v);

export const na = () => `<span class="cvx-na">–</span>`;
export const num = (v) => (isNum(v) ? fmtNum(Math.round(v)) : na());
export const dec1 = (v) => (isNum(v) ? (Math.round(v * 10) / 10).toFixed(1) : null);
export const pct = (v) => (isNum(v) ? `${dec1(v)}%` : na());
/** 백만원: averages and medians to one place, minima and maxima whole. */
export const mw = (v, digits = 1) =>
  (isNum(v) ? (digits ? Number(dec1(v)).toLocaleString("en-US", { minimumFractionDigits: 1 }) : fmtNum(Math.round(v))) : na());

/**
 * The one place a change gets its sign and colour: '▲ +1.2' green,
 * '▼ -0.4' red, '0.0' grey, '–' when there is nothing to compare against.
 */
export function ppDelta(v, unit = "pp") {
  if (!isNum(v)) return `<span class="cvx-delta na">–</span>`;
  const r = Number(dec1(v));
  if (r === 0) return `<span class="cvx-delta zero">0.0${unit}</span>`;
  return r > 0
    ? `<span class="cvx-delta up">▲ +${dec1(v)}${unit}</span>`
    : `<span class="cvx-delta down">▼ ${dec1(v)}${unit}</span>`;
}

// ---- sparkline --------------------------------------------------------------

let _seq = 0;

/** 110×44. `bars`: past months light, the last (or `highlight`) month dark. */
export function sparkline(values, { kind = "line", color = COLOR.navy, highlight = null } = {}) {
  const w = 110, h = 44;
  const known = values.map((v, i) => [v, i]).filter(([v]) => isNum(v));
  if (!known.length || (kind === "line" && known.length < 2)) return `<svg class="cvx-spark" width="${w}" height="${h}"></svg>`;
  if (kind === "bars") {
    const max = Math.max(...known.map(([v]) => v), 1);
    const step = w / values.length;
    const bw = Math.max(2, step - 2);
    const hi = highlight ?? known[known.length - 1][1];
    const bars = known.map(([v, i]) => {
      const bh = Math.max(1.5, (v / max) * (h - 4));
      return `<rect x="${(i * step + (step - bw) / 2).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${bw.toFixed(1)}"
        height="${bh.toFixed(1)}" rx="1" fill="${i === hi ? color : "#a9bde6"}"/>`;
    }).join("");
    return `<svg class="cvx-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${bars}</svg>`;
  }
  const vs = known.map(([v]) => v);
  const min = Math.min(...vs), max = Math.max(...vs), span = max - min || 1;
  const n = values.length;
  const pts = known.map(([v, i]) => [2 + (i / Math.max(1, n - 1)) * (w - 6), h - 4 - ((v - min) / span) * (h - 10)]);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  const fill = color === COLOR.navy ? "rgba(30,58,138,.08)" : `${color}22`;
  const id = `cvxs${++_seq}`;
  return `<svg class="cvx-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true" data-id="${id}">
    <polygon fill="${fill}" points="${pts[0][0].toFixed(1)},${h} ${line} ${lx.toFixed(1)},${h}"/>
    <polyline fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" points="${line}"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3" fill="${color}"/>
  </svg>`;
}

/** Small bars for a KPI tile: one per item, in the item's colour. */
export function miniBars(items) {
  const max = Math.max(1, ...items.map(i => i.n || 0));
  return `<div class="cvx-minibars">${items.map(i => `
    <span title="${esc(i.label)} ${fmtNum(i.n || 0)}" style="height:${Math.max(2, ((i.n || 0) / max) * 40)}px;background:${i.color}"></span>`).join("")}
  </div>`;
}

// ---- KPI --------------------------------------------------------------------

export function kpiCard({ label, value, unit = "", sub = "", delta = "", side = "" }) {
  // Label and figure take the full width; the change and the spark share the
  // row under them. Side by side, a 110px spark left a 240px tile too little
  // room for '15,269 대'.
  return `<div class="cvx-kpi">
    <div class="cvx-kpi-label">${label}</div>
    <div class="cvx-kpi-value">${value}${unit ? `<small>${unit}</small>` : ""}</div>
    <div class="cvx-kpi-foot">
      <div class="cvx-kpi-text">
        ${sub ? `<div class="cvx-kpi-sub">${sub}</div>` : ""}
        ${delta ? `<div class="cvx-kpi-delta">${delta}</div>` : ""}
      </div>
      <div class="cvx-kpi-side">${side}</div>
    </div>
  </div>`;
}

// ---- header -----------------------------------------------------------------

export function pageHeader({ crumb, title, sub, period, vs }) {
  return `<div class="cvx-head">
    <div>
      <div class="cvx-crumb">${crumb}</div>
      <h1 class="cvx-title">${title}</h1>
      <div class="cvx-sub">${sub}</div>
    </div>
    <div class="cvx-period"><div class="now">${period}</div><div class="vs">${vs}</div></div>
  </div>`;
}

export function card({ title, aside = "", note = "", body, cls = "" }) {
  return `<section class="cvx-card ${cls}">
    <div class="cvx-card-head">
      <h2>${title}${aside ? ` <span class="cvx-card-aside">${aside}</span>` : ""}</h2>
      ${note ? `<div class="cvx-card-note">${note}</div>` : ""}
    </div>
    ${body}
  </section>`;
}

export const footnote = (s) => `<div class="cvx-foot">${s}</div>`;
export const empty = (s) => `<div class="cvx-empty">${s}</div>`;

// ---- chips ------------------------------------------------------------------

export function catChip(cat, sub = null) {
  if (cat === null || cat === undefined) return na();
  const [bg, fg] = CAT_CHIP[cat] || CAT_CHIP_DEFAULT;
  return `<span class="cvx-chip" style="background:${bg};color:${fg}">${esc(cat)}${sub ? ` · ${esc(sub)}` : ""}</span>`;
}

export const greyChip = (s) => `<span class="cvx-chip grey">${esc(s)}</span>`;

export function rankBadge(rank, fmt = String) {
  return rank <= 3 ? `<span class="cvx-rank-badge">${fmt(rank)}</span>` : `<span class="cvx-rank">${rank}</span>`;
}

// ---- bars -------------------------------------------------------------------

/** A share inside a table cell: track, fill to value / max, then the text. */
export function inlineBar(value, max, { width = 120, color = COLOR.bar, text = "" } = {}) {
  const f = isNum(value) && max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return `<span class="cvx-inline">
    <span class="cvx-track" style="width:${width}px"><span style="width:${(f * 100).toFixed(1)}%;background:${color}"></span></span>
    <span class="cvx-inline-text">${text}</span>
  </span>`;
}

/**
 * Composition bar, 50px tall. A segment under 8% drops its label (the legend
 * under it still names it). items: [{ label, n, color, fg }]
 */
export function segmentBar(items, total) {
  if (!total) return "";
  const segs = items.filter(i => i.n > 0).map(i => {
    const p = (i.n / total) * 100;
    const fg = i.fg || "#fff";
    const lbl = p >= 8 ? `<b>${esc(i.label)} ${fmtNum(i.n)}</b><span>${dec1(p)}%</span>` : "";
    return `<div class="cvx-seg" style="flex:${i.n} 0 0;background:${i.color};color:${fg}"
      title="${esc(i.label)} ${fmtNum(i.n)} (${dec1(p)}%)">${lbl}</div>`;
  }).join("");
  return `<div class="cvx-segbar">${segs}</div>`;
}

export function legend(items, total = null, prefix = "") {
  return `<div class="cvx-legend">${prefix ? `<span class="cvx-legend-prefix">${prefix}</span>` : ""}${items.map(i => `
    <span class="${i.n === 0 ? "zero" : ""}"><i style="background:${i.color}"></i>${esc(i.label)}${
      i.n !== undefined && i.n !== null ? ` ${fmtNum(i.n)}${total ? ` (${dec1((i.n / total) * 100)}%)` : ""}` : ""}</span>`).join("")}
  </div>`;
}

/**
 * 100% bar. `labeled` (24px) writes 'name xx%' on segments of 15% or more.
 * segs: [{ label, n, color, fg }]
 */
export function stackedBar100(segs, { height = 16, labeled = false, width = null } = {}) {
  const total = segs.reduce((s, x) => s + (x.n || 0), 0);
  if (!total) return `<div class="cvx-stack empty" style="height:${height}px${width ? `;width:${width}px` : ""}"></div>`;
  const parts = segs.filter(s => s.n > 0).map(s => {
    const p = (s.n / total) * 100;
    // Name and share from 30%, the share alone from 15% — a narrow segment
    // clipped its name to a stub.
    const txt = !labeled || p < 15 ? "" : p >= 30 ? `${esc(s.label)} ${dec1(p)}%` : `${dec1(p)}%`;
    return `<span style="flex:${s.n} 0 0;background:${s.color};color:${s.fg || "#fff"}"
      title="${esc(s.label)} ${fmtNum(s.n)} (${dec1(p)}%)">${txt}</span>`;
  }).join("");
  return `<div class="cvx-stack${labeled ? " labeled" : ""}" style="height:${height}px${width ? `;width:${width}px` : ""}">${parts}</div>`;
}

/**
 * Bars either side of zero: losses left in red, gains right in green; label
 * on the left, value on the right, ticks at ±scale and ±scale/2.
 * rows: [{ label, value, text, strong }]
 */
export function divergingBar(rows, { scale, unit = "pp" }) {
  if (!rows.length) return "";
  const tick = (v) => `${v > 0 ? "+" : ""}${v}${unit}`;
  // One grid for every row (the rows are display: contents), so the label,
  // plot and value columns line up down the panel.
  const body = rows.map(r => {
    const v = isNum(r.value) ? r.value : 0;
    const w = Math.min(50, (Math.abs(v) / scale) * 50);
    const bar = isNum(r.value)
      ? `<span class="cvx-div-bar ${v >= 0 ? "pos" : "neg"}" style="${v >= 0 ? "left:50%" : `left:${50 - w}%`};width:${w}%"></span>`
      : "";
    return `<div class="cvx-div-row">
      <div class="cvx-div-label${r.strong ? " strong" : ""}" title="${esc(r.label)}">${esc(r.label)}</div>
      <div class="cvx-div-plot"><span class="cvx-div-zero"></span>${bar}</div>
      <div class="cvx-div-val ${isNum(r.value) ? (v > 0 ? "up" : v < 0 ? "down" : "") : "na"}">${r.text ?? (isNum(r.value) ? `${v > 0 ? "+" : ""}${dec1(v)}${unit}` : "–")}</div>
    </div>`;
  }).join("");
  return `<div class="cvx-div">${body}
    <div class="cvx-div-row axis"><div></div>
      <div class="cvx-div-plot ticks"><span>${tick(-scale)}</span><span>0</span><span>${tick(scale)}</span></div><div></div>
    </div></div>`;
}

/**
 * Min–max range on an axis: blue bar, white median tick, hollow mean circle,
 * and the comparison period's range as a thin grey bar under it.
 */
export function rangeBar(cur, cmp, axis, { color = COLOR.bar, compact = false } = {}) {
  if (!axis) return "";
  const x = (v) => `${(((v - axis.min) / (axis.max - axis.min)) * 100).toFixed(2)}%`;
  const span = (s) => `left:${x(s.min)};width:calc(${x(s.max)} - ${x(s.min)})`;
  const main = cur ? `
    <span class="cvx-range-main" style="${span(cur)};background:${color}"></span>
    <span class="cvx-range-med" style="left:${x(cur.median)}"></span>
    ${isNum(cur.mean) ? `<span class="cvx-range-mean" style="left:${x(cur.mean)}"></span>` : ""}` : "";
  const sub = cmp ? `
    <span class="cvx-range-cmp" style="${span(cmp)}"></span>
    <span class="cvx-range-cmp-med" style="left:${x(cmp.median)}"></span>` : "";
  const tip = [cur && `${mw(cur.min, 0)}–${mw(cur.max, 0)}`, cmp && `(${mw(cmp.min, 0)}–${mw(cmp.max, 0)})`].filter(Boolean).join(" ");
  return `<div class="cvx-range${cmp ? " with-cmp" : ""}${compact ? " compact" : ""}" title="${tip}">${main}${sub}</div>`;
}

/** Five ticks under a range column, at the same positions as the bars. */
export function rangeTicks(axis, { compact = false } = {}) {
  if (!axis) return "";
  return `<div class="cvx-range-ticks${compact ? " compact" : ""}">${axis.ticks.map(t =>
    `<span style="left:${(((t - axis.min) / (axis.max - axis.min)) * 100).toFixed(2)}%">${fmtNum(t)}</span>`).join("")}</div>`;
}

// ---- heat table -------------------------------------------------------------

export function heatStyle(n) {
  const s = HEAT_STEPS.find(h => n >= h.min);
  return s ? `background:${s.bg};${s.bold ? "font-weight:700;" : ""}` : "";
}

/**
 * Cross-tab with each cell shaded by its count. A zero cell reads '–'.
 * cols: [{ key, label, hi, link }] — `hi` tints the header (벤츠, 8X4), `link`
 * makes the header an anchor. groups: [{ label, span, cls }] above the header.
 * rows: [{ key, label, muted }]; p: a pivot from agg.js.
 */
export function heatTable({ corner, groups = null, cols, rows, p, totalLabel, colTotalLabel }) {
  const head = groups ? `<tr class="cvx-heat-groups"><th></th>${groups.map(g =>
    `<th colspan="${g.span}" class="${g.cls || ""}">${g.label}</th>`).join("")}<th></th></tr>` : "";
  const th = cols.map(c => {
    const label = c.link ? `<a href="${c.link}">${esc(c.label)}</a>` : esc(c.label);
    return `<th class="num${c.hi ? " hi" : ""}">${label}</th>`;
  }).join("");
  const body = rows.map(r => `<tr>
      <td class="lbl${r.muted ? " muted" : ""}">${esc(r.label)}</td>
      ${cols.map(c => {
        const n = p.cell(r.key, c.key);
        return `<td class="num${c.hi ? " hi" : ""}" style="${n ? heatStyle(n) : ""}">${n ? fmtNum(n) : na()}</td>`;
      }).join("")}
      <td class="num tot">${p.rowTotal(r.key) ? fmtNum(p.rowTotal(r.key)) : na()}</td>
    </tr>`).join("");
  const foot = `<tr class="sum"><td class="lbl">${totalLabel}</td>${cols.map(c =>
    `<td class="num${c.hi ? " hi" : ""}">${p.colTotal(c.key) ? fmtNum(p.colTotal(c.key)) : na()}</td>`).join("")}
    <td class="num tot">${fmtNum(p.total)}</td></tr>`;
  return `<div class="cvx-scroll"><table class="cvx-table cvx-heat">
    <thead>${head}<tr><th class="lbl">${corner}</th>${th}<th class="num">${colTotalLabel}</th></tr></thead>
    <tbody>${body}${foot}</tbody></table></div>`;
}

// ---- sortable table ---------------------------------------------------------

/**
 * Table whose header sorts the body; pinned rows (기타, 합계) stay at the
 * bottom. columns: [{ key, label, cls, sort: row => value, render: row => html }]
 * rows: [{ ..., hi }]. Sorting is view state only and stays out of the URL.
 */
export function sortableTable(el, { columns, rows, pinned = [], sortKey = null, desc = true }) {
  let key = sortKey, dir = desc;
  const draw = () => {
    const col = columns.find(c => c.key === key);
    const sorted = col && col.sort ? [...rows].sort((a, b) => {
      const va = col.sort(a), vb = col.sort(b);
      const c = typeof va === "string" ? va.localeCompare(vb, "ko") : (va ?? -Infinity) - (vb ?? -Infinity);
      return dir ? -c : c;
    }) : rows;
    const tr = (r, cls = "") => `<tr class="${[r.hi ? "hi" : "", cls].join(" ")}">${columns.map(c =>
      `<td class="${c.cls || ""}">${c.render(r)}</td>`).join("")}</tr>`;
    el.innerHTML = `<div class="cvx-scroll"><table class="cvx-table">
      <thead><tr>${columns.map(c => `<th class="${c.cls || ""}${c.sort ? " sortable" : ""}" data-key="${c.key}">${c.label}${
        c.key === key ? (dir ? " ▼" : " ▲") : ""}</th>`).join("")}</tr></thead>
      <tbody>${sorted.map(r => tr(r)).join("")}${pinned.map(r => tr(r, r.cls || "")).join("")}</tbody>
    </table></div>`;
    el.querySelectorAll("th.sortable").forEach(th => th.addEventListener("click", () => {
      if (key === th.dataset.key) dir = !dir; else { key = th.dataset.key; dir = true; }
      draw();
    }));
  };
  draw();
}

/** Categories as legend / bar items in their colours. */
export const catItems = (cats, countFn) => cats.map(c => ({
  key: c, label: c, n: countFn(c), color: catColor(c), fg: c === "탑차" ? "#111827" : (c === "덤프" || c === "전문수송류" ? "#111827" : "#fff"),
}));
