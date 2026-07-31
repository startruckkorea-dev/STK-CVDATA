// Number / percentage / delta formatters.
// Ports utils/kaida_processor.py::fmt_num/fmt_pct/delta_html.

export const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const MONTHS_KR = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

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
