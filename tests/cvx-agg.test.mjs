// node --test tests/
// Aggregation for the CV DATA 특장·가격 pages (docs/js/cvx/agg.js).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeRows, foldMinorBrands, orderWith, catOrder, axleOrder, axleGroupOf, axleKeys,
  brandOrder, periodOf, filterRows, countBy, pivot, monthly, movingAvg3, share, ppDiff,
  yoy, pctChange, ranked, withRanks, podium, bbRanking, priceStats, dispersion,
  rangeAxis, divergeScale, countAxis,
} from "../docs/js/cvx/agg.js";
import { CAT_ORDER, AXLE_ORDER, OTHER_IMPORT, OTHER_DOMESTIC, MB } from "../docs/js/cvx/schema.js";

// The spec's worked example: 차종(대분류) × 브랜드 over all brands, and
// 차종 × Axle over the import brands. Rows are rebuilt from those two tables
// so the pivot can be checked against them cell for cell.
//
// The two tables do not quite agree: imports total 364 in the first
// (환경관련류 25) but 362 in the second (환경관련류 23). Two import rows must
// carry an axle outside the six; they are given none here, and the pivot has
// to keep them rather than drop them.
const BRANDS = ["만", "벤츠", "볼보", "스카니아", "이베코", "이스즈", "타타대우모빌리티", "현대"];
const IMPORT = new Set(["만", "벤츠", "볼보", "스카니아", "이베코", "이스즈"]);
const BY_BRAND = {
  덤프: [0, 0, 0, 0, 0, 0, 1, 0],
  전문수송류: [0, 0, 2, 0, 1, 0, 12, 100],
  카고: [106, 76, 61, 32, 9, 0, 716, 1171],
  탑차: [7, 15, 14, 11, 0, 0, 70, 69],
  특수: [0, 0, 5, 0, 0, 0, 53, 336],
  환경관련류: [2, 2, 15, 2, 2, 2, 8, 675],
};
const IMPORT_AXLE = {
  덤프: [0, 0, 0, 0, 0, 0],
  전문수송류: [0, 0, 2, 0, 0, 1],
  카고: [6, 1, 188, 6, 24, 59],
  탑차: [0, 0, 1, 3, 28, 15],
  특수: [0, 0, 0, 0, 5, 0],
  환경관련류: [0, 0, 0, 0, 21, 2],
};

function specRows() {
  const rows = [];
  for (const cat of CAT_ORDER) {
    // Import rows take their axles from the second table, in order.
    const axles = [];
    IMPORT_AXLE[cat].forEach((n, i) => { for (let k = 0; k < n; k++) axles.push(AXLE_ORDER[i]); });
    BY_BRAND[cat].forEach((n, bi) => {
      const brand = BRANDS[bi];
      for (let k = 0; k < n; k++) {
        rows.push({
          m: (rows.length % 9) + 1, brandRaw: brand, brand, imp: IMPORT.has(brand),
          model: "M", axle: IMPORT.has(brand) ? (axles.shift() ?? null) : "4X2",
          cat, sub: null, bb: `업체${rows.length % 20}`, price: 100, priceWon: 1e8,
        });
      }
    });
  }
  return rows;
}

function assertBalanced(p) {
  const rowSum = p.rowKeys.reduce((s, k) => s + p.rowTotal(k), 0);
  const colSum = p.colKeys.reduce((s, k) => s + p.colTotal(k), 0);
  assert.equal(rowSum, p.total);
  assert.equal(colSum, p.total);
}

test("pivot reproduces the spec's 차종 × 브랜드 table", () => {
  const rows = specRows();
  const p = pivot(rows, r => r.cat, r => r.brand, CAT_ORDER, BRANDS);
  for (const cat of CAT_ORDER) {
    BRANDS.forEach((b, i) => assert.equal(p.cell(cat, b), BY_BRAND[cat][i], `${cat}/${b}`));
  }
  assert.equal(p.total, 3575);
  assert.equal(p.rowTotal("카고"), 2171);
  assert.equal(p.colTotal("현대"), 2351);
  assertBalanced(p);
});

test("pivot reproduces the spec's import 차종 × Axle table", () => {
  const rows = filterRows(specRows(), { oem: "import" });
  const p = pivot(rows, r => r.cat, r => r.axle, CAT_ORDER, AXLE_ORDER);
  assert.equal(AXLE_ORDER.reduce((s, a) => s + p.colTotal(a), 0), 362);
  assert.equal(p.colTotal(null), 2);
  assert.equal(p.total, 364);
  assert.equal(p.cell("카고", "6X2"), 188);
  assert.equal(p.colTotal("8X4"), 78);
  assert.equal(p.rowTotal("탑차"), 47);
  assert.equal(p.rowTotal("환경관련류"), 25);
  assertBalanced(p);
});

