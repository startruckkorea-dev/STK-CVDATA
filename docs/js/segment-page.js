// One segment, one page — Tractor / Cargo (Rigid) / Dump (Tipper).
//
// The three pages differ only in which segment they read, so they share this
// module and pass their segment in. Everything here is KAIDA: the imported-CV
// registration aggregate the rest of the report is built on.
import { requireLogin } from "./auth.js";
import { loadTranslations, applyT, t, tdata } from "./i18n.js";
import { renderSidebar } from "./sidebar.js";
import { renderFilters, syncFilters, yearOptions, monthOptions } from "./filters.js";
import { loadManifest, loadKaidaPair } from "./data.js";
import { lineChart, stackedBar, comboBarLine, BRAND_TILE_COLORS, TOKEN } from "./charts.js";
import { MONTHS, MONTHS_KR, fmtNum, fmtPct, calcYoY, deltaSpan } from "./format.js";
import { getState, subscribe } from "./state.js";

const BRAND_ORDER = ["MB", "Volvo", "Scania", "MAN", "IVECO"];
// Management reads the maker's name; the ticker stays in the analysis pages.
const BRAND_LABEL = { MB: "Mercedes-Benz" };

let _years = [];
let _segment = "Tractor";

// ---- accessors --------------------------------------------------------------

function zeros() { const o = {}; for (const m of MONTHS) o[m] = 0; o.Total = 0; return o; }
const months = (row) => MONTHS.map(m => row[m] || 0);
const sumThrough = (vals, last) => vals.slice(0, last).reduce((a, b) => a + (b || 0), 0);

const segRow = (d) => (d && d.by_segment && d.by_segment[_segment]) || zeros();
const brandSegRow = (d, b) =>
  (d && d.by_brand_seg && d.by_brand_seg[b] && d.by_brand_seg[b][_segment]) || zeros();
const marketRow = (d) => (d && d.monthly_totals) || zeros();

/** One brand's cumulative (YTD) share of the segment, month by month — the
 *  same number the scorecard's SHARE column shows, traced across the year.
 *  Months the year has not reached yet come back null so the line stops. */
function somPath(d, brand) {
  const bm = months(brandSegRow(d, brand));
  const seg = months(segRow(d));
  const last = monthsWithData(seg);
  let num = 0, den = 0;
  return bm.map((v, i) => {
    num += v; den += seg[i];
    return i < last && den ? (num / den) * 100 : null;
  });
}

const signed = (v, digits = 1) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  const p = 10 ** digits;
  return `${v > 0 ? "+" : ""}${(Math.round(v * p) / p).toFixed(digits)}`;
};
const label = (b) => BRAND_LABEL[b] || b;
const monthsWithData = (vals) => vals.reduce((n, v, i) => (v ? i + 1 : n), 0);

/** pp move with the up / down mark the rest of the report uses. */
function ppSpan(v, suffix = "pp") {
  if (v === null || v === undefined || Number.isNaN(v)) return `<span class="pp flat">-</span>`;
  const cls = v > 0.05 ? "up" : v < -0.05 ? "down" : "flat";
  const mark = v > 0.05 ? "▲" : v < -0.05 ? "▼" : "·";
  return `<span class="pp ${cls}">${mark} ${Math.abs(Math.round(v * 10) / 10).toFixed(1)}${suffix}</span>`;
}

// ---- boot -------------------------------------------------------------------

export async function initSegmentPage({ segment }) {
  _segment = segment;
  if (!(await requireLogin())) return;
  await loadTranslations();
  renderSidebar(window.location.pathname);
  applyT();

  let manifest;
  try {
    manifest = await loadManifest();
  } catch (e) {
    return banner("error", e.message);
  }
  _years = manifest.kaida_years || [];
  if (!_years.length) return banner("warn", `${t("no_data")} (KAIDA)`);

  renderFilters(document.getElementById("filters"), [
    { key: "year", label: "filter_year", options: yearOptions(_years), default: _years[0] },
    { key: "month", label: "filter_month", options: monthOptions(), default: "YTD" },
    {
      key: "brand", label: "filter_brand", as: "tiles",
      options: [{ value: "ALL", label: t("filter_all") },
                ...BRAND_ORDER.map(b => ({ value: b, label: b }))],
      colors: BRAND_TILE_COLORS, default: "ALL",
    },
  ], render);

  document.addEventListener("langchange", render);
  subscribe(render);
  render();
}

