// Plotly.js chart helpers — direct port of utils/charts.py.
// Each function takes data + options and renders into the given DOM element.
// Assumes Plotly is loaded globally (from CDN <script> tag in HTML).

const BASE_LAYOUT = {
  template: "plotly_white",
  font: { family: "-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans KR, Roboto, sans-serif", size: 13 },
  margin: { l: 48, r: 24, t: 20, b: 36 },
  legend: { orientation: "h", y: -0.18, x: 0.5, xanchor: "center" },
  paper_bgcolor: "white",
  plot_bgcolor: "white",
};

const CONFIG = { responsive: true, displaylogo: false, displayModeBar: false };

const BRAND_COLORS = {
  MB: "#231F20", Volvo: "#1A3A82", Scania: "#D4122A", MAN: "#F7B731", IVECO: "#0097E6",
  Hyundai: "#1a56db", "Tata Daewoo": "#e04f2e",
  현대: "#1a56db", 타타대우모빌리티: "#e04f2e", 볼보: "#003057",
  스카니아: "#d4122a", 만: "#f7b731", 벤츠: "#888888",
  이스즈: "#c23616", 이베코: "#0097e6",
};

const SEGMENT_COLORS = {
  Tractor: "#808080", Cargo: "#1a56db", Tipper: "#e04f2e", Dump: "#e04f2e",
  트랙터: "#808080", 카고: "#1a56db", "덤프(건설기계)": "#e04f2e", 기타: "#c0c0c0",
};

function colorFor(label) {
  return BRAND_COLORS[label] || SEGMENT_COLORS[label] || null;
}

function mergeLayout(extra = {}) {
  return { ...BASE_LAYOUT, ...extra };
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
  Plotly.newPlot(el, [trace], mergeLayout({
    title, xaxis: { tickformat: valueFormat }, yaxis: { autorange: "reversed" },
    margin: { l: 120, r: 60, t: title ? 40 : 20, b: 36 },
  }), CONFIG);
}

export function verticalBar(el, { categories, values, color, title, valueFormat = "," }) {
  const trace = {
    type: "bar",
    x: categories,
    y: values,
    marker: { color: color || categories.map(colorFor) },
    text: values.map(v => v.toLocaleString()),
    textposition: "outside",
    cliponaxis: false,
  };
  Plotly.newPlot(el, [trace], mergeLayout({ title, yaxis: { tickformat: valueFormat } }), CONFIG);
}

export function groupedBar(el, { categories, series, title, barmode = "group" }) {
  const traces = series.map(s => ({
    type: "bar",
    name: s.name,
    x: categories,
    y: s.values,
    marker: { color: s.color || colorFor(s.name) },
  }));
  Plotly.newPlot(el, traces, mergeLayout({ title, barmode }), CONFIG);
}

export function stackedBar(el, { categories, series, title }) {
  return groupedBar(el, { categories, series, title, barmode: "stack" });
}

export function lineChart(el, { x, series, title, yLabel }) {
  const traces = series.map(s => ({
    type: "scatter",
    mode: "lines+markers",
    name: s.name,
    x,
    y: s.values,
    line: { color: s.color || colorFor(s.name), width: 2 },
    marker: { size: 6 },
  }));
  Plotly.newPlot(el, traces, mergeLayout({
    title,
    yaxis: { title: yLabel, tickformat: "," },
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
  Plotly.newPlot(el, traces, mergeLayout({ title }), CONFIG);
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
    textinfo: "label+percent",
  };
  Plotly.newPlot(el, [trace], mergeLayout({ title }), CONFIG);
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
  Plotly.newPlot(el, [trace], mergeLayout({ title }), CONFIG);
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
  Plotly.newPlot(el, [trace], mergeLayout({ title }), CONFIG);
}

export function heatmap(el, { x, y, z, title, colorscale = "Blues" }) {
  const trace = {
    type: "heatmap",
    x, y, z,
    colorscale,
    showscale: true,
    hovertemplate: "%{y} / %{x}: %{z:,}<extra></extra>",
  };
  Plotly.newPlot(el, [trace], mergeLayout({ title, margin: { l: 120, r: 24, t: title ? 40 : 20, b: 80 } }), CONFIG);
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
  Plotly.newPlot(el, traces, mergeLayout({ title, showlegend: false }), CONFIG);
}

export function histogram(el, { values, binSize, title }) {
  const trace = {
    type: "histogram",
    x: values,
    xbins: binSize ? { size: binSize } : undefined,
    marker: { color: "#1a56db" },
  };
  Plotly.newPlot(el, [trace], mergeLayout({ title }), CONFIG);
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
  Plotly.newPlot(el, [trace], mergeLayout({ title }), CONFIG);
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
  Plotly.newPlot(el, [...range, ...dots], mergeLayout({
    title,
    margin: { l: 200, r: 40, t: title ? 40 : 20, b: 36 },
    yaxis: { autorange: "reversed" },
  }), CONFIG);
}

export const colors = { BRAND_COLORS, SEGMENT_COLORS, colorFor };
