// Plotly.js chart helpers — direct port of utils/charts.py.
// Each function takes data + options and renders into the given DOM element.
// Assumes Plotly is loaded globally (from CDN <script> tag in HTML).

import { onColor } from "./format.js";
import { loadingFinish } from "./loading.js";

const BASE_LAYOUT = {
  template: "plotly_white",
  font: { family: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans KR, Roboto, sans-serif", size: 17 },
  // Sized for the 15px axis ticks — Plotly clips a tick label at the margin
  // rather than growing the plot to fit it.
  margin: { l: 58, r: 24, t: 20, b: 42 },
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
  // The first chart on the page is the honest signal that the wait is over —
  // every other chart of that render pass draws in the same tick.
  loadingFinish();
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
// are read on screen and in print, where hovering is not an option, so the
// labels are sized to be read at arm's length rather than to fit the densest
// chart.
const LABEL_SIZE = 17;
const LABEL_FONT = { size: LABEL_SIZE };

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
    margin: { l: 120, r: 60, t: title ? TITLE_MARGIN_TOP : 20, b: 42 },
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
  showlegend = true, height, yaxis, shapes, annotations, labelSize,
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
    // Plotly flips the legend for stacked bars so it matches the stack from
    // the top down. These stacks are read as a brand ranking, not as a
    // vertical order, so keep the legend in the order the series arrive.
    legend: { ...BASE_LAYOUT.legend, traceorder: "normal" },
    uniformtext: { mode: "hide", minsize: 8 },
    ...(yaxis ? { yaxis } : {}),
    ...(shapes ? { shapes } : {}),
    ...(annotations ? { annotations } : {}),
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
    yaxis: { autorange: "reversed", tickfont: { size: LABEL_SIZE } },
    uniformtext: { mode: "hide", minsize: 8 },
  }), CONFIG);
}

export function stackedBar(el, {
  categories, series, title, valueKind = "int", height, yaxis, shapes, annotations, labelSize,
}) {
  return groupedBar(el, {
    categories, series, title, barmode: "stack", valueKind, height, yaxis, shapes,
    annotations, labelSize,
  });
}

export function lineChart(el, {
  x, series, title, yLabel, valueKind = "int", height, labelSize,
}) {
  const font = labelSize ? { size: labelSize } : LABEL_FONT;
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
    textfont: { ...font, color: s.color || colorFor(s.name) },
    cliponaxis: false,
    connectgaps: false,
  }));
  const pct = valueKind === "pct" || valueKind === "pct1";
  plot(el, traces, mergeLayout({
    title,
    height,
    // A percentage axis reads as a share, not as a count: no thousands comma,
    // and no tick suffix either — every point already carries its own % label.
    yaxis: pct ? { title: yLabel } : { title: yLabel, tickformat: "," },
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
      textfont: { size: 19, color: onColor(fill) },
      hovertemplate: `%{y} · ${k}: %{text}<extra></extra>`,
    };
  });
  // Row totals sit just past the end of each band rather than in a caption line.
  const annotations = showRowTotals ? rows.map((r, i) => ({
    x: 100, y: r, xref: "x", yref: "y",
    text: `<b>${labelText(totals[i])}</b>`,
    showarrow: false, xanchor: "left", xshift: 8,
    font: { size: 20, color: "#1f2328" },
  })) : [];
  plot(el, traces, mergeLayout({
    barmode: "stack",
    height,
    showlegend: false,          // the page renders its own compact brand legend
    margin: { l: 66, r: showRowTotals ? 76 : 16, t: 8, b: 20 },
    xaxis: { range: [0, 100], showticklabels: false, showgrid: false, zeroline: false },
    yaxis: { autorange: "reversed", tickfont: { size: 19 } },
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
    textfont: { size: labelSize || LABEL_SIZE, color: l.color || "#231F20" },
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
    margin: { l: 62, r: useY2 ? 66 : 24, t: title ? 40 : 16, b: 42 },
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
    margin: { l: 200, r: 40, t: title ? TITLE_MARGIN_TOP : 20, b: 42 },
    yaxis: { autorange: "reversed" },
  }), CONFIG);
}

export const colors = { BRAND_COLORS, SEGMENT_COLORS, colorFor };

// ---- Executive dashboard ---------------------------------------------------
// The executive page reads shape, not digits: the exact numbers live in its
// KPI tiles and tables, so these three charts drop the on-mark labels the
// analysis charts carry and keep their frames quiet.

const EXEC_AXIS = { size: 12, color: "#6e7781" };