/** Panels come and go between deploys, and a browser holding a cached copy of
 *  the page pairs the old HTML with the new module. Writing into an element
 *  that is not there would throw halfway through render() and leave every
 *  panel below it blank — skip it and draw the rest. */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function banner(kind, msg) {
  document.querySelector(".main").insertAdjacentHTML("afterbegin",
    `<div class="banner ${kind}">${msg}</div>`);
}

// ---- render -----------------------------------------------------------------

async function render() {
  const s = { month: "YTD", brand: "ALL", ...getState() };
  syncFilters();
  const year = parseInt(s.year, 10) || _years[0];

  let cur = null, prev = null;
  try {
    ({ cur, prev } = await loadKaidaPair(year));
  } catch (e) { console.error(e); }
  if (!cur) {
    const row = document.getElementById("kpi-row");
    if (row) row.innerHTML = `<div class="banner warn">${t("no_data")}</div>`;
    return;
  }

  const last = cur.last_data_month || 12;
  const monthIdx = Math.min(s.month === "YTD" ? last : parseInt(s.month, 10) || last, last);
  const brand = BRAND_ORDER.includes(s.brand) ? s.brand : "ALL";

  setText("page-sub", t("seg_page_sub"));
  setText("seg-scope", tdata(_segment, "segment"));

  const f = readFacts(cur, prev, monthIdx, brand);

  setText("title-monthly", t("seg_panel_monthly"));
  setText("title-hp-points", t("chart_hp_points"));
  setText("title-brand-table",
          `${t("seg_panel_brand_table")} (${tdata(_segment, "segment")})`);
  setText("title-insight", t("seg_insight"));
  setText("title-som", t("seg_panel_som", { name: label(f.somBrand) }));

  renderKpis(f, monthIdx);
  renderBrandTable(f, year, f.prevYear, monthIdx);
  renderInsights(f);
  renderHpPoints(cur, monthIdx);
  renderSom(f, year, f.prevYear);
  renderMonthly(f, year, f.prevYear);
  applyT(document.querySelector(".main"));
}

/**
 * Every figure the panels share, over one window.
 *
 * `brand` is what the page is reading — the whole segment, or one brand inside
 * it. Share is measured against whatever contains that scope: the segment sits
 * in the market, a brand sits in the segment.
 */
