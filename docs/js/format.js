// Number / percentage / delta formatters.
// Ports utils/kaida_processor.py::fmt_num/fmt_pct/delta_html.
import { t, getLang } from "./i18n.js";

export const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const MONTHS_KR = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
// Month axis labels for every trend / bar chart and month-column header:
// the same in Korean and English.
export const MONTH_NUM = MONTHS.map((_, i) => String(i + 1).padStart(2, "0"));

export function fmtNum(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return Number(v).toLocaleString("en-US");
}

export function fmtPct(v, withSign = false) {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  const s = (Math.round(v * 10) / 10).toFixed(1);
  if (withSign && v > 0) return `+${s}%`;
  return `${s}%`;
}

// Korean scale formatter (억 / 만) used in CV_DATA pages
export function fmtKoreanScale(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  const abs = Math.abs(n);
  if (abs >= 1_0000_0000) return `${(n / 1_0000_0000).toFixed(1)}억`;
  if (abs >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  return fmtNum(n);
}

/** Readable foreground for text drawn on `hex` — dark on light fills, white on dark. */
export function onColor(hex) {
  if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) return "white";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return brightness > 0.55 ? "#1f2328" : "white";
}

export function calcYoY(cur, prev) {
  if (!prev) return null;
  return ((cur - prev) / prev) * 100;
}

export function deltaSpan(v, opts = {}) {
  const { suffix = "%", neutralZero = true } = opts;
  if (v === null || v === undefined || Number.isNaN(v)) return `<span class="delta">-</span>`;
  if (neutralZero && v === 0) return `<span class="delta">0${suffix}</span>`;
  const cls = v > 0 ? "up" : "down";
  const sign = v > 0 ? "+" : "";
  // Percentage-point deltas are fractions too — round them like percentages
  // rather than printing the raw float ("-10.432pp").
  const val = suffix === "%" ? fmtPct(v) : (Math.round(v * 10) / 10).toFixed(1);
  return `<span class="delta ${cls}">${sign}${val.replace(/^\+/, "")}${suffix === "%" ? "" : suffix}</span>`;
}

export function rankDelta(cur, prev) {
  if (!cur || !prev) return null;
  return prev - cur; // positive = improved (lower rank number)
}

/**
 * KPI tiles split into a "YTD Performance" and a "Monthly Performance" group,
 * each under its own banner. `rowClass` is the tile grid the page already uses
 * (exec-kpis or kpi-row). Columns are weighted by tile count so every tile
 * across the row is the same width. Styles: .kpi-groups in style.css.
 */
export function kpiGroups(ytdTiles, monthTiles, rowClass = "kpi-row") {
  const group = (cls, head, tiles) => `
    <div class="kpi-group ${cls}">
      <div class="kpi-group-head">${head}</div>
      <div class="${rowClass}" style="--n:${tiles.length}">${tiles.join("")}</div>
    </div>`;
  return `<div class="kpi-groups" style="--kg-cols:${ytdTiles.length}fr ${monthTiles.length}fr">
    ${group("ytd", t("kpi_group_ytd"), ytdTiles)}
    ${group("month", t("kpi_group_month"), monthTiles)}
  </div>`;
}

/** Month name in the current language: "10월" / "Oct". */
export function monthName(m) {
  return getLang() === "en" ? MONTHS[m - 1] : `${m}월`;
}

/** Year-to-date span ending at month m: "1–10월" / "Jan–Oct". */
export function ytdSpan(m) {
  if (getLang() === "en") return m > 1 ? `${MONTHS[0]}–${MONTHS[m - 1]}` : MONTHS[0];
  return m > 1 ? `1–${m}월` : "1월";
}
