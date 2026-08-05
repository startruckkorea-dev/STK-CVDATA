// Plotly.js chart helpers — direct port of utils/charts.py.
// Each function takes data + options and renders into the given DOM element.
// Assumes Plotly is loaded globally (from CDN <script> tag in HTML).

import { onColor } from "./format.js";

const BASE_LAYOUT = {
  template: "plotly_white",
  font: { family: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans KR, Roboto, sans-serif", size: 13 },
  margin: { l: 48, r: 24, t: 20, b: 36 },
  legend: { orientation: "h", y: -0.18, x: 0.5, xanchor: "center" },
  paper_bgcolor: "white",
  plot_bgcolor: "white",
};

const CONFIG = { responsive: true, displaylogo: false, displayModeBar: false };

// Plotly's `responsive` only listens for WINDOW resizes, so a plot keeps the
// width it was born with when its container changes underneath it — which it
// does routinely here: the page grows past one screen and a scrollbar appears,
// the sidebar collapses at the 880px breakpoint, a filter row wraps. The plot
// is then wider than the box that holds it and overdraws the frame. Watch the
// element itself instead.
const _watched = new WeakSet();

function keepFitted(el) {
  if (!el || _watched.has(el) || typeof ResizeObserver === "undefined") return;
  _watched.add(el);
  let queued = false;
  new ResizeObserver(() => {
    if (queued) return;
    queued = true;
    // Coalesce to one resize per frame — a ResizeObserver that resizes its own
    // target can otherwise loop.
    requestAnimationFrame(() => {
      queued = false;
      if (el.isConnected) Plotly.Plots.resize(el);
    });
  }).observe(el);
}

/** Render, then keep the plot matched to its container for as long as it lives. */
function plot(el, traces, layout, config) {
  if (!el) return;
  Plotly.newPlot(el, traces, layout, config);
  keepFitted(el);
}

/**
 * Dashboard colour tokens. Every non-brand series on the KAIDA / KAMA charts
 * draws from this set so the deck reads as one system. Brand marks (MB, Volvo,
 * Scania, MAN, IVECO, Hyundai, Tata) keep their own identity colours below.
 */
export const TOKEN = {
  deepTeal: "#065A66",
  teal: "#0E96A0",
  mint: "#9BD4C4",
  amber: "#F0A500",
  burntOrange: "#C86A15",
  rust: "#B23A10",
};
/** Hover / border shades for the tokens above. */
export const TOKEN_DARK = {
  deepTeal: "#04434D",
  teal: "#0A7079",
  mint: "#63B89F",
  amber: "#B87E00",
  burntOrange: "#8F4C0F",
  rust: "#7E2A0B",
};

const BRAND_COLORS = {
  MB: "#231F20", Volvo: "#1A3A82", Scania: "#D4122A", MAN: "#F7B731", IVECO: "#0097E6",
  Hyundai: "#1a56db", "Tata Daewoo": "#e04f2e",
  현대: "#1a56db", 타타대우모빌리티: "#e04f2e", 볼보: "#003057",
  스카니아: "#d4122a", 만: "#f7b731", 벤츠: "#888888",
  이스즈: "#c23616", 이베코: "#0097e6",
};

const SEGMENT_COLORS = {
  Tractor: TOKEN.mint, Rigid: TOKEN.teal, Tipper: TOKEN.amber,
  Cargo: TOKEN.teal, Dump: TOKEN.amber,   // legacy keys, kept for old JSON
  트랙터: TOKEN.mint, 카고: TOKEN.teal, "덤프(건설기계)": TOKEN.amber, 기타: "#c0c0c0",
};

function colorFor(label) {
  return BRAND_COLORS[label] || SEGMENT_COLORS[label] || null;
}

// Filter-tile palettes. The chart greys are too pale to read as a selected
// state, so tiles carry the real brand / segment marks instead.
export const BRAND_TILE_COLORS = {
  ALL: TOKEN.deepTeal, MB: "#231F20", Volvo: "#1A3A82",
  Scania: "#D4122A", MAN: "#F7B731", IVECO: "#0097E6",
};
export const SEGMENT_TILE_COLORS = {
  ALL: TOKEN.deepTeal, Tractor: TOKEN.mint, Rigid: TOKEN.teal, Tipper: TOKEN.amber,
  // KAMA-only segments. Mixer takes the warm end of the ramp so it reads as a
  // body type beside Tipper; EV sits apart in the cool end — it is a drivetrain
  // split, not a body one.
  Mixer: TOKEN.burntOrange, EV: TOKEN.deepTeal,
};


// A title has to be given room, or Plotly centres it in a top margin too small
// to hold it and the glyph tops are cut off by the edge of the SVG. The base
// margin is sized for an untitled plot, so widen it whenever a title is set and
// the caller has not specified its own margins.
const TITLE_MARGIN_TOP = 48;

function mergeLayout(extra = {}) {
  const layout = { ...BASE_LAYOUT, ...extra };
  if (layout.title && !extra.margin) {
    layout.margin = { ...BASE_LAYOUT.margin, t: TITLE_MARGIN_TOP };
  }
  return layout;
}

// Every chart prints its values on the marks — the reports these pages replace
// are read on screen and in print, where hovering is not an option.
const LABEL_FONT = { size: 10 };

/** Format a value for an on-chart label. kind: "int" | "pct" | "pct1" */
export function labelText(v, kind = "int") {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  if (kind === "pct") return `${Math.round(v)}%`;
  if (kind === "pct1") return `${(Math.round(v * 10) / 10).toFixed(1)}%`;
  return Number(v).toLocaleString("en-US");
}

/** Zero-valued labels are noise on a dense chart — drop them. */
function labelsFor(values, kind, hideZero = true) {
  return values.map(v => (hideZero && !v ? "" : labelText(v, kind)));
}

export function horizontalBar(el, { categories, values, color, title, valueFormat = "," }) {
  const trace = {
    type: "bar",
    orientation: "h",
    y: categories,
    x: values,
    marker: { color: color || categories.map(colorFor) },
    text: values.map(v => v.toLocaleString()),
    textposition: "outside",
    cliponaxis: false,
  };
  plot(el, [trace], mergeLayout({
    title, xaxis: { tickformat: valueFormat }, yaxis: { autorange: "reversed" },
    margin: { l: 120, r: 60, t: title ? TITLE_MARGIN_TOP : 20, b: 36 },
  }), CONFIG);
}

export function verticalBar(el, { categories, values, color, title, valueFormat = ",", height }) {
  const trace = {
    type: "bar",
    x: categories,
    y: values,
    marker: { color: color || categories.map(colorFor) },
    text: values.map(v => v.toLocaleString()),
    textposition: "outside",
    textfont: LABEL_FONT,
    cliponaxis: false,
  };
  plot(el, [trace], mergeLayout({
    title, height, showlegend: false, yaxis: { tickformat: valueFormat },
  }), CONFIG);
}

export function groupedBar(el, {
  categories, series, title, barmode = "group", valueKind = "int",
  showlegend = true, height, yaxis, shapes, labelSize,
}) {
  const inside = barmode === "stack";
  const traces = series.map(s => ({
    type: "bar",
    name: s.name,
    x: categories,
    y: s.values,
    marker: { color: s.color || colorFor(s.name) },
    text: labelsFor(s.values, s.valueKind || valueKind),
    textposition: inside ? "inside" : "outside",
    textfont: labelSize ? { size: labelSize } : LABEL_FONT,
    insidetextanchor: inside ? "middle" : undefined,
    cliponaxis: false,
  }));
  plot(el, traces, mergeLayout({
    title, barmode, showlegend, height,
    uniformtext: { mode: "hide", minsize: 8 },
    ...(yaxis ? { yaxis } : {}),
    ...(shapes ? { shapes } : {}),
  }), CONFIG);
}

/** Grouped bars laid out horizontally — compact for narrow report columns. */
export function groupedBarH(el, {
  categories, series, valueKind = "int", showlegend = false, height, leftMargin = 74,
}) {
  const traces = series.map(s => ({
    type: "bar",
    orientation: "h",
    name: s.name,
    y: categories,
    x: s.values,
    marker: { color: s.color || colorFor(s.name) },
    text: labelsFor(s.values, s.valueKind || valueKind, false),
    textposition: "outside",
    textfont: LABEL_FONT,
    cliponaxis: false,
  }));
  const max = Math.max(1, ...series.flatMap(s => s.values.map(v => v || 0)));
  plot(el, traces, mergeLayout({
    height, showlegend,
    margin: { l: leftMargin, r: 46, t: 6, b: 20 },
    barmode: "group",
    xaxis: { range: [0, max * 1.25], showticklabels: false, showgrid: false, zeroline: false },
    yaxis: { autorange: "reversed", tickfont: { size: 10 } },
    uniformtext: { mode: "hide", minsize: 8 },
  }), CONFIG);
}

export function stackedBar(el, {
  categories, series, title, valueKind = "int", height, yaxis, shapes, labelSize,
}) {
  return groupedBar(el, {
    categories, series, title, barmode: "stack", valueKind, height, yaxis, shapes, labelSize,
  });
}

export function lineChart(el, { x, series, title, yLabel, valueKind = "int" }) {
  const traces = series.map(s => ({
    type: "scatter",
    mode: "lines+markers+text",
    name: s.name,
    x,
    y: s.values,
    line: { color: s.color || colorFor(s.name), width: 2 },
    marker: { size: 6 },
    text: labelsFor(s.values, s.valueKind || valueKind),
    textposition: "top center",
    textfont: LABEL_FONT,
    cliponaxis: false,
  }));
  plot(el, traces, mergeLayout({
    title,
    yaxis: { title: yLabel, tickformat: "," },
  }), CONFIG);
}

/**
 * Horizontal 100% stacked bar — one row per period, one segment per brand,
 * each labelled with its volume and share. This is the "Total Market" band at
 * the top of the printed market report.
 */
export function shareBandH(el, {
  rows, keys, values, colors, height = 150, showRowTotals = false,
}) {
  // rows: ["Y2025","Y2024"]; values: {key: [rowValues...]}
  const totals = rows.map((_, i) => keys.reduce((a, k) => a + (values[k][i] || 0), 0));
  const traces = keys.map(k => {
    const fill = (colors && colors[k]) || colorFor(k);
    return {
      type: "bar",
      orientation: "h",
      name: k,
      y: rows,
      x: values[k].map((v, i) => (totals[i] ? (v / totals[i]) * 100 : 0)),
      marker: { color: fill },
      text: values[k].map((v, i) =>
        totals[i] && v ? `${labelText(v)}<br>(${labelText((v / totals[i]) * 100, "pct1")})` : ""),
      textposition: "inside",
      insidetextanchor: "middle",
      // White on the pale competitor greys is unreadable — pick per-bar contrast.
      textfont: { size: 15, color: onColor(fill) },
      hovertemplate: `%{y} · ${k}: %{text}<extra></extra>`,
    };
  });
  // Row totals sit just past the end of each band rather than in a caption line.
  const annotations = showRowTotals ? rows.map((r, i) => ({
    x: 100, y: r, xref: "x", yref: "y",
    text: `<b>${labelText(totals[i])}</b>`,
    showarrow: false, xanchor: "left", xshift: 8,
    font: { size: 16, color: "#1f2328" },
  })) : [];
  plot(el, traces, mergeLayout({
    barmode: "stack",
    height,
    showlegend: false,          // the page renders its own compact brand legend
    margin: { l: 66, r: showRowTotals ? 76 : 16, t: 8, b: 20 },
    xaxis: { range: [0, 100], showticklabels: false, showgrid: false, zeroline: false },
    yaxis: { autorange: "reversed", tickfont: { size: 15 } },
    // No uniformtext: it would shrink every label to fit the narrowest slice.
    // Per-bar autoshrink keeps the big segments at full size.
    annotations,
  }), CONFIG);
}

/**
 * Bars on the left axis with one or more lines on a right percentage axis —
 * the "SoM glide path" shape: monthly volume vs. share trend.
 */
export function comboBarLine(el, {
  x, bars, lines, height, yLabel, y2Label = "%", title, labelSize,
}) {
  const font = labelSize ? { size: labelSize } : LABEL_FONT;
  const barTraces = bars.map(b => ({
    type: "bar",
    name: b.name,
    x,
    y: b.values,
    marker: { color: b.color || colorFor(b.name) },
    text: labelsFor(b.values, b.valueKind || "int"),
    textposition: "outside",
    textfont: font,
    cliponaxis: false,
  }));
  // A line with `axis: "y"` shares the bars' unit axis — totals overlaid on the
  // brand bars. Anything else rides the right-hand percentage axis.
  const lineTraces = lines.map(l => ({
    type: "scatter",
    mode: "lines+markers+text",
    name: l.name,
    x,
    y: l.values,
    yaxis: l.axis === "y" ? "y" : "y2",
    line: { color: l.color || "#231F20", width: l.width || 2, dash: l.dash },
    marker: { size: l.markerSize || 6, symbol: l.symbol },
    text: labelsFor(l.values, l.valueKind || "pct1"),
    textposition: l.textposition || "top center",
    textfont: { size: labelSize || 10, color: l.color || "#231F20" },
    cliponaxis: false,
  }));
  const useY2 = lines.some(l => l.axis !== "y");
  plot(el, [...barTraces, ...lineTraces], mergeLayout({
    title,
    height,
    barmode: "group",
    yaxis: { title: yLabel, tickformat: "," },
    ...(useY2 ? {
      yaxis2: { title: y2Label, overlaying: "y", side: "right", ticksuffix: "%", showgrid: false, rangemode: "tozero" },
    } : {}),
    margin: { l: 52, r: useY2 ? 56 : 24, t: title ? 40 : 16, b: 36 },
  }), CONFIG);
}

export function areaChart(el, { x, series, title, stacked = true }) {
  const traces = series.map(s => ({
    type: "scatter",
    mode: "lines",
    name: s.name,
    x,
    y: s.values,
    stackgroup: stacked ? "one" : undefined,
    line: { color: s.color || colorFor(s.name), width: 1 },
    fillcolor: s.color || colorFor(s.name),
  }));
  plot(el, traces, mergeLayout({ title }), CONFIG);
}

export function pieChart(el, { labels, values, title, hole = 0 }) {
  const colors = labels.map(colorFor);
  const trace = {
    type: "pie",
    labels,
    values,
    marker: { colors: colors.every(c => c) ? colors : undefined },
    hole,
    textposition: "outside",
    textinfo: "label+value+percent",
    texttemplate: "%{label}<br>%{value:,} (%{percent})",
  };
  plot(el, [trace], mergeLayout({ title }), CONFIG);
}

export function donutChart(el, args) { return pieChart(el, { ...args, hole: 0.45 }); }

export function treemap(el, { labels, parents, values, title }) {
  const trace = {
    type: "treemap",
    labels,
    parents,
    values,
    branchvalues: "total",
    textinfo: "label+value+percent parent",
  };
  plot(el, [trace], mergeLayout({ title }), CONFIG);
}

export function sunburst(el, { labels, parents, values, title }) {
  const trace = {
    type: "sunburst",
    labels,
    parents,
    values,
    branchvalues: "total",
    textinfo: "label+value+percent parent",
  };
  plot(el, [trace], mergeLayout({ title }), CONFIG);
}

export function heatmap(el, { x, y, z, title, colorscale = "Blues" }) {
  const trace = {
    type: "heatmap",
    x, y, z,
    colorscale,
    showscale: true,
    hovertemplate: "%{y} / %{x}: %{z:,}<extra></extra>",
  };
  plot(el, [trace], mergeLayout({ title, margin: { l: 120, r: 24, t: title ? TITLE_MARGIN_TOP : 20, b: 80 } }), CONFIG);
}

export function boxPlot(el, { categories, data, title }) {
  // data: { [category]: [values...] }
  const traces = categories.map(c => ({
    type: "box",
    name: c,
    y: data[c] || [],
    boxpoints: "outliers",
    marker: { color: colorFor(c) },
  }));
  plot(el, traces, mergeLayout({ title, showlegend: false }), CONFIG);
}

export function histogram(el, { values, binSize, title }) {
  const trace = {
    type: "histogram",
    x: values,
    xbins: binSize ? { size: binSize } : undefined,
    marker: { color: "#1a56db" },
  };
  plot(el, [trace], mergeLayout({ title }), CONFIG);
}

export function scatter(el, { x, y, text, size, color, title }) {
  const trace = {
    type: "scatter",
    mode: "markers+text",
    x, y, text,
    textposition: "top center",
    marker: {
      size: size || 10,
      color: Array.isArray(color) ? color : color || "#1a56db",
      line: { color: "white", width: 1 },
    },
  };
  plot(el, [trace], mergeLayout({ title }), CONFIG);
}

// Lollipop / min-max chart — ports utils/charts.py::min_max_chart
export function minMaxChart(el, { labels, mins, maxs, means, medians, title }) {
  const range = labels.map((_, i) => ({
    type: "scatter",
    mode: "lines",
    x: [mins[i], maxs[i]],
    y: [labels[i], labels[i]],
    line: { color: "#1a56db", width: 4 },
    showlegend: false,
    hoverinfo: "skip",
  }));
  const dots = [
    {
      type: "scatter", mode: "markers", name: "Min",
      x: mins, y: labels,
      marker: { symbol: "circle", color: "#1a56db", size: 10 },
    },
    {
      type: "scatter", mode: "markers", name: "Max",
      x: maxs, y: labels,
      marker: { symbol: "circle", color: "#1a56db", size: 10 },
    },
  ];
  if (means) dots.push({
    type: "scatter", mode: "markers", name: "Avg",
    x: means, y: labels,
    marker: { symbol: "diamond", color: "#e04f2e", size: 11 },
  });
  if (medians) dots.push({
    type: "scatter", mode: "markers", name: "Median",
    x: medians, y: labels,
    marker: { symbol: "line-ns", color: "#231F20", size: 14, line: { width: 2 } },
  });
  plot(el, [...range, ...dots], mergeLayout({
    title,
    margin: { l: 200, r: 40, t: title ? TITLE_MARGIN_TOP : 20, b: 36 },
    yaxis: { autorange: "reversed" },
  }), CONFIG);
}

export const colors = { BRAND_COLORS, SEGMENT_COLORS, colorFor };