function readFacts(cur, prev, monthIdx, brand) {
  const hasPrev = !!prev;
  const scopeMonths = (d) => (brand === "ALL" ? months(segRow(d)) : months(brandSegRow(d, brand)));
  const baseMonths = (d) => (brand === "ALL" ? months(marketRow(d)) : months(segRow(d)));

  const curScope = scopeMonths(cur);
  const prevScope = hasPrev ? scopeMonths(prev) : MONTHS.map(() => 0);
  const curBase = baseMonths(cur);
  const prevBase = hasPrev ? baseMonths(prev) : MONTHS.map(() => 0);

  const ytd = sumThrough(curScope, monthIdx);
  const ytdPrev = sumThrough(prevScope, monthIdx);
  const baseYtd = sumThrough(curBase, monthIdx);
  const baseYtdPrev = sumThrough(prevBase, monthIdx);

  const mth = curScope[monthIdx - 1] || 0;
  const mthPrevMonth = monthIdx > 1 ? curScope[monthIdx - 2] || 0 : null;
  const baseMth = curBase[monthIdx - 1] || 0;
  const basePrevMonth = monthIdx > 1 ? curBase[monthIdx - 2] || 0 : null;

  const share = baseYtd ? (ytd / baseYtd) * 100 : 0;
  const sharePrev = baseYtdPrev ? (ytdPrev / baseYtdPrev) * 100 : null;
  const mthShare = baseMth ? (mth / baseMth) * 100 : 0;
  const mthSharePrev = basePrevMonth ? ((mthPrevMonth || 0) / basePrevMonth) * 100 : null;

  // The segment's own weight in the whole imported market — the same number in
  // every brand view, so the tile keeps its meaning when a brand is picked.
  const segYtd = sumThrough(months(segRow(cur)), monthIdx);
  const marketYtd = sumThrough(months(marketRow(cur)), monthIdx);

  const segTotal = segYtd;
  const segTotalPrev = hasPrev ? sumThrough(months(segRow(prev)), monthIdx) : 0;
  const brands = BRAND_ORDER.map(b => {
    const bm = months(brandSegRow(cur, b));
    const cy = sumThrough(bm, monthIdx);
    const py = hasPrev ? sumThrough(months(brandSegRow(prev, b)), monthIdx) : 0;
    const sh = segTotal ? (cy / segTotal) * 100 : 0;
    const shPrev = segTotalPrev ? (py / segTotalPrev) * 100 : null;
    const mo = bm[monthIdx - 1] || 0;
    const moPrev = monthIdx > 1 ? bm[monthIdx - 2] || 0 : null;
    return {
      brand: b, label: label(b), cy, py, yoy: hasPrev ? calcYoY(cy, py) : null,
      share: sh, sharePrev: shPrev, pp: shPrev === null ? null : sh - shPrev,
      delta: cy - py, month: mo, mom: moPrev === null ? null : calcYoY(mo, moPrev),
    };
  }).sort((a, b) => b.cy - a.cy);

  // The share chart follows the brand filter, and reads MB while it is off:
  // the question the page answers first is where MB sits in this segment.
  const somBrand = brand === "ALL" ? "MB" : brand;

  return {
    hasPrev, brand, somBrand, prevYear: prev ? prev.year : null,
    curSom: somPath(cur, somBrand),
    prevSom: hasPrev ? somPath(prev, somBrand) : null,
    curScope, prevScope,
    ytd, ytdPrev, yoy: hasPrev ? calcYoY(ytd, ytdPrev) : null,
    share, sharePrev, pp: sharePrev === null ? null : share - sharePrev,
    mth, mom: mthPrevMonth === null ? null : calcYoY(mth, mthPrevMonth),
    mthShare, mthSharePp: mthSharePrev === null ? null : mthShare - mthSharePrev,
    segWeight: marketYtd ? (segYtd / marketYtd) * 100 : 0,
    segTotal, segTotalPrev, brands,
  };
}

// ---- KPI tiles --------------------------------------------------------------

function kpiTile(title, value, unit, deltaHtml, sub) {
  return `
    <div class="kpi-card">
      <div class="title">${title}</div>
      <div class="value">${value}${unit ? `<small>${unit}</small>` : ""}</div>
      <div class="delta">${deltaHtml}${sub ? ` <small>${sub}</small>` : ""}</div>
    </div>`;
}

/** Donut ring for the market-weight tile — one arc, no Plotly instance. */
function ring(pct) {
  const r = 24, c = 2 * Math.PI * r;
  const on = Math.max(0, Math.min(100, pct)) / 100 * c;
  return `
    <svg class="kpi-ring" width="58" height="58" viewBox="0 0 58 58" aria-hidden="true">
      <circle cx="29" cy="29" r="${r}" fill="none" stroke="#e6ecf2" stroke-width="8" />
      <circle cx="29" cy="29" r="${r}" fill="none" stroke="${TOKEN.deepTeal}" stroke-width="8"
              stroke-dasharray="${on.toFixed(1)} ${(c - on).toFixed(1)}"
              transform="rotate(-90 29 29)" />
    </svg>`;
}