test("pivots balance over all / import / domestic", () => {
  const rows = specRows();
  for (const oem of ["all", "import", "domestic"]) {
    const rs = filterRows(rows, { oem });
    assertBalanced(pivot(rs, r => r.cat, r => r.brand, CAT_ORDER, BRANDS));
    assertBalanced(pivot(rs, r => r.cat, r => r.axle, CAT_ORDER, AXLE_ORDER));
    assertBalanced(pivot(rs, r => r.cat, r => axleGroupOf(r.axle), CAT_ORDER, []));
  }
  assert.equal(filterRows(rows, { oem: "import" }).length + filterRows(rows, { oem: "domestic" }).length, 3575);
});

test("pivot keeps rows whose key was not listed", () => {
  const rows = [{ cat: "탱크로리", axle: "6X6" }, { cat: "카고", axle: "4X2" }];
  const p = pivot(rows, r => r.cat, r => r.axle, ["카고"], ["4X2"]);
  assert.deepEqual(p.rowKeys, ["카고", "탱크로리"]);
  assert.deepEqual(p.colKeys, ["4X2", "6X6"]);
  assertBalanced(p);
});

test("axle groups: 6X2군 = 4X2 + 4X4 + 6X2, an unlisted axle stands alone", () => {
  const rows = filterRows(specRows(), { oem: "import" });
  const detail = countBy(rows, r => r.axle);
  const group = countBy(rows, r => axleGroupOf(r.axle));
  assert.equal(group.get("6X2군"), (detail.get("4X2") || 0) + (detail.get("4X4") || 0) + (detail.get("6X2") || 0));
  assert.equal(group.get("8X4군"), (detail.get("6X4") || 0) + (detail.get("8X4") || 0));
  assert.equal(axleGroupOf("6X6"), "6X6");
  assert.deepEqual(axleKeys([...AXLE_ORDER, "6X6"], "group"), ["6X2군", "8X4군", "10X4군", "6X6"]);
  assert.equal(filterRows(rows, { axle: "6X2군", axleMode: "group" }).length, group.get("6X2군"));
});

test("orders put the spec's values first and the data's extras after", () => {
  const rows = [{ cat: "트랙터" }, { cat: "탱크로리" }, { cat: "탱크로리" }, { cat: "카고" }];
  assert.deepEqual(catOrder(rows), [...CAT_ORDER, "탱크로리", "트랙터"]);
  assert.deepEqual(axleOrder([{ axle: "6X6" }]), [...AXLE_ORDER, "6X6"]);
  assert.deepEqual(orderWith(["b"], ["a", "c", "c"]), ["b", "c", "a"]);
});

test("minor brands fold into 기타 on their own side", () => {
  const rows = [];
  const add = (brand, imp, n) => { for (let i = 0; i < n; i++) rows.push({ brandRaw: brand, imp }); };
  add("볼보", true, 300); add("마기루스", true, 2);
  add("현대", false, 900); add("기아", false, 5);
  foldMinorBrands(rows);
  const by = countBy(rows, r => r.brand);
  assert.equal(by.get(OTHER_IMPORT), 2);
  assert.equal(by.get(OTHER_DOMESTIC), 5);
  assert.equal(by.get("볼보"), 300);
  const o = brandOrder(rows);
  assert.deepEqual(o.imports, ["볼보", OTHER_IMPORT]);
  assert.deepEqual(o.domestics, ["현대", OTHER_DOMESTIC]);
});

test("decodeRows reads the columnar file and converts 원 to 백만원", () => {
  const json = {
    year: 2025, n: 3,
    dict: { brand: ["벤츠"], model: ["Arocs"], axle: ["8X4"], cat: ["탑차"], sub: ["윙바디"], bb: ["A"] },
    cols: {
      m: [1, 2, 9], brand: [0, 0, 0], imp: [1, 1, 1], model: [0, 0, 0], axle: [0, 0, 0],
      cat: [0, 0, 0], sub: [0, -1, 0], bb: [0, -1, 0], price: [163_100_000, 0, 98_500_000],
    },
  };
  const d = decodeRows(json);
  assert.equal(d.lastMonth, 9);
  assert.equal(d.rows[0].price, 163.1);
  assert.equal(d.rows[0].priceWon, 163_100_000);
  assert.equal(d.rows[1].price, null);
  assert.equal(d.rows[1].bb, null);
  assert.equal(d.rows[1].sub, null);
  assert.equal(filterRows(d.rows, { bodied: true }).length, 2);
});

test("period: YTD runs to the last month, a single month is itself", () => {
  assert.deepEqual(periodOf("ytd", 9), { mode: "ytd", from: 1, to: 9, sel: 9 });
  assert.deepEqual(periodOf(undefined, 9), { mode: "ytd", from: 1, to: 9, sel: 9 });
  assert.deepEqual(periodOf("4", 9), { mode: "month", from: 4, to: 4, sel: 4 });
  const rows = specRows();
  const ytd = filterRows(rows, periodOf("ytd", 9));
  const sum = [...Array(9).keys()].reduce((s, i) => s + filterRows(rows, periodOf(String(i + 1), 9)).length, 0);
  assert.equal(ytd.length, sum);
});