/**
 * Monthly trend — current year against prior year, plus an optional average.
 * `series`: { name, values, color, dash, width, markerSize, fill }. A series
 * with `fill` gets the ground under it shaded, which is what separates the
 * line being read from the ones it is measured against.
 */
export function trendLine(el, { x, series, height = 210 }) {
  const traces = series.map(s => ({
    type: "scatter",
    mode: "lines+markers",
    name: s.name,
    x,
    y: s.values,
    line: { color: s.color, width: s.width || 2, dash: s.dash, shape: "spline", smoothing: 0.5 },
    marker: { size: s.markerSize === 0 ? 0 : s.markerSize || 5 },
    ...(s.fill ? { fill: "tozeroy", fillcolor: s.fill } : {}),
    connectgaps: false,
    hovertemplate: `${s.name} %{x}: %{y:,}<extra></extra>`,
  }));
  plot(el, traces, mergeLayout({
    height,
    margin: { l: 44, r: 12, t: 30, b: 28 },
    legend: { orientation: "h", y: 1.2, x: 0, xanchor: "left", font: { size: 12 } },
    // tickangle 0: let the labels drop out rather than tip on their side and
    // run past the bottom of the card.
    xaxis: { tickfont: EXEC_AXIS, tickangle: 0, showgrid: false, automargin: false },
    yaxis: { tickfont: EXEC_AXIS, tickformat: ",", rangemode: "tozero", gridcolor: "#eef1f5" },
  }), CONFIG);
}

/**
 * Diverging horizontal bars around a shared zero — share gained / lost in
 * percentage points. Rows arrive already ordered; gains are drawn in the
 * positive colour, losses in the negative one.
 */
export function divergingBarH(el, {
  categories, values, height = 210, suffix = "pp",
  posColor = "#1f883d", negColor = "#d4122a", leftMargin = 120,
}) {
  const span = Math.max(0.5, ...values.map(v => Math.abs(v || 0)));
  const text = (v) => `${v > 0 ? "+" : ""}${(Math.round(v * 10) / 10).toFixed(1)}${suffix}`;
  const trace = {
    type: "bar",
    orientation: "h",
    y: categories,
    x: values,
    marker: { color: values.map(v => (v >= 0 ? posColor : negColor)) },
    cliponaxis: false,
    hoverinfo: "skip",
  };
  plot(el, [trace], mergeLayout({
    height,
    showlegend: false,
    // Room on the right for the value column; the bars themselves stay inside
    // the plot, so a narrow card cannot squeeze a label into the names.
    margin: { l: leftMargin, r: 56, t: 10, b: 26 },
    bargap: 0.42,
    xaxis: {
      range: [-span * 1.3, span * 1.3], zeroline: true, zerolinecolor: "#8c959f",
      zerolinewidth: 1, tickfont: EXEC_AXIS, ticksuffix: suffix, gridcolor: "#f2f4f7",
    },
    yaxis: { autorange: "reversed", tickfont: { size: 13, color: "#1f2328" } },
    // A label hung off the end of a bar runs into the category name as soon as
    // the card is narrow — and the bar pointing left is the one that has the
    // least room. Read the moves as a column at the right edge instead, where
    // they line up with each other and cannot collide with anything.
    annotations: categories.map((c, i) => ({
      xref: "paper", x: 1, xanchor: "left", xshift: 6,
      yref: "y", y: c, text: text(values[i]), showarrow: false,
      font: { size: 13, color: values[i] >= 0 ? posColor : negColor },
    })),
  }), CONFIG);
  gradientBars(el, "h", { reverse: [negColor] });
}

/**
 * Waterfall from a prior-period total to the current one, one step per brand.
 * `steps`: { label, value } in the order they should be walked; the two
 * absolute totals are added as the first and last bar.
 */