function renderKpis(f, monthIdx) {
  const el = document.getElementById("kpi-row");
  if (!el) return;
  const mo = `${monthIdx}${t("month_suffix")}`;
  // With no brand picked the scope is the whole segment, so its YTD share is
  // the segment's weight in the market — the number the last tile already
  // carries. The tile only says something once a brand narrows the scope.
  const byBrand = f.brand !== "ALL";
  el.innerHTML = [
    kpiTile(t("seg_kpi_ytd"), fmtNum(f.ytd), " units",
            f.hasPrev ? deltaSpan(f.yoy) : "-", "YoY"),
    kpiTile(t("seg_kpi_ytd_share"), byBrand ? fmtPct(f.share) : "-", "",
            byBrand && f.pp !== null ? ppSpan(f.pp) : "-", byBrand ? "YoY" : ""),
    kpiTile(`${t("seg_kpi_month")} (${mo})`, fmtNum(f.mth), " units",
            f.mom === null ? "-" : deltaSpan(f.mom), "MoM"),
    kpiTile(`${t("seg_kpi_month_share")} (${mo})`, fmtPct(f.mthShare), "",
            f.mthSharePp === null ? "-" : ppSpan(f.mthSharePp), "MoM"),
    `<div class="kpi-card weight">
       <div class="title">${t("seg_kpi_market_weight")}</div>
       <div class="value">${fmtPct(f.segWeight)}</div>
       <div class="delta"><small>${t("seg_kpi_market_weight_sub")}</small></div>
       ${ring(f.segWeight)}
     </div>`,
  ].join("");
}

// ---- charts -----------------------------------------------------------------

/** YTD share of the segment, this year against last — the glide path behind
 *  the scorecard's SHARE / Δ SHARE columns. */
function renderSom(f, year, prevYear) {
  const el = document.getElementById("chart-som");
  if (!el) return;
  lineChart(el, {
    x: MONTHS_KR,
    valueKind: "pct1",
    yLabel: "%",
    height: 300,
    labelSize: 12,
    series: [
      { name: `${year} ${f.somBrand} YTD SoM`, values: f.curSom, color: TOKEN.deepTeal },
      ...(f.hasPrev
        ? [{ name: `${prevYear} ${f.somBrand} YTD SoM`, values: f.prevSom, color: TOKEN.mint }]
        : []),
    ],
  });
}

function renderMonthly(f, year, prevYear) {
  const el = document.getElementById("chart-monthly");
  if (!el) return;
  comboBarLine(el, {
    x: MONTHS_KR,
    bars: [
      { name: String(year), values: f.curScope, color: TOKEN.teal },
      ...(f.hasPrev ? [{ name: String(prevYear), values: f.prevScope, color: "#d8dee4" }] : []),
    ],
    // Volume only: the share line moved to its own panel next door.
    lines: [],
    height: 300,
    yLabel: "units",
    labelSize: 12,
  });
}

// ---- power rating (tractor only) --------------------------------------------

/** The exact ratings behind the segment, split by brand — this is where the
 *  head-to-head model positioning shows (e.g. 500 vs 510 vs 540). Each bar
 *  carries the rating's share of the segment above it. */
function renderHpPoints(cur, monthIdx) {
  const row = document.getElementById("hp-row");
  if (!row) return;
  // Only the tractor sheets carry a horsepower rating — rigids and tippers vary
  // by body, not by engine, so the panel stays hidden there.
  const pts = (_segment === "Tractor" ? cur.tractor_hp_points || [] : [])
    .map(p => ({
      hp: p.hp,
      total: sumThrough(months(p), monthIdx),
      byBrand: Object.fromEntries(BRAND_ORDER.map(b =>
        [b, p.by_brand && p.by_brand[b] ? sumThrough(months(p.by_brand[b]), monthIdx) : 0])),
    }))
    .filter(p => p.total > 0);
  row.hidden = !pts.length;
  if (!pts.length) return;

  const total = pts.reduce((a, p) => a + p.total, 0);
  const max = Math.max(1, ...pts.map(p => p.total));
  const categories = pts.map(p => `${p.hp}hp`);

  stackedBar(document.getElementById("hp-points"), {
    categories,
    series: BRAND_ORDER
      .filter(b => pts.some(p => p.byBrand[b] > 0))
      .map(b => ({ name: label(b), color: BRAND_TILE_COLORS[b],
                   values: pts.map(p => p.byBrand[b]) })),
    // Headroom for the share caption sitting on top of each stack.
    yaxis: { range: [0, max * 1.2] },
    annotations: pts.map((p, i) => ({
      x: categories[i], y: p.total, yshift: 10,
      text: fmtPct(total ? (p.total / total) * 100 : 0),
      showarrow: false, xanchor: "center", yanchor: "bottom",
      font: { size: 13, color: TOKEN.deepTeal },
    })),
    height: 360,
    labelSize: 12,
  });
}

