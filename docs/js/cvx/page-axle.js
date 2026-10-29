// ③ Axle 기준 분석 — what one axle (8X4 by default) is bodied as, and which
// brand leads each of those uses.

import { t } from "../i18n.js";
import { fmtNum } from "../format.js";
import {
  periodOf, filterRows, catOrder, axleOrder, axleKeys, axleKeyFn, axleGroupOf, brandOrder,
  monthly, share, ppDiff, yoy, ranked, countBy, withRanks, podium, divergeScale,
} from "./agg.js";
import { MB, COLOR, CAT_STACK_ORDER, catColor, brandColor } from "./schema.js";
import {
  esc, na, pct, dec1, ppDelta, sparkline, miniBars, kpiCard, pageHeader, card, footnote, empty,
  catChip, segmentBar, legend, stackedBar100, divergingBar, sortableTable, catItems,
} from "./ui.js";
import {
  bootPage, rowsOf, filterBar, yearField, monthField, oemField, axleModeField,
  periodText, baseState, linkTo, oemLabel,
} from "./page.js";

bootPage(async ({ years, state, set, stale }) => {
  // Imports by default: the page is read to size the market an imported
  // truck is entering.
  const s = baseState(state, years, { oem: "import" });
  const cur = await rowsOf(s.year, years);
  const prev = await rowsOf(s.year - 1, years);
  if (stale()) return;

  const bodied = filterRows(cur.rows, { bodied: true });
  const cats = catOrder(bodied);
  const axles = axleOrder(bodied);
  const axleList = axleKeys(axles, s.axleMode);
  const axleFn = axleKeyFn(s.axleMode);
  // An axle handed over in the other mode maps across: 8X4 → 8X4군, and a
  // group back to 8X4.
  let axle = state.axle || "8X4";
  if (s.axleMode === "group" && !axleList.includes(axle)) axle = axleGroupOf(axle);
  if (!axleList.includes(axle)) axle = axleList.includes("8X4") ? "8X4" : axleList[0];

  const period = periodOf(s.month, cur.lastMonth);
  const pt = periodText(s.year, period);
  const win = { oem: s.oem, bodied: true, from: period.from, to: period.to };
  const scope = filterRows(cur.rows, win);
  const prevScope = prev ? filterRows(prev.rows, win) : null;
  const rows = scope.filter(r => axleFn(r) === axle);
  const prevRows = prevScope ? prevScope.filter(r => axleFn(r) === axle) : null;
  const n = rows.length;
  const unit = t("cvx_units");
  const range = oemLabel(s.oem);
  const vsLY = (d) => `${d} <span class="cvx-small">${t("cvx_vs_ly")}</span>`;

  document.getElementById("head").innerHTML = pageHeader({
    crumb: `CV DATA · ${t("cvx_bb_analysis")}`, title: t("nav_cvx_axle"), sub: t("cvx_axle_sub"),
    period: pt.now, vs: prev ? pt.vs : t("cvx_no_prev"),
  });
  const byAxle = countBy(scope, axleFn);
  filterBar(document.getElementById("filters"), [
    { key: "axle", label: "Axle", kind: "tabs", value: axle,
      options: axleList.map(a => ({ value: a, label: a, sub: fmtNum(byAxle.get(a) || 0) })) },
    axleModeField(s.axleMode),
    oemField(s.oem),
    yearField(String(s.year), years),
    monthField(s.month, cur.lastMonth),
  ], set);

  // ---- KPI ------------------------------------------------------------------
  const bo = brandOrder(scope);
  const brands = [...bo.imports, ...bo.domestics];
  const catRank = ranked(countBy(rows, r => r.cat), cats);
  const brandRank = withRanks(ranked(countBy(rows, r => r.brand), brands));
  const mbN = rows.filter(r => r.brand === MB).length;
  const mbRank = brandRank.find(e => e.key === MB);
  const mbShare = share(mbN, n);
  const prevMbShare = prevRows && prevRows.length ? share(prevRows.filter(r => r.brand === MB).length, prevRows.length) : null;
  const runnersUp = (list) => list.slice(1, 3).map((e, i) => `${t("cvx_rank_fmt", { n: i + 2 })} ${esc(e.key)} ${pct(share(e.n, n))}`).join(" · ");

  // Per use: brand standings, and whether MB leads it.
  const perCat = cats.map(c => {
    const rs = rows.filter(r => r.cat === c);
    const list = ranked(countBy(rs, r => r.brand), brands);
    const ranks = withRanks(list);
    const mb = ranks.find(e => e.key === MB) || null;
    return { cat: c, rows: rs, n: rs.length, list, podium: podium(list), mb, mbSole1: !!mb && mb.rank === 1 && !mb.tied };
  });
  const mbTopCat = perCat.filter(p => p.mb && p.mb.rank === 1).sort((a, b) => b.mb.n - a.mb.n)[0];

  document.getElementById("kpis").innerHTML = [
    kpiCard({
      label: `${esc(axle)} ${t("cvx_reg")} (${range} · ${period.mode === "ytd" ? "YTD" : pt.short})`,
      value: fmtNum(n), unit,
      sub: `${range} ${t("cvx_within")} ${pct(share(n, scope.length))}`,
      delta: vsLY(ppDelta(prevRows ? yoy(n, prevRows.length) : null, "%")),
      side: sparkline(monthly(filterRows(cur.rows, { oem: s.oem, bodied: true }).filter(r => axleFn(r) === axle), cur.lastMonth),
        { kind: "bars", highlight: period.sel - 1 }),
    }),
    kpiCard({
      label: `${t("cvx_top_use")} (${esc(axle)})`,
      value: catRank[0] ? esc(catRank[0].key) : "–",
      sub: catRank[0] ? `${fmtNum(catRank[0].n)}${unit} · ${pct(share(catRank[0].n, n))}` : "",
      delta: runnersUp(catRank),
      side: miniBars(cats.map(c => ({ label: c, n: rows.filter(r => r.cat === c).length, color: catColor(c) }))),
    }),
    kpiCard({
      label: `${t("cvx_lead_brand")} (${esc(axle)})`,
      value: brandRank[0] ? esc(brandRank[0].key) : "–",
      sub: brandRank[0] ? `${fmtNum(brandRank[0].n)}${unit} · ${pct(share(brandRank[0].n, n))}` : "",
      delta: runnersUp(brandRank),
      side: miniBars(brandRank.map(e => ({ label: e.key, n: e.n, color: brandColor(e.key) }))),
    }),
    kpiCard({
      label: `Mercedes-Benz (${esc(axle)})`,
      value: n ? dec1(mbShare) : "–", unit: n ? "%" : "",
      sub: `${fmtNum(mbN)}${unit}${mbRank ? ` · ${t("cvx_rank_fmt", { n: mbRank.rank })}` : ""}`,
      delta: `${vsLY(ppDelta(ppDiff(mbShare, prevMbShare)))}<br>${mbTopCat
        ? t("cvx_mb_top_use", { cat: esc(mbTopCat.cat), n: fmtNum(mbTopCat.mb.n) })
        : t("cvx_mb_top_use_none")}`,
      side: "",
    }),
  ].join("");

  // ---- main card ------------------------------------------------------------
  const mainEl = document.getElementById("main-card");
  const title = `${esc(axle)} ${t("cvx_axle_main_title")}`;
  if (!n) {
    mainEl.innerHTML = card({ title, body: empty(t("cvx_empty")) });
  } else {
    const catMix = catItems(cats, c => rows.filter(r => r.cat === c).length);
    const brandMix = brandRank.map(e => ({ label: e.key, n: e.n, color: brandColor(e.key) }));
    const place = (p, tot) => {
      if (!p) return na();
      return `<b>${p.keys.map(esc).join(" · ")}</b> ${fmtNum(p.n)} · ${pct(share(p.n, tot))}`;
    };
    const mbChip = (p) => {
      if (!p.mb) return na();
      const txt = `${p.mb.tied ? t("cvx_joint") + " " : ""}${t("cvx_rank_fmt", { n: p.mb.rank })} · ${pct(share(p.mb.n, p.n))}`;
      return `<span class="cvx-chip ${p.mbSole1 ? "navy" : "grey"}">${txt}</span>`;
    };
    const stack = (rs) => {
      const segs = ranked(countBy(rs, r => r.brand), brands).map(e => ({ label: e.key, n: e.n, color: brandColor(e.key) }));
      return stackedBar100(segs, { height: 14, width: 220 });
    };
    const totalPodium = podium(ranked(countBy(rows, r => r.brand), brands));
    const totalMb = brandRank.find(e => e.key === MB) || null;

    mainEl.innerHTML = card({
      title, aside: `${pt.short} · ${range} ${fmtNum(n)}${unit}`, note: t("cvx_note_mb_top_use"),
      body: `${segmentBar(catMix, n)}${legend(catMix, n)}${legend(brandMix, n, t("cvx_brand_mix_prefix"))}<div id="axle-table"></div>`,
    });
    sortableTable(document.getElementById("axle-table"), {
      columns: [
        { key: "cat", label: t("cvx_use"), render: p => (p.isTotal ? p.label : (p.n ? catChip(p.cat) : `<span class="cvx-na">${esc(p.cat)}</span>`)) },
        { key: "n", label: t("cvx_total"), cls: "num", render: p => (p.n ? `<b>${fmtNum(p.n)}</b>` : na()) },
        { key: "share", label: t("cvx_ratio"), cls: "num", render: p => (p.n ? pct(share(p.n, n)) : na()) },
        { key: "mix", label: t("cvx_brand_mix"), render: p => (p.n ? stack(p.rows) : na()) },
        ...[0, 1, 2].map(i => ({ key: `p${i}`, label: `${t("cvx_rank_fmt", { n: i + 1 })}`, render: p => (p.n ? place(p.podium[i], p.n) : na()) })),
        { key: "mb", label: t("cvx_mb"), cls: "num", render: p => (p.mb ? `<b>${fmtNum(p.mb.n)}</b>` : `<span class="cvx-na">0</span>`) },
        { key: "mbr", label: t("cvx_mb_rank"), render: p => (p.n ? mbChip(p) : na()) },
      ],
      rows: perCat.map(p => ({ ...p, hi: p.mbSole1 })),
      pinned: [{
        isTotal: true, cls: "sum", label: `${t("cvx_total")} (${esc(axle)} · ${range})`, rows, n,
        podium: totalPodium, mb: totalMb, mbSole1: !!totalMb && totalMb.rank === 1 && !totalMb.tied,
      }],
    });
  }

  // ---- panels ---------------------------------------------------------------
  const stackCats = [...CAT_STACK_ORDER.filter(c => cats.includes(c)), ...cats.filter(c => !CAT_STACK_ORDER.includes(c))];
  const catSegs = (rs) => stackCats.map(c => ({
    label: c, n: rs.filter(r => r.cat === c).length, color: catColor(c),
    fg: ["탑차", "덤프", "전문수송류"].includes(c) ? "#111827" : "#fff",
  }));
  const axleLines = axleList.map(a => {
    const rs = scope.filter(r => axleFn(r) === a);
    const hi = a === axle;
    return `<div class="lbl${hi ? " strong hi" : ""}">${esc(a)}</div>
      <div class="${hi ? "hi" : ""}">${stackedBar100(catSegs(rs), { height: 24, labeled: true })}</div>
      <div class="val${hi ? " hi" : ""}">${fmtNum(rs.length)}</div>`;
  }).join("");

  // Which axles are cargo trucks and which one spreads into bodies: computed,
  // so the sentence follows the data rather than the spec's example.
  // Axles under 5% of the scope are left out: 7 units of 6X6 would otherwise
  // be "the spread axle".
  const cargoShare = axleList.map(a => {
    const rs = scope.filter(r => axleFn(r) === a);
    return { a, rs, p: rs.length ? share(rs.filter(r => r.cat === "카고").length, rs.length) : null };
  }).filter(x => x.p !== null && x.rs.length >= scope.length * 0.05);
  let sentence = "";
  if (cargoShare.length) {
    const low = [...cargoShare].sort((x, y) => x.p - y.p)[0];
    const heavy = cargoShare.filter(x => x.p >= 50 && x.a !== low.a).map(x => x.a);
    const spread = ranked(countBy(low.rs.filter(r => r.cat !== "카고"), r => r.cat), cats).slice(0, 3).map(e => e.key);
    sentence = t("cvx_axle_sentence", {
      heavy: heavy.length ? heavy.join("·") : "–", low: low.a, spread: spread.join("·") || "–", p: dec1(low.p),
    });
  }

  const leaders = perCat.filter(p => p.n).map(p => {
    const list = ranked(countBy(p.rows, r => r.bb));
    const pod = podium(list);
    const cell = (x) => (x ? x.keys.map(k => `<a href="${linkTo("bb-detail.html", {
      year: s.year, month: s.month, oem: s.oem, axleMode: s.axleMode, axle, bb: k,
    })}">${esc(k)}</a>`).join(" · ") + ` ${fmtNum(x.n)}` : na());
    return `<tr><td>${catChip(p.cat)}</td>${pod.map(x => `<td class="wrap">${cell(x)}</td>`).join("")}</tr>`;
  }).join("");

  // Brand share moves on this axle, and MB's move split by use: each use's
  // MB units over the axle total, this year less last — the parts sum to the
  // headline pp.
  let divBody = empty(t("cvx_no_prev"));
  if (prevRows && prevRows.length && n) {
    const pb = countBy(prevRows, r => r.brand), cb = countBy(rows, r => r.brand);
    const keys = brands.filter(b => cb.get(b) || pb.get(b));
    const moves = keys.map(b => ({ label: b, value: share(cb.get(b) || 0, n) - share(pb.get(b) || 0, prevRows.length), strong: b === MB }))
      .sort((a, b) => b.value - a.value);
    const parts = cats.map(c => ({
      c, v: share(rows.filter(r => r.cat === c && r.brand === MB).length, n) -
        share(prevRows.filter(r => r.cat === c && r.brand === MB).length, prevRows.length),
    })).filter(x => Math.abs(x.v) >= 0.05).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 3);
    divBody = divergingBar(moves, { scale: divergeScale(moves.map(m => m.value), { floor: 2 }) }) +
      footnote(`${t("cvx_mb_change_by_use")}: ${parts.length
        ? parts.map(x => `${esc(x.c)} ${x.v > 0 ? "+" : ""}${dec1(x.v)}pp`).join(" · ") : "–"}`);
  }

  document.getElementById("panels").innerHTML = [
    card({
      title: t("cvx_panel_axle_cat"), aside: `${range} · 100%`,
      body: scope.length ? `${legend(catSegs(scope).map(x => ({ ...x, n: undefined })))}<div class="cvx-rows">${axleLines}</div>${footnote(sentence)}`
        : empty(t("cvx_empty")),
    }),
    card({
      title: `${esc(axle)} ${t("cvx_panel_top_bb_by_use")}`,
      body: leaders ? `<div class="cvx-scroll"><table class="cvx-table">
          <thead><tr><th>${t("cvx_use")}</th><th>${t("cvx_rank_fmt", { n: 1 })}</th><th>${t("cvx_rank_fmt", { n: 2 })}</th><th>${t("cvx_rank_fmt", { n: 3 })}</th></tr></thead>
          <tbody>${leaders}</tbody></table></div>${footnote(t("cvx_bb_click"))}` : empty(t("cvx_empty")),
    }),
    card({ title: `${t("cvx_panel_brand_change")} · ${esc(axle)} ${t("cvx_vs_ly")} (pp)`, body: divBody }),
  ].join("");
});