test("ratios, deltas and the missing-year case", () => {
  assert.equal(share(1, 4), 25);
  assert.equal(share(1, 0), null);
  assert.equal(ppDiff(12.5, 10), 2.5);
  assert.equal(ppDiff(12.5, null), null);
  assert.equal(yoy(110, 100), 10);
  assert.equal(yoy(5, 0), null);
  assert.ok(Math.abs(pctChange(109.8, 100) - 9.8) < 1e-9);
  assert.equal(pctChange(null, 100), null);
});

test("monthly and the 3-month average", () => {
  const rows = [{ m: 1 }, { m: 1 }, { m: 2 }, { m: 3 }, { m: 3 }, { m: 3 }];
  const s = monthly(rows, 3);
  assert.deepEqual(s.slice(0, 4), [2, 1, 3, null]);
  assert.deepEqual(movingAvg3(s).slice(0, 4), [null, null, 2, null]);
});

test("ties: the main item is the first in display order; ranks skip after a tie", () => {
  const counts = new Map([["탑차", 5], ["카고", 5], ["특수", 2]]);
  assert.equal(ranked(counts, CAT_ORDER)[0].key, "카고");
  const r = withRanks([{ key: "a", n: 5 }, { key: "b", n: 5 }, { key: "c", n: 2 }]);
  assert.deepEqual(r.map(e => [e.rank, e.tied]), [[1, true], [1, true], [3, false]]);
  const p = podium([{ key: "벤츠", n: 5 }, { key: "만", n: 5 }, { key: "볼보", n: 3 }]);
  assert.deepEqual(p[0].keys, ["벤츠", "만"]);
  assert.equal(p[1], null);
  assert.deepEqual(p[2].keys, ["볼보"]);
});

test("① ranking: top N + 기타 + 합계 = every registration, shares sum to 100", () => {
  const rows = specRows();
  const prev = rows.slice(0, 3000);
  const r = bbRanking(rows, prev, { topN: 12, MB, cats: CAT_ORDER, axleKeysList: AXLE_ORDER, axleMode: "detail" });
  const n = r.top.reduce((s, l) => s + l.n, 0) + (r.other ? r.other.n : 0);
  assert.equal(n, rows.length);
  assert.equal(r.total.n, rows.length);
  const sh = r.top.reduce((s, l) => s + l.share, 0) + (r.other ? r.other.share : 0);
  assert.ok(Math.abs(sh - 100) < 1e-9);
  assert.equal(r.other.count, 20 - 12);
  assert.equal(r.total.mb, 93);
  assert.equal(r.total.imp, 364);
  assert.equal(r.total.mainCat.key, "카고");
  assert.equal(r.active, 20);
  // pp moves of all lines net to zero against a full previous year
  const pp = r.top.reduce((s, l) => s + l.pp, 0) + r.other.pp;
  assert.ok(Math.abs(pp) < 1e-9);
  assert.equal(bbRanking(rows, null, { topN: 12, MB, cats: CAT_ORDER, axleKeysList: AXLE_ORDER }).top[0].pp, null);
});

test("price stats: median of an even N, nulls and zeros dropped", () => {
  assert.deepEqual(priceStats([null, 0, 4, 1, 3, 2]), { n: 4, min: 1, max: 4, median: 2.5, mean: 2.5 });
  assert.equal(priceStats([3, 1, 2]).median, 2);
  assert.equal(priceStats([null, 0]), null);
});

test("dispersion: groups of two or more, widest spread first", () => {
  const rows = [
    { k: "a", price: 100 }, { k: "a", price: 160 },
    { k: "b", price: 100 }, { k: "b", price: 110 }, { k: "b", price: null },
    { k: "c", price: 500 },
  ];
  const d = dispersion(rows, r => r.k);
  assert.deepEqual(d.map(g => g.key), ["a", "b"]);
  assert.equal(d[0].spread, 60);
  assert.equal(d[0].spreadPct, 60 / 130 * 100);
});

test("axes", () => {
  const a = rangeAxis(52, 410);
  assert.ok(a.min <= 52 && a.max >= 410);
  assert.equal(a.ticks.length, 5);
  assert.ok(a.step % 40 === 0 || a.step % 50 === 0);
  const b = rangeAxis(55, 70);
  assert.ok(b.min <= 55 && b.max >= 70 && b.ticks.length === 5);
  assert.equal(divergeScale([0.4, -1.6], { floor: 1, steps: [1, 2, 3] }), 2);
  assert.equal(divergeScale([], { floor: 2 }), 2);
  assert.equal(divergeScale([7.3], { floor: 5 }), 10);
  assert.deepEqual(countAxis(383), { max: 400, ticks: [0, 100, 200, 300, 400] });
});
