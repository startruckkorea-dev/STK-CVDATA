// ② 특장업체 상세 — what one bodybuilder builds, on whose chassis and on
// which axle, and where Mercedes-Benz is thin in its book.

import { t } from "../i18n.js";
import { fmtNum } from "../format.js";
import {
  periodOf, filterRows, catOrder, axleOrder, axleKeys, axleKeyFn, axleGroupOf, brandOrder,
  monthly, monthlyShare, share, ppDiff, yoy, ranked, countBy, pivot,
} from "./agg.js";
import { MB, COLOR, AXLE_GROUPS, CAT_STACK_ORDER, catColor, brandColor } from "./schema.js";
import {
  esc, na, pct, dec1, ppDelta, sparkline, miniBars, kpiCard, pageHeader, card, footnote, empty,
  segmentBar, legend, stackedBar100, heatTable, catItems,
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
  const axles = axleOrder(bodied);
  const axleList = axleKeys(axles, s.axleMode);
  const axleFn = axleKeyFn(s.axleMode);
  const period = periodOf(s.month, cur.lastMonth);
  const pt = periodText(s.year, period);

  // The market this bodybuilder is measured against: every bodied
  // registration in the window and brand scope. 차종 is not a filter here —
  // the page is about the bodybuilder's 차종 mix.
  const win = { oem: s.oem, bodied: true, from: period.from, to: period.to };
  const market = filterRows(cur.rows, win);
  const prevMarket = prev ? filterRows(prev.rows, win) : null;
  const ranking = ranked(countBy(market, r => r.bb));
  const bb = state.bb || (ranking[0] && ranking[0].key) || null;
  const rankOf = (k) => ranking.findIndex(e => e.key === k) + 1;

  const options = ranking.map((e, i) => ({ value: e.key, label: `${e.key} (${t("cvx_rank_fmt", { n: i + 1 })} · ${fmtNum(e.n)}${t("cvx_units")})` }));
  if (bb && !ranking.some(e => e.key === bb)) options.unshift({ value: bb, label: bb });

  document.getElementById("head").innerHTML = pageHeader({
    crumb: `CV DATA · ${t("cvx_bb_analysis")}`, title: t("nav_cvx_bb_detail"), sub: t("cvx_bb_detail_sub"),
    period: pt.now, vs: prev ? pt.vs : t("cvx_no_prev"),
  });
  filterBar(document.getElementById("filters"), [
    { key: "bb", label: t("cvx_bb"), kind: "search", value: bb, options },
    yearField(String(s.year), years),
    monthField(s.month, cur.lastMonth),
    oemField(s.oem),
    axleModeField(s.axleMode),
  ], set);

  const rows = market.filter(r => r.bb === bb);
  const prevRows = prevMarket ? prevMarket.filter(r => r.bb === bb) : null;
  const yearRows = filterRows(cur.rows, { oem: s.oem, bodied: true, bb });
  const n = rows.length;
  const unit = t("cvx_units");
  const vsLY = (d) => `${d} <span class="cvx-small">${t("cvx_vs_ly")}</span>`;

  // ---- KPI ------------------------------------------------------------------
  const catRank = ranked(countBy(rows, r => r.cat), cats);
  const axleRank = ranked(countBy(rows, axleFn), axleList);
  const imp = rows.filter(r => r.imp).length;
  const mb = rows.filter(r => r.brand === MB).length;
  const runnersUp = (list) => list.slice(1, 3).map((e, i) => `${t("cvx_rank_fmt", { n: i + 2 })} ${esc(e.key)} ${pct(share(e.n, n))}`).join(" · ");
  const series = monthly(yearRows, cur.lastMonth);
  const mktImp = share(market.filter(r => r.imp).length, market.length);
  const prevImpShare = prevRows && prevRows.length ? share(prevRows.filter(r => r.imp).length, prevRows.length) : null;
  const top = (list) => list[0] || null;

  document.getElementById("kpis").innerHTML = [
    kpiCard({
      label: `${t("cvx_kpi_reg_total")} (${period.mode === "ytd" ? "YTD" : pt.short})`,
      value: fmtNum(n), unit,
      sub: n ? `${t("cvx_share")} ${pct(share(n, market.length))} (${t("cvx_rank_fmt", { n: rankOf(bb) })})` : "",
      delta: vsLY(ppDelta(prevRows ? yoy(n, prevRows.length) : null, "%")),
      side: sparkline(series),
    }),
    kpiCard({
      label: t("cvx_main_cat"),
      value: top(catRank) ? esc(top(catRank).key) : "–",
      sub: top(catRank) ? `${fmtNum(top(catRank).n)}${unit} · ${pct(share(top(catRank).n, n))}` : "",
      delta: runnersUp(catRank),
      side: miniBars(cats.map(c => ({ label: c, n: rows.filter(r => r.cat === c).length, color: catColor(c) }))),
    }),
    kpiCard({
      label: t("cvx_main_axle"),
      value: top(axleRank) ? esc(top(axleRank).key) : "–",
      sub: top(axleRank) ? `${fmtNum(top(axleRank).n)}${unit} · ${pct(share(top(axleRank).n, n))}` : "",
      delta: runnersUp(axleRank),
      side: miniBars(axleList.map(a => ({
        label: a, n: rows.filter(r => axleFn(r) === a).length,
        color: top(axleRank) && top(axleRank).key === a ? COLOR.navy : "#a9bde6",
      }))),
    }),
    kpiCard({
      label: t("cvx_kpi_import_mb"),
      value: n ? dec1(share(imp, n)) : "–", unit: n ? "%" : "",
      sub: `${t("cvx_import")} ${fmtNum(imp)}${unit} · ${t("cvx_mb")} ${fmtNum(mb)}${unit} (${pct(share(mb, n))})`,
      delta: `${vsLY(ppDelta(ppDiff(share(imp, n), prevImpShare)))} · ${t("cvx_market_avg")} ${pct(mktImp)}`,
      side: sparkline(monthlyShare(monthly(yearRows, cur.lastMonth, r => r.imp), series), { color: COLOR.amber }),
    }),
  ].join("");

  // ---- main card ------------------------------------------------------------
  const mainEl = document.getElementById("main-card");
  const title = `${esc(bb || "–")} · ${t("cvx_cat_mix")}`;
  if (!n) {
    mainEl.innerHTML = card({ title, body: empty(t("cvx_empty")) });
  } else {
    const catMix = catItems(cats, c => rows.filter(r => r.cat === c).length);
    // Brands this bodybuilder used, in the market's order — plus the MB
    // column even when empty, since an empty MB column is the finding.
    const mo = brandOrder(market);
    const used = (b) => rows.some(r => r.brand === b) || (b === MB && s.oem !== "domestic");
    const bo = { imports: mo.imports.filter(used), domestics: mo.domestics.filter(used) };
    const brands = [...bo.imports, ...bo.domestics];
    const pB = pivot(rows, r => r.cat, r => r.brand, cats, brands);
    const toPrice = linkTo("price-range.html", { year: s.year, brand: MB, bb });
    const rowsDef = cats.map(c => ({ key: c, label: c, muted: !pB.rowTotal(c) }));

    const brandGroups = [];
    if (bo.imports.length) brandGroups.push({ label: t("cvx_import_brands"), span: bo.imports.length, cls: "imp" });
    if (bo.domestics.length) brandGroups.push({ label: t("cvx_domestic"), span: bo.domestics.length, cls: "dom" });

    // The axle the visitor came in on (from ③) is the one tinted; 8X4 otherwise.
    const hiAxle = s.axleMode === "group" ? axleGroupOf(state.axle || "8X4") : (state.axle && axles.includes(state.axle) ? state.axle : "8X4");
    const pA = pivot(rows, r => r.cat, axleFn, cats, axleList);
    let axleGroups = null;
    if (s.axleMode !== "group") {
      axleGroups = [];
      for (const a of axleList) {
        const g = axleGroupOf(a);
        const last = axleGroups[axleGroups.length - 1];
        if (last && last.key === g) last.span++;
        else axleGroups.push({ key: g, span: 1 });
      }
      axleGroups = axleGroups.map(g => ({ ...g, label: groupLabel(g.key), cls: "imp" }));
    }

    const impN = imp, domN = n - imp;
    const groupCounts = axleKeys(axles, "group").map(g => {
      const c = rows.filter(r => axleGroupOf(r.axle) === g).length;
      return `${esc(g)} ${fmtNum(c)}${unit} (${pct(share(c, n))})`;
    }).join(" · ");

    mainEl.innerHTML = card({
      title, aside: `${pt.short} · ${fmtNum(n)}${unit}`, note: t("cvx_note_heat"),
      body: `${segmentBar(catMix, n)}${legend(catMix, n)}
        <div class="cvx-two">
          <div>
            <h3>${t("cvx_heat_brand")}</h3>
            ${heatTable({
              corner: t("cvx_cat"), groups: brandGroups, p: pB, rows: rowsDef,
              cols: brands.map(b => ({ key: b, label: b, hi: b === MB, link: b === MB ? toPrice : null })),
              totalLabel: t("cvx_total"), colTotalLabel: t("cvx_total"),
            })}
            ${footnote(`${t("cvx_import")} ${fmtNum(impN)}${unit} (${pct(share(impN, n))}) · ${t("cvx_domestic")} ${fmtNum(domN)}${unit} (${pct(share(domN, n))}) · ${t("cvx_mb")} ${fmtNum(mb)}${unit} = ${t("cvx_in_import")} ${pct(share(mb, impN))}`)}
          </div>
          <div>
            <h3>${t("cvx_heat_axle")}</h3>
            ${heatTable({
              corner: t("cvx_cat"), groups: axleGroups, p: pA, rows: rowsDef,
              cols: axleList.map(a => ({ key: a, label: a, hi: a === hiAxle })),
              totalLabel: t("cvx_total"), colTotalLabel: t("cvx_total"),
            })}
            ${footnote(`${t("cvx_by_group")} — ${groupCounts}`)}
          </div>
        </div>`,
    });
  }

  // ---- panels ---------------------------------------------------------------
  const stackCats = [...CAT_STACK_ORDER.filter(c => cats.includes(c)), ...cats.filter(c => !CAT_STACK_ORDER.includes(c))];
  const catSegs = (rs) => stackCats.map(c => ({
    label: c, n: rs.filter(r => r.cat === c).length, color: catColor(c),
    fg: ["탑차", "덤프", "전문수송류"].includes(c) ? "#111827" : "#fff",
  }));

  const bo = brandOrder(rows);
  const brandLines = [...bo.imports, ...bo.domestics].map(b => {
    const rs = rows.filter(r => r.brand === b);
    return `<div class="lbl${b === MB ? " strong" : ""}">${esc(b)}</div>${stackedBar100(catSegs(rs))}<div class="val">${fmtNum(rs.length)}</div>`;
  }).join("");

  const groups = axleKeys(axles, "group");
  const groupLines = groups.map(g => {
    const rs = rows.filter(r => axleGroupOf(r.axle) === g);
    return `<div class="lbl">${esc(g)}</div>${stackedBar100(catSegs(rs), { height: 24, labeled: true })}<div class="val">${fmtNum(rs.length)}</div>`;
  }).join("");
  const g8 = rows.filter(r => axleGroupOf(r.axle) === "8X4군");
  const g8NonCargo = share(g8.filter(r => r.cat !== "카고").length, g8.length);

  // MB's share of the imports, category by category: this bodybuilder's
  // book against the market's.
  const mbIn = (rs) => {
    const im = rs.filter(r => r.imp);
    return im.length ? share(im.filter(r => r.brand === MB).length, im.length) : null;
  };
  const mbRows = cats.map(c => ({ c, mine: mbIn(rows.filter(r => r.cat === c)), mkt: mbIn(market.filter(r => r.cat === c)) }));
  const mbMax = Math.max(10, Math.ceil(Math.max(0, ...mbRows.map(r => Math.max(r.mine || 0, r.mkt || 0))) / 10) * 10);
  const bar = (v, color) => `<span class="cvx-track" style="width:100%;height:7px;display:block"><span style="width:${((v || 0) / mbMax * 100).toFixed(1)}%;background:${color}"></span></span>`;
  const mbLines = mbRows.map(r => {
    const none = !r.mine && !r.mkt;
    return `<div class="lbl${none ? " cvx-na" : ""}">${esc(r.c)}</div>
      <div style="display:grid;gap:3px">${bar(r.mine, none ? "#d1d5db" : COLOR.navy)}${bar(r.mkt, "#9ca3af")}</div>
      <div class="val">${r.mine === null ? "–" : `${dec1(r.mine)}%`} / ${r.mkt === null ? "–" : `${dec1(r.mkt)}%`}<br>${ppDelta(ppDiff(r.mine, r.mkt))}</div>`;
  }).join("");

  document.getElementById("panels").innerHTML = [
    card({
      title: t("cvx_panel_brand_cat"), aside: "100%",
      body: n ? `${legend(catSegs(rows).map(x => ({ ...x, n: undefined })))}<div class="cvx-rows">${brandLines}</div>` : empty(t("cvx_empty")),
    }),
    card({
      title: t("cvx_panel_group_cat"), aside: "100%",
      body: n ? `<div class="cvx-rows">${groupLines}</div>
        ${footnote(`${AXLE_GROUPS.map(g => `${g.key} = ${g.members.join("+")}`).join(" · ")} · ${t("cvx_8x4_noncargo", { p: g8.length ? `${dec1(g8NonCargo)}%` : "–" })}`)}`
        : empty(t("cvx_empty")),
    }),
    card({
      title: t("cvx_panel_mb_vs_market"), aside: `${t("cvx_in_import")} · 0–${mbMax}%`,
      body: n ? `${legend([{ label: esc(bb), color: COLOR.navy }, { label: t("cvx_market"), color: "#9ca3af" }])}
        <div class="cvx-rows">${mbLines}</div>
        ${footnote(t("cvx_gap_note"))}` : empty(t("cvx_empty")),
    }),
  ].join("");
});

function groupLabel(key) {
  const g = AXLE_GROUPS.find(x => x.key === key);
  if (!g) return key;
  const others = g.members.filter(m => `${m}군` !== key);
  return others.length ? `${key} (${others.join("·")} ${t("cvx_incl")})` : key;
}
