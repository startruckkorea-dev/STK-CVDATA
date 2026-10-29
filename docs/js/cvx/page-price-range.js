// ④ 용도별 가격 레인지 — the same model, body and bodybuilder still sell at
// different prices, so each use is read as a range (min / median / mean /
// max) against a comparison year.

import { t } from "../i18n.js";
import { fmtNum } from "../format.js";
import { trendLine } from "../charts.js";
import {
  filterRows, catOrder, axleOrder, brandOrder, ranked, countBy, priceStats, pctChange,
  dispersion, rangeAxis, divergeScale,
} from "./agg.js";
import { MB, COLOR, SMALL_SAMPLE, DISPERSION_TOP, catColor } from "./schema.js";
import {
  esc, na, pct, mw, dec1, ppDelta, sparkline, miniBars, kpiCard, pageHeader, card, footnote, empty,
  catChip, greyChip, inlineBar, rangeBar, rangeTicks, divergingBar,
} from "./ui.js";
import { bootPage, rowsOf, filterBar } from "./page.js";

bootPage(async ({ years, state, set, stale }) => {
  const year = years.includes(parseInt(state.year, 10)) ? parseInt(state.year, 10) : years[0];
  const base = await rowsOf(year, years);
  if (stale()) return;

  // Comparison: last year in full (default), last year to the same month, or
  // two years back.
  const cmpOptions = [];
  if (years.includes(year - 1)) {
    cmpOptions.push({ value: String(year - 1), label: `${year - 1} ${t("cvx_full_year")}` });
    if (base.lastMonth < 12) cmpOptions.push({ value: "ytd", label: `${year - 1} YTD (1–${base.lastMonth}${t("cvx_month_suffix")})` });
  }
  if (years.includes(year - 2)) cmpOptions.push({ value: String(year - 2), label: `${year - 2} ${t("cvx_full_year")}` });
  const cmpKey = cmpOptions.some(o => o.value === state.cmp) ? state.cmp : (cmpOptions[0] && cmpOptions[0].value);
  const cmpYear = cmpKey === "ytd" ? year - 1 : parseInt(cmpKey, 10);
  const cmpData = cmpKey ? await rowsOf(cmpYear, years) : null;
  if (stale()) return;

  const yearLabel = (y, d) => (d && d.lastMonth < 12 ? `${y} YTD` : String(y));
  const baseLabel = yearLabel(year, base);
  const cmpLabel = cmpKey === "ytd" ? `${year - 1} YTD` : cmpKey ? String(cmpYear) : "–";

  // Brand, then the model / bodybuilder / axle lists that brand actually has.
  const bo = brandOrder(base.rows);
  const brand = state.brand === "import" || [...bo.imports, ...bo.domestics].includes(state.brand) ? state.brand : MB;
  const brandRows = filterRows(base.rows, { brand });
  const models = ranked(countBy(brandRows, r => r.model)).filter(e => e.key !== null);
  const model = models.some(e => e.key === state.model) ? state.model : "all";
  const bbs = ranked(countBy(filterRows(brandRows, { model }), r => r.bb)).filter(e => e.key !== null);
  const bb = bbs.some(e => e.key === state.bb) ? state.bb : "all";
  const axles = axleOrder(base.rows);
  const axle = axles.includes(state.axle) ? state.axle : "all";
  const brandName = brand === "import" ? t("cvx_all_imports") : brand;

  document.getElementById("head").innerHTML = pageHeader({
    crumb: `CV DATA · ${t("cvx_price_analysis")}`, title: t("nav_cvx_price_range"), sub: t("cvx_price_sub"),
    period: baseLabel, vs: cmpKey ? `vs ${cmpLabel}` : t("cvx_no_prev"),
  });
  filterBar(document.getElementById("filters"), [
    { key: "year", label: t("cvx_base_year"), kind: "select", value: String(year),
      options: years.map(y => ({ value: String(y), label: y === year ? baseLabel : String(y) })) },
    { key: "cmp", label: t("cvx_cmp_year"), kind: "select", value: cmpKey || "",
      options: cmpOptions.length ? cmpOptions : [{ value: "", label: "–" }] },
    { key: "brand", label: t("cvx_brand"), kind: "select", value: brand,
      options: [{ value: "import", label: t("cvx_all_imports") },
        ...[...bo.imports, ...bo.domestics].map(b => ({ value: b, label: b }))] },
    { key: "model", label: t("cvx_model"), kind: "select", value: model,
      options: [{ value: "all", label: t("filter_all") }, ...models.map(e => ({ value: e.key, label: `${e.key} (${fmtNum(e.n)})` }))] },
    { key: "bb", label: t("cvx_bb"), kind: "select", value: bb,
      options: [{ value: "all", label: t("filter_all") }, ...bbs.map(e => ({ value: e.key, label: `${e.key} (${fmtNum(e.n)})` }))] },
    { key: "axle", label: "Axle", kind: "select", value: axle,
      options: [{ value: "all", label: t("filter_all") }, ...axles.map(a => ({ value: a, label: a }))] },
  ], (patch) => set(patch.brand ? { ...patch, model: null, bb: null } : patch));

  const f = { brand, model, bb, axle };
  const rows = filterRows(base.rows, f).filter(r => r.price > 0);
  const cmpRows = cmpData
    ? filterRows(cmpData.rows, { ...f, ...(cmpKey === "ytd" ? { from: 1, to: base.lastMonth } : {}) }).filter(r => r.price > 0)
    : [];
  const cats = catOrder(base.rows);
  const st = priceStats(rows.map(r => r.price));
  const cst = priceStats(cmpRows.map(r => r.price));
  const unitM = t("cvx_mkrw");
  const small = (k) => (k && k.n < SMALL_SAMPLE ? `<span class="cvx-small">${t("cvx_small_sample")}</span>` : "");

  const perCat = cats.map(c => {
    const rs = rows.filter(r => r.cat === c);
    const cs = cmpRows.filter(r => r.cat === c);
    const subTop = ranked(countBy(rs.filter(r => r.sub), r => r.sub))[0];
    return { cat: c, sub: subTop ? subTop.key : null, rs, cur: priceStats(rs.map(r => r.price)), cmp: priceStats(cs.map(r => r.price)) };
  });
  const changes = perCat.filter(p => p.cur && p.cmp)
    .map(p => ({ ...p, mean: pctChange(p.cur.mean, p.cmp.mean), median: pctChange(p.cur.median, p.cmp.median) }))
    .sort((a, b) => b.mean - a.mean);

  // ---- KPI ------------------------------------------------------------------
  const monthMeans = Array.from({ length: 12 }, (_, i) => {
    if (i >= base.lastMonth) return null;
    const s = priceStats(rows.filter(r => r.m === i + 1).map(r => r.price));
    return s ? s.mean : null;
  });
  const y2 = years.includes(year - 2) ? await rowsOf(year - 2, years) : null;
  if (stale()) return;
  const y2st = y2 ? priceStats(filterRows(y2.rows, f).map(r => r.price)) : null;
  const vsCmp = (v) => `${ppDelta(v, "%")} <span class="cvx-small">vs ${esc(cmpLabel)}</span>`;
  const best = changes[0];

  document.getElementById("kpis").innerHTML = [
    kpiCard({
      label: `${t("cvx_avg_price")} (${baseLabel} · ${esc(brandName)})`,
      value: st ? mw(st.mean) : "–", unit: st ? unitM : "",
      delta: `${vsCmp(st && cst ? pctChange(st.mean, cst.mean) : null)} ${cst ? `(${mw(cst.mean)})` : ""}`,
      side: sparkline(monthMeans),
    }),
    kpiCard({
      label: `${t("cvx_median")} (${baseLabel})`,
      value: st ? mw(st.median) : "–", unit: st ? unitM : "",
      delta: vsCmp(st && cst ? pctChange(st.median, cst.median) : null),
      side: miniBars([
        { label: String(year - 2), n: y2st ? y2st.median : 0, color: "#9ca3af" },
        { label: cmpLabel, n: cst ? cst.median : 0, color: "#a9bde6" },
        { label: baseLabel, n: st ? st.median : 0, color: COLOR.navy },
      ]),
    }),
    kpiCard({
      label: t("cvx_top_rise_use"),
      value: best ? esc(best.cat) : "–",
      unit: best ? `<span class="cvx-delta ${best.mean >= 0 ? "up" : "down"}">${best.mean >= 0 ? "+" : ""}${dec1(best.mean)}%</span>` : "",
      sub: best ? `${mw(best.cmp.mean)} → ${mw(best.cur.mean)} ${unitM}` : "",
      delta: changes.slice(1, 3).map((c, i) => `${t("cvx_rank_fmt", { n: i + 2 })} ${esc(c.cat)} ${c.mean >= 0 ? "+" : ""}${dec1(c.mean)}%`).join(" · "),
      side: miniBars(changes.map(c => ({ label: c.cat, n: Math.max(0, c.mean), color: catColor(c.cat) }))),
    }),
    kpiCard({
      label: t("cvx_sample_spread"),
      value: st ? fmtNum(st.n) : "0", unit: t("cvx_units"),
      sub: st ? `${t("cvx_max_min")} ${(st.max / st.min).toFixed(2)}${t("cvx_times")}` : "",
      delta: st ? `${perCat.filter(p => p.cur).map(p => `${esc(p.cat)} ${fmtNum(p.cur.n)}`).join(" · ")} · ${mw(st.min, 0)} ~ ${mw(st.max, 0)}` : "",
      side: st ? `<div style="width:110px">${rangeBar(st, null, rangeAxis(st.min, st.max), { compact: true })}</div>` : "",
    }),
  ].join("");

  // ---- main card: ranges by use --------------------------------------------
  const all = [...rows, ...cmpRows].map(r => r.price);
  const axis = all.length ? rangeAxis(Math.min(...all), Math.max(...all)) : null;
  const scopeText = [esc(brandName), model === "all" ? t("cvx_all_models") : esc(model),
    bb === "all" ? t("cvx_all_bb") : esc(bb), axle === "all" ? null : esc(axle)].filter(Boolean).join(" · ");

  const line = (label, cur, cmp, { total = false, muted = false } = {}) => {
    const ch = cur && cmp ? pctChange(cur.mean, cmp.mean) : null;
    const chm = cur && cmp ? pctChange(cur.median, cmp.median) : null;
    const rangeCell = cur || cmp
      ? rangeBar(cur, cmp, axis, { color: total ? COLOR.navy : COLOR.bar })
      : `<span class="cvx-na">${t("cvx_no_brand_reg", { brand: esc(brandName) })}</span>`;
    return `<tr class="${total ? "sum" : ""}">
      <td class="${muted ? "muted" : ""}">${label}</td>
      <td class="num">${cur ? fmtNum(cur.n) : na()}${small(cur)}</td>
      <td class="num">${cur ? mw(cur.min, 0) : na()}</td>
      <td class="num"><b>${cur ? mw(cur.median) : na()}</b></td>
      <td class="num"><b>${cur ? mw(cur.mean) : na()}</b></td>
      <td class="num">${cur ? mw(cur.max, 0) : na()}</td>
      <td>${rangeCell}</td>
      <td class="num">${ppDelta(ch, "%")}</td>
      <td class="num">${ppDelta(chm, "%")}</td>
      <td class="num cvx-na">${cmp ? mw(cmp.mean) : "–"}</td>
    </tr>`;
  };
  const legendHtml = `<div class="cvx-range-legend">
    <span><i style="width:18px;height:10px;background:${COLOR.bar};border-radius:2px"></i>${baseLabel} ${t("cvx_min_max")}</span>
    <span><i style="width:2px;height:12px;background:#fff;box-shadow:0 0 0 1px ${COLOR.navy}"></i>${t("cvx_median")}</span>
    <span><i style="width:9px;height:9px;border:2px solid ${COLOR.navy};border-radius:50%"></i>${t("cvx_mean")}</span>
    <span><i style="width:18px;height:5px;background:#c4c9d1;border-radius:2px"></i>${esc(cmpLabel)} ${t("cvx_min_max")} · ${t("cvx_median")}</span>
  </div>`;

  const rangeCard = card({
    title: t("cvx_price_range_title"), aside: `${scopeText} · ${baseLabel} vs ${esc(cmpLabel)}`, note: legendHtml,
    body: st || cst ? `<div class="cvx-scroll"><table class="cvx-table">
        <thead><tr>
          <th>${t("cvx_use")}</th><th class="num">N</th><th class="num">${t("cvx_min")}</th><th class="num">${t("cvx_median")}</th>
          <th class="num">${t("cvx_mean")}</th><th class="num">${t("cvx_max")}</th>
          <th>${t("cvx_price_range_col", { lo: axis ? fmtNum(axis.min) : "–", hi: axis ? fmtNum(axis.max) : "–" })}</th>
          <th class="num">${t("cvx_mean")} ${t("cvx_vs_ly")}</th><th class="num">${t("cvx_median")} ${t("cvx_vs_ly")}</th>
          <th class="num">${t("cvx_cmp_mean")}</th>
        </tr></thead>
        <tbody>
          ${perCat.map(p => line(p.cur ? catChip(p.cat, p.sub) : `<span class="cvx-na">${esc(p.cat)}</span>`, p.cur, p.cmp, { muted: !p.cur })).join("")}
          ${line(`${t("cvx_all")} (${esc(brandName)})`, st, cst, { total: true })}
          <tr><td colspan="6"></td><td>${rangeTicks(axis)}</td><td colspan="3"></td></tr>
        </tbody></table></div>${footnote(t("cvx_price_foot", { n: SMALL_SAMPLE }))}`
      : empty(t("cvx_empty")),
  });

  // ---- second card: spread inside one model / use / bodybuilder -------------
  const groups = dispersion(rows, r => [r.model, r.axle, r.sub || r.cat, r.bb].join("\u0000"), { minN: 2, top: DISPERSION_TOP });
  const maxSpread = groups.length ? groups[0].spread : 1;
  const dispCard = card({
    title: t("cvx_dispersion_title"), aside: `${t("cvx_dispersion_sub")} · ${baseLabel}`, note: t("cvx_dispersion_note"),
    body: groups.length ? `<div class="cvx-scroll"><table class="cvx-table">
        <thead><tr><th>${t("cvx_model")}</th><th>Axle</th><th>${t("cvx_use")}</th><th>${t("cvx_bb")}</th><th class="num">N</th>
          <th class="num">${t("cvx_min")}</th><th class="num">${t("cvx_median")}</th><th class="num">${t("cvx_mean")}</th>
          <th class="num">${t("cvx_max")}</th><th>${t("cvx_spread")}</th><th class="num">${t("cvx_spread_pct")}</th></tr></thead>
        <tbody>${groups.map(g => {
          const r = g.rows[0];
          return `<tr><td><b>${esc(r.model || "–")}</b></td><td>${greyChip(r.axle || "–")}</td><td>${catChip(r.cat, r.sub)}</td>
            <td>${esc(r.bb || "–")}</td><td class="num">${fmtNum(g.stats.n)}</td><td class="num">${mw(g.stats.min, 0)}</td>
            <td class="num">${mw(g.stats.median)}</td><td class="num"><b>${mw(g.stats.mean)}</b></td><td class="num">${mw(g.stats.max, 0)}</td>
            <td>${inlineBar(g.spread, maxSpread, { width: 110, text: `<b>${mw(g.spread)}</b>` })}</td>
            <td class="num">${pct(g.spreadPct)}</td></tr>`;
        }).join("")}</tbody></table></div>`
      : empty(t("cvx_empty")),
  });
  document.getElementById("main-card").innerHTML = rangeCard + dispCard;

  // ---- panels ---------------------------------------------------------------
  const trendYears = years.filter(y => y <= year).sort((a, b) => a - b).slice(-4);
  const trendData = [];
  for (const y of trendYears) trendData.push(await rowsOf(y, years));
  if (stale()) return;
  const trendCats = cats.filter(c => trendData.some(d => filterRows(d.rows, { ...f, cat: c }).some(r => r.price > 0)));

  const divRows = changes.map(c => ({
    label: c.cat, value: c.mean, text: `${fmtPct1(c.mean)} (${fmtPct1(c.median)})`,
  }));
  if (st && cst) {
    divRows.push({
      label: `${t("cvx_all")} (${brandName})`, strong: true, value: pctChange(st.mean, cst.mean),
      text: `${fmtPct1(pctChange(st.mean, cst.mean))} (${fmtPct1(pctChange(st.median, cst.median))})`,
    });
  }
  const noSample = perCat.filter(p => !(p.cur && p.cmp)).map(p => p.cat);
  if (noSample.length) divRows.push({ label: `${t("cvx_no_sample")}: ${noSample.join("·")}`, value: null, text: "–" });

  // Bodybuilders on the busiest use: the five with the most registrations,
  // listed dearest first.
  // Busiest use among bodied rows: a tractor has no bodybuilder to compare.
  const topCat = ranked(countBy(rows.filter(r => r.bb), r => r.cat), cats)[0];
  let bbBody = empty(t("cvx_empty"));
  if (topCat) {
    const inCat = rows.filter(r => r.cat === topCat.key && r.bb);
    const top5 = ranked(countBy(inCat, r => r.bb)).slice(0, 5)
      .map(e => ({ bb: e.key, st: priceStats(inCat.filter(r => r.bb === e.key).map(r => r.price)) }))
      .sort((a, b) => b.st.mean - a.st.mean);
    if (top5.length) {
      const ax = rangeAxis(Math.min(...top5.map(x => x.st.min)), Math.max(...top5.map(x => x.st.max)));
      const gap = top5[0].st.mean - top5[top5.length - 1].st.mean;
      bbBody = `<div class="cvx-rows" style="grid-template-columns:minmax(80px,140px) 1fr auto">
        ${top5.map(x => `<div class="lbl" title="${esc(x.bb)}">${esc(x.bb)} <span class="cvx-small">${fmtNum(x.st.n)}</span></div>
          ${rangeBar(x.st, null, ax, { compact: true })}
          <div class="val">${mw(x.st.mean)}</div>`).join("")}
        <div></div>${rangeTicks(ax, { compact: true })}<div></div>
      </div>${footnote(t("cvx_bb_mean_gap", { v: mw(gap) }))}`;
    }
  }

  document.getElementById("panels").innerHTML = [
    card({ title: t("cvx_panel_avg_trend"), aside: `${esc(brandName)} · ${unitM}`, body: `<div id="p-avg" class="chart"></div>` }),
    card({
      title: `${t("cvx_panel_rise_by_use")} vs ${esc(cmpLabel)} (%)`,
      body: divRows.some(r => r.value !== null)
        ? divergingBar(divRows, { scale: divergeScale(divRows.map(r => r.value), { floor: 5 }), unit: "%" }) + footnote(t("cvx_rise_foot"))
        : empty(t("cvx_no_prev")),
    }),
    card({ title: `${t("cvx_panel_bb_range")} · ${topCat ? esc(topCat.key) : "–"}`, aside: unitM, body: bbBody }),
  ].join("");

  trendLine(document.getElementById("p-avg"), {
    x: trendYears.map((y, i) => (i === trendYears.length - 1 ? yearLabel(y, trendData[i]) : String(y))),
    series: trendCats.map(c => ({
      name: c, color: c === "탑차" ? "#b45309" : catColor(c), width: 2.2, labels: "last", yFormat: ",.1f",
      values: trendData.map(d => {
        const s = priceStats(filterRows(d.rows, { ...f, cat: c }).map(r => r.price));
        return s ? s.mean : null;
      }),
    })),
    height: 280,
    xType: "category",
  });
});

const fmtPct1 = (v) => (v === null || v === undefined ? "–" : `${v > 0 ? "+" : ""}${dec1(v)}%`);
