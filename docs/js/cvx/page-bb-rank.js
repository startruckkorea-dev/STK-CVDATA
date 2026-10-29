// ① 특장업체 순위 — who bodies the most trucks, and how much of it is
// imported and Mercedes-Benz.

import { t } from "../i18n.js";
import { fmtNum } from "../format.js";
import { trendLine } from "../charts.js";
import {
  periodOf, filterRows, catOrder, axleOrder, axleKeys, brandOrder, monthly, monthlyShare,
  movingAvg3, share, ppDiff, yoy, bbRanking, divergeScale,
} from "./agg.js";
import { MB, TOP_N_BB, MB_HIGHLIGHT_MIN, TOP_N_MIX, COLOR, brandColor } from "./schema.js";
import {
  esc, na, pct, dec1, ppDelta, sparkline, kpiCard, pageHeader, card, footnote, empty,
  catChip, greyChip, rankBadge, inlineBar, segmentBar, legend, stackedBar100, divergingBar,
  sortableTable, catItems,
} from "./ui.js";
import {
  bootPage, rowsOf, filterBar, yearField, monthField, oemField, axleModeField,
  periodText, baseState, linkTo,
} from "./page.js";

bootPage(async ({ years, state, set, stale }) => {
  const s = baseState(state, years);
  const cur = await rowsOf(s.year, years);
  const prev = await rowsOf(s.year - 1, years);
  if (stale()) return;

  const bodied = filterRows(cur.rows, { bodied: true });
  const cats = catOrder(bodied);
  const axleList = axleKeys(axleOrder(bodied), s.axleMode);
  const period = periodOf(s.month, cur.lastMonth);
  const pt = periodText(s.year, period);

  // One filter object for every figure on the page, so the tiles, the table
  // and the panels always read the same slice.
  const scope = { oem: s.oem, cat: s.cat, bodied: true };
  const win = { ...scope, from: period.from, to: period.to };
  const pop = filterRows(cur.rows, win);
  const prevPop = prev ? filterRows(prev.rows, win) : null;
  const yearRows = filterRows(cur.rows, scope);
  const prevYearRows = prev ? filterRows(prev.rows, scope) : null;

  document.getElementById("head").innerHTML = pageHeader({
    crumb: `CV DATA · ${t("cvx_bb_analysis")}`, title: t("nav_cvx_bb_rank"), sub: t("cvx_bb_rank_sub"),
    period: pt.now, vs: prev ? pt.vs : t("cvx_no_prev"),
  });

  filterBar(document.getElementById("filters"), [
    yearField(String(s.year), years),
    monthField(s.month, cur.lastMonth),
    oemField(s.oem),
    { key: "cat", label: t("cvx_cat"), kind: "select", value: s.cat,
      options: [{ value: "all", label: t("filter_all") }, ...cats.map(c => ({ value: c, label: c }))] },
    axleModeField(s.axleMode),
  ], set);

  // ---- KPI ------------------------------------------------------------------
  const n = pop.length;
  const imp = pop.filter(r => r.imp).length;
  const mb = pop.filter(r => r.brand === MB).length;
  const pShare = (rs, fn) => (rs && rs.length ? share(rs.filter(fn).length, rs.length) : null);
  const series = monthly(yearRows, cur.lastMonth);
  const selN = series[period.sel - 1] || 0;
  const prevSel = prevYearRows ? prevYearRows.filter(r => r.m === period.sel).length : null;
  const impSeries = monthlyShare(monthly(yearRows, cur.lastMonth, r => r.imp), series);
  const mbSeries = monthlyShare(monthly(yearRows, cur.lastMonth, r => r.brand === MB), series);
  const unit = t("cvx_units");
  const vsLY = (d) => `${d} <span class="cvx-small">${t("cvx_vs_ly")}</span>`;

  document.getElementById("kpis").innerHTML = [
    kpiCard({
      label: `${t("cvx_kpi_bb_reg")} (${period.mode === "ytd" ? "YTD" : pt.short})`,
      value: fmtNum(n), unit,
      delta: vsLY(ppDelta(prevPop ? yoy(n, prevPop.length) : null, "%")),
      side: sparkline(series),
    }),
    kpiCard({
      label: `${t("kpi_month")} (${s.year}.${String(period.sel).padStart(2, "0")})`,
      value: fmtNum(selN), unit,
      delta: vsLY(ppDelta(prevSel !== null ? yoy(selN, prevSel) : null, "%")),
      side: sparkline(series, { kind: "bars", highlight: period.sel - 1 }),
    }),
    kpiCard({
      label: t("cvx_kpi_import_share"),
      value: n ? dec1(share(imp, n)) : "–", unit: n ? "%" : "",
      sub: `${fmtNum(imp)}${unit}`,
      delta: vsLY(ppDelta(ppDiff(share(imp, n), pShare(prevPop, r => r.imp)))),
      side: sparkline(impSeries, { color: COLOR.amber }),
    }),
    kpiCard({
      label: t("cvx_kpi_mb_bb_share"),
      value: n ? dec1(share(mb, n)) : "–", unit: n ? "%" : "",
      sub: `${fmtNum(mb)}${unit} · ${t("cvx_in_import")} ${imp ? pct(share(mb, imp)) : "–"}`,
      delta: vsLY(ppDelta(ppDiff(share(mb, n), pShare(prevPop, r => r.brand === MB)))),
      side: sparkline(mbSeries),
    }),
  ].join("");

  // ---- main card ------------------------------------------------------------
  const rk = n ? bbRanking(pop, prevPop, { topN: TOP_N_BB, MB, cats, axleKeysList: axleList, axleMode: s.axleMode }) : null;
  const mainEl = document.getElementById("main-card");
  const title = `${t("cvx_bb_rank_title")} (${period.mode === "ytd" ? "YTD" : pt.short})`;
  if (!n) {
    mainEl.innerHTML = card({ title, body: empty(t("cvx_empty")) });
  } else {
    const catMix = catItems(cats, c => pop.filter(r => r.cat === c).length);
    const maxShare = rk.top.length ? rk.top[0].share : 1;
    const maxImp = Math.max(1e-9, ...rk.top.map(l => l.impShare || 0));
    const link = (bb) => linkTo("bb-detail.html", { year: s.year, month: s.month, oem: s.oem, cat: s.cat, axleMode: s.axleMode, bb });
    const mainOf = (m, tot) => (m ? `${esc(m.key)} ${pct(share(m.n, tot))}` : na());

    mainEl.innerHTML = card({
      title,
      aside: `${pt.short} · ${fmtNum(n)}${unit} · ${t("cvx_active_bb", { n: rk.active })}`,
      note: t("cvx_note_mb_shade", { n: MB_HIGHLIGHT_MIN }),
      body: `${segmentBar(catMix, n)}${legend(catMix, n)}<div id="rank-table"></div>`,
    });

    const lines = rk.top.map(l => ({ ...l, hi: l.mb >= MB_HIGHLIGHT_MIN }));
    const otherRow = rk.other && {
      ...rk.other, cls: "other", label: t("cvx_other_bb", { n: rk.other.count }),
    };
    const totalRow = { ...rk.total, cls: "sum", label: t("cvx_total"), isTotal: true };
    sortableTable(document.getElementById("rank-table"), {
      sortKey: "n",
      columns: [
        { key: "rank", label: "#", sort: l => -l.rank, render: l => (l.rank ? rankBadge(l.rank, (n) => t("cvx_rank_fmt", { n })) : na()) },
        { key: "bb", label: t("cvx_bb"), sort: l => l.bb,
          render: l => (l.bb ? `<a href="${link(l.bb)}">${esc(l.bb)}</a>` : esc(l.label)) },
        { key: "n", label: t("cvx_total_units"), cls: "num", sort: l => l.n, render: l => `<b>${fmtNum(l.n)}</b>` },
        { key: "share", label: `${t("cvx_share")} (${period.mode === "ytd" ? "YTD" : pt.short})`, sort: l => l.share,
          render: l => (l.isTotal ? "100.0%" : inlineBar(l.share, maxShare, { text: pct(l.share) })) },
        { key: "pp", label: `${t("cvx_vs_ly")} (pp)`, cls: "num", sort: l => l.pp, render: l => (l.isTotal ? na() : ppDelta(l.pp)) },
        { key: "cat", label: t("cvx_main_cat"), sort: l => (l.mainCat ? l.mainCat.key : ""),
          render: l => (l.isTotal ? mainOf(l.mainCat, l.n) : catChip(l.mainCat && l.mainCat.key)) },
        { key: "axle", label: t("cvx_main_axle"), sort: l => (l.mainAxle ? String(l.mainAxle.key) : ""),
          render: l => (l.isTotal ? mainOf(l.mainAxle, l.n) : (l.mainAxle ? greyChip(l.mainAxle.key ?? "–") : na())) },
        { key: "imp", label: t("cvx_import_brand"), sort: l => l.impShare,
          render: l => inlineBar(l.impShare, l.isTotal || l.cls ? 100 : maxImp, { width: 80, color: COLOR.amber,
            text: `${fmtNum(l.imp)} · ${pct(l.impShare)}` }) },
        { key: "mb", label: t("cvx_mb"), cls: "num", sort: l => l.mb,
          render: l => (l.mb ? `<b>${fmtNum(l.mb)}</b>` : `<span class="cvx-na">0</span>`) },
        { key: "mbShare", label: t("cvx_mb_ratio"), cls: "num", sort: l => l.mbShare, render: l => pct(l.mbShare) },
      ],
      rows: lines,
      pinned: [otherRow, totalRow].filter(Boolean),
    });
  }

  // ---- panels ---------------------------------------------------------------
  const panels = document.getElementById("panels");

  // Brand mix of the top bodybuilders: MB, the other imports, then each
  // domestic brand — the split the 수입 column above summarises.
  const bo = brandOrder(bodied);
  const mixKeys = [
    { key: MB, label: MB, color: brandColor(MB), test: r => r.brand === MB },
    { key: "imp", label: t("cvx_other_imports"), color: "#2563eb", test: r => r.imp && r.brand !== MB },
    ...bo.domestics.map(b => ({ key: b, label: b, color: brandColor(b), fg: "#111827", test: r => !r.imp && r.brand === b })),
  ];
  const mixRows = rk ? rk.top.slice(0, TOP_N_MIX).map(l => {
    const rs = pop.filter(r => r.bb === l.bb);
    return `<div class="lbl" title="${esc(l.bb)}">${esc(l.bb)}</div>
      ${stackedBar100(mixKeys.map(k => ({ label: k.label, n: rs.filter(k.test).length, color: k.color, fg: k.fg })))}
      <div class="val">${pct(l.impShare)}</div>`;
  }).join("") : "";

  let divRows = [];
  if (rk && prevPop) {
    const withPp = rk.top.filter(l => l.pp !== null);
    const ups = withPp.filter(l => l.pp > 0).sort((a, b) => b.pp - a.pp).slice(0, 5);
    const downs = withPp.filter(l => l.pp < 0).sort((a, b) => a.pp - b.pp).slice(0, 4);
    divRows = [...ups, ...downs.reverse()].map(l => ({ label: l.bb, value: l.pp }));
  }

  panels.innerHTML = [
    card({
      title: t("cvx_panel_monthly_bb"), aside: oemCatAside(s),
      body: `<div id="p-trend" class="chart"></div>`,
    }),
    card({
      title: t("cvx_panel_top_brand_mix"), aside: t("cvx_panel_top_brand_mix_sub"),
      body: rk ? `${legend(mixKeys)}<div class="cvx-rows">${mixRows}</div>` : empty(t("cvx_empty")),
    }),
    card({
      title: t("cvx_panel_share_change"), aside: `${t("cvx_top_n", { n: TOP_N_BB })} · ${t("cvx_up5_down4")}`,
      body: !prevPop ? empty(t("cvx_no_prev")) : divRows.length
        ? divergingBar(divRows, { scale: divergeScale(divRows.map(r => r.value), { floor: 1 }) })
        : empty(t("cvx_no_change")),
    }),
  ].join("");

  const curSeries = monthly(yearRows, cur.lastMonth);
  const prevSeries = prevYearRows ? monthly(prevYearRows, 12) : null;
  trendLine(document.getElementById("p-trend"), {
    // Bare month numbers: twelve '1월' labels do not fit a third-width panel.
    x: Array.from({ length: 12 }, (_, i) => String(i + 1)),
    xType: "category",
    series: [
      ...(prevSeries ? [{ name: String(s.year - 1), values: prevSeries, color: "#9ca3af", width: 2 }] : []),
      { name: String(s.year), values: curSeries, color: COLOR.navy, width: 3, fill: "rgba(30,58,138,0.08)" },
      { name: `${t("exec_ma3")} (${s.year})`, values: movingAvg3(curSeries), color: COLOR.navy, width: 1.6, dash: "dot", markerSize: 0 },
    ],
    height: 260,
  });
});

function oemCatAside(s) {
  const o = s.oem === "import" ? t("cvx_import_brands") : s.oem === "domestic" ? t("cvx_domestic") : t("filter_all");
  return s.cat === "all" ? o : `${o} · ${esc(s.cat)}`;
}