// ---- brand table ------------------------------------------------------------

function renderBrandTable(f, year, prevYear, monthIdx) {
  const el = document.getElementById("brand-table");
  if (!el) return;
  const py = f.hasPrev ? prevYear : "-";
  el.innerHTML = `
    <div class="table-scroll table-fit">
      <table class="data compact">
        <thead>
          <tr>
            <th class="rank"></th>
            <th class="label" data-t="filter_brand">브랜드</th>
            <th>YTD ${year}</th>
            <th>YTD ${py}</th>
            <th>YoY</th>
            <th>SHARE ${year}</th>
            <th>SHARE ${py}</th>
            <th>Δ SHARE</th>
            <th>${monthIdx}${t("month_suffix")}</th>
            <th>MoM</th>
          </tr>
        </thead>
        <tbody>
          ${f.brands.map((r, i) => `
            <tr class="${r.brand === "MB" ? "highlight" : ""}">
              <td class="rank">${i + 1}</td>
              <td class="label">${r.label}</td>
              <td class="num">${fmtNum(r.cy)}</td>
              <td class="num">${f.hasPrev ? fmtNum(r.py) : "-"}</td>
              <td class="num">${r.yoy === null ? "-" : deltaSpan(r.yoy)}</td>
              <td class="num">${fmtPct(r.share)}</td>
              <td class="num">${r.sharePrev === null ? "-" : fmtPct(r.sharePrev)}</td>
              <td class="num">${r.pp === null ? "-" : ppSpan(r.pp)}</td>
              <td class="num">${fmtNum(r.month)}</td>
              <td class="num">${r.mom === null ? "-" : deltaSpan(r.mom)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

// ---- insights ---------------------------------------------------------------

function insightCard(kind, title, body) {
  return `
    <div class="insight">
      <span class="dot ${kind}"></span>
      <div><h4>${title}</h4><p>${body}</p></div>
    </div>`;
}

function renderInsights(f) {
  const el = document.getElementById("insight-list");
  if (!el) return;
  if (!f.hasPrev) { el.innerHTML = `<p class="ql-sub">${t("no_data")}</p>`; return; }

  const out = [];
  const byDelta = [...f.brands].sort((a, b) => b.delta - a.delta);
  const up = byDelta[0], down = byDelta[byDelta.length - 1];

  if (up && up.delta > 0) {
    out.push(insightCard("good", t("seg_insight_growth"), t("seg_insight_growth_body", {
      name: up.label, yoy: `${signed(up.yoy)}%`, delta: signed(up.delta, 0),
    })));
  }
  if (down && down.delta < 0) {
    out.push(insightCard("bad", t("seg_insight_warn"), t("seg_insight_warn_body", {
      name: down.label, yoy: `${signed(down.yoy)}%`, delta: signed(down.delta, 0),
    })));
  }
  const rank = f.brands.findIndex(b => b.brand === "MB");
  if (rank >= 0) {
    const mb = f.brands[rank];
    out.push(insightCard("warn", t("seg_insight_implication"), t("seg_insight_implication_body", {
      seg: tdata(_segment, "segment"),
      share: fmtPct(mb.share),
      rank: String(rank + 1),
      pp: mb.pp === null ? "-" : `${signed(mb.pp)}pp`,
    })));
  }
  el.innerHTML = out.join("");
}