export function waterfall(el, {
  startLabel, startValue, endLabel, endValue, steps, height = 210,
  posColor = "#1f883d", negColor = "#d4122a", totalColor = "#d8dee4",
}) {
  const trace = {
    type: "waterfall",
    orientation: "v",
    measure: ["absolute", ...steps.map(() => "relative"), "total"],
    x: [startLabel, ...steps.map(s => s.label), endLabel],
    y: [startValue, ...steps.map(s => s.value), endValue],
    text: ["", ...steps.map(s => `${s.value > 0 ? "+" : ""}${Number(s.value).toLocaleString("en-US")}`), ""],
    textposition: "outside",
    textfont: { size: 13 },
    increasing: { marker: { color: posColor } },
    decreasing: { marker: { color: negColor } },
    totals: { marker: { color: totalColor } },
    connector: { line: { color: "#c9d1d9", width: 1, dash: "dot" } },
    cliponaxis: false,
    hovertemplate: "%{x}: %{y:,}<extra></extra>",
  };
  plot(el, [trace], mergeLayout({
    height,
    showlegend: false,
    margin: { l: 46, r: 12, t: 24, b: 30 },
    xaxis: { tickfont: { size: 12, color: "#6e7781" }, tickangle: 0, showgrid: false },
    // The bars only ever move a few hundred units around a ~2,000 base, so a
    // zero-based axis would flatten every step into the same nub.
    yaxis: { tickfont: EXEC_AXIS, tickformat: ",", gridcolor: "#eef1f5" },
  }), CONFIG);
  gradientBars(el, "v");
}

/**
 * Fade every bar in a rendered plot from its own colour toward white.
 *
 * Plotly has no gradient fill for bars — a trace marker takes one flat colour —
 * so the gradient is painted onto the SVG it produced: one <linearGradient>
 * per colour, dropped into the plot's own <defs>, then set as each bar's fill.
 * It re-runs on every redraw (resize, relayout), and if Plotly ever changes the
 * shape of its output the selector simply matches nothing and the bars stay
 * flat — which is the old look, not a broken one.
 *
 * @param {"v"|"h"} axis - direction the bars grow in.
 * @param {string[]} reverse - colours whose bars grow the other way (the
 *   losing half of a diverging chart), so their fade still starts at the
 *   zero line rather than at the tip.
 */
function gradientBars(el, axis = "v", { reverse = [] } = {}) {
  const flipped = new Set(reverse.map(rgbKey));
  const NS = "http://www.w3.org/2000/svg";

  const paint = () => {
    const svg = el.querySelector(".main-svg");
    if (!svg) return;
    let defs = svg.querySelector("defs.cv-grad");
    if (!defs) {
      defs = document.createElementNS(NS, "defs");
      defs.setAttribute("class", "cv-grad");
      svg.appendChild(defs);
    }
    const made = new Map();

    el.querySelectorAll(".barlayer .point path, .barlayer .point > path").forEach(path => {
      const fill = path.style.fill || path.getAttribute("fill");
      if (!fill || fill.startsWith("url(")) return;   // already faded
      let id = made.get(fill);
      if (!id) {
        const dir = axis === "h" && flipped.has(rgbKey(fill)) ? "h-rev" : axis;
        id = `cvg-${dir}-${Math.abs(hashColor(fill))}`;
        if (!defs.querySelector(`#${id}`)) defs.appendChild(makeGradient(NS, id, fill, dir));
        made.set(fill, id);
      }
      path.style.fill = `url(#${id})`;
    });
  };

  paint();
  // newPlot returns before the redraw hooks exist on a first render in some
  // browsers; the frame delay costs nothing and covers it.
  requestAnimationFrame(paint);
  if (el.on) el.on("plotly_afterplot", paint);
}

/** "#d4122a" and "rgb(212, 18, 42)" are the same colour — compare them as one. */
function rgbKey(color) {
  const hex = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(color).trim());
  if (hex) return hex.slice(1).map(h => parseInt(h, 16)).join(",");
  const rgb = /rgba?\(([^)]+)\)/i.exec(String(color));
  if (rgb) return rgb[1].split(",").slice(0, 3).map(n => parseInt(n, 10)).join(",");
  return String(color);
}

function hashColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** A gradient running along the bar: full colour at the base, 55% white at
 *  the tip. Horizontal bars also grow leftward, so both ends are lightened. */
function makeGradient(NS, id, color, axis) {
  const g = document.createElementNS(NS, "linearGradient");
  g.setAttribute("id", id);
  const [x1, y1, x2, y2] =
    axis === "v" ? [0, 1, 0, 0] : axis === "h-rev" ? [1, 0, 0, 0] : [0, 0, 1, 0];
  g.setAttribute("x1", x1); g.setAttribute("y1", y1);
  g.setAttribute("x2", x2); g.setAttribute("y2", y2);
  for (const [offset, opacity] of [["0%", 1], ["100%", 0.45]]) {
    const stop = document.createElementNS(NS, "stop");
    stop.setAttribute("offset", offset);
    stop.setAttribute("stop-color", color);
    stop.setAttribute("stop-opacity", opacity);
    g.appendChild(stop);
  }
  return g;
}
