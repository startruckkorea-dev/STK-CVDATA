// CV DATA 특장·가격 pages — the one place their vocabulary is fixed.
//
// The rows come from cvrows_{year}.json (tools/build_site.py::build_cv_rows),
// whose keys map to the CV_DATA workbook headers:
//
//   m      최초등록연월 → month 1–12
//   brand  원제작사          imp    국산/외산 (1 = 외산)
//   model  상세모델명(국문)    axle   최종제작축
//   cat    용도 (차종 대분류)   sub    상세용도 (차종 세부)
//   bb     특장업체명          price  취득가 (원)
//
// Every category, axle, brand and bodybuilder shown is read from the data.
// The lists below only fix the ORDER and COLOUR of the values the spec names;
// a value the data has and these lists do not (탱크로리, 트랙터, 6X6 …) is
// still counted, shown after the named ones, and drawn in a fallback colour.

/** 차종(대분류) display order. Values not listed follow, by volume. */
export const CAT_ORDER = ["덤프", "전문수송류", "카고", "탑차", "특수", "환경관련류"];

/** Stacking order inside a 100% bar — the big ones first, so the eye lands on them. */
export const CAT_STACK_ORDER = ["카고", "탑차", "환경관련류", "특수", "전문수송류", "덤프"];

export const AXLE_ORDER = ["4X2", "4X4", "6X2", "6X4", "8X4", "10X4"];

/** Axle groups. An axle in none of them (6X6) is its own group. */
export const AXLE_GROUPS = [
  { key: "6X2군", members: ["4X2", "4X4", "6X2"] },
  { key: "8X4군", members: ["6X4", "8X4"] },
  { key: "10X4군", members: ["10X4"] },
];

/** The brand the pages are written for. */
export const MB = "벤츠";

/**
 * A brand under this share of its own side (수입 or 국산) of the year is
 * folded into 기타 수입 / 기타 국산, so a column of one-offs (마기루스 5대,
 * DULEVO 3대) does not widen every table.
 */
export const MINOR_BRAND_SHARE = 0.01;
export const OTHER_IMPORT = "기타 수입";
export const OTHER_DOMESTIC = "기타 국산";

export const TOP_N_BB = 12;        // ① ranking rows before 기타
export const MB_HIGHLIGHT_MIN = 10; // ① shade a bodybuilder with this many MB
export const TOP_N_MIX = 8;        // ① brand-mix panel rows
export const SMALL_SAMPLE = 3;     // ④ N under this → 표본 적음
export const DISPERSION_TOP = 10;  // ④ second card rows

export const COLOR = {
  navy: "#1e3a8a",
  bar: "#3b82f6",
  track: "#e9ecf1",
  amber: "#f59e0b",
  up: "#15803d",
  down: "#dc2626",
  muted: "#6b7280",
};

export const CAT_COLOR = {
  카고: "#1d4ed8", 탑차: "#f59e0b", 환경관련류: "#0f766e",
  특수: "#6d28d9", 전문수송류: "#9ca3af", 덤프: "#d1d5db",
  // Not in the spec's palette: the data has them, so they get a colour.
  탱크로리: "#be185d", 트랙터: "#4b5563",
};
export const CAT_FALLBACK = "#cbd5e1";

export const CAT_CHIP = {
  카고: ["#eaf0fe", "#1e3a8a"], 탑차: ["#fff4e0", "#92400e"],
  환경관련류: ["#e3f5f2", "#0f766e"], 특수: ["#f1ebfe", "#5b21b6"],
};
export const CAT_CHIP_DEFAULT = ["#f9fafb", "#374151"];

export const BRAND_COLOR = {
  벤츠: "#1f2937", 볼보: "#1d4ed8", 스카니아: "#dc2626", 만: "#f59e0b",
  이베코: "#0ea5e9", 이스즈: "#a855f7", 타타대우모빌리티: "#9ca3af", 현대: "#d1d5db",
  [OTHER_IMPORT]: "#93c5fd", [OTHER_DOMESTIC]: "#e5e7eb",
};
export const BRAND_FALLBACK = "#cbd5e1";

/** Heat-map steps: a cell at or above `min` takes the colour. */
export const HEAT_STEPS = [
  { min: 151, bg: "#6a9df0", bold: true },
  { min: 61, bg: "#93b8f6", bold: true },
  { min: 21, bg: "#b9d1fb" },
  { min: 6, bg: "#d8e6fd" },
  { min: 1, bg: "#eef4fe" },
];

export const catColor = (c) => CAT_COLOR[c] || CAT_FALLBACK;
export const brandColor = (b) => BRAND_COLOR[b] || BRAND_FALLBACK;
