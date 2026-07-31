// Filter bar rendering — ports utils/kaida_processor.py::kaida_filters
// and utils/filters.py::apply_top_filters.

import { getState, setState } from "./state.js";
import { t, applyT } from "./i18n.js";
import { onColor } from "./format.js";

const MONTH_LABELS = ["YTD","1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

/**
 * Render a filter bar with the given fields.
 * @param {Element} root - container element
 * @param {Array} fields - each: { key, label, options: [{value, label}], default,
 *   as: "select" | "tiles", colors: {value: hex} }
 *   `as: "tiles"` renders the options as clickable tiles instead of a <select>;
 *   `colors` tints each tile with its brand / segment colour when active.
 * @param {Function} onChange - called whenever any field changes
 */
export function renderFilters(root, fields, onChange) {
  const state = getState();
  root.classList.add("filter-bar");
  root.innerHTML = fields.map(f => {
    const cur = state[f.key] ?? f.default ?? (f.options[0] && f.options[0].value);
    // `tkind` opts the option labels into the enum dictionary, so segment names
    // follow the language toggle instead of showing the raw data value.
    const tag = (o) => {
      if (o.value === "ALL") return ` data-t="filter_all"`;
      return f.tkind ? ` data-tdata-kind="${f.tkind}" data-tdata-value="${o.value}"` : "";
    };

    if (f.as === "tiles") {
      const tiles = f.options.map(o => {
        const on = String(o.value) === String(cur);
        const fill = (f.colors && f.colors[o.value]) || "#136f7b";
        const style = `--tile:${fill};--tile-fg:${onColor(fill)}`;
        return `<button type="button" class="filter-tile${on ? " active" : ""}"
          style="${style}" data-key="${f.key}" data-value="${o.value}"
          aria-pressed="${on}"${tag(o)}>${o.label}</button>`;
      }).join("");
      return `
        <div class="filter-field tiles">
          <label data-t="${f.label}">${f.label}</label>
          <div class="tile-group" role="group" data-key="${f.key}">${tiles}</div>
        </div>
      `;
    }

    return `
      <div class="filter-field">
        <label for="filter-${f.key}" data-t="${f.label}">${f.label}</label>
        <select id="filter-${f.key}" data-key="${f.key}">
          ${f.options.map(o => `<option value="${o.value}"${tag(o)} ${String(o.value) === String(cur) ? "selected" : ""}>${o.label}</option>`).join("")}
        </select>
      </div>
    `;
  }).join("");

  root.querySelectorAll("select").forEach(sel => {
    sel.addEventListener("change", () => {
      setState({ [sel.dataset.key]: sel.value });
      onChange?.(getState());
    });
  });

  root.querySelectorAll(".filter-tile").forEach(btn => {
    btn.addEventListener("click", () => {
      const { key, value } = btn.dataset;
      // Repaint the group here rather than re-rendering the whole bar, which
      // would throw away the other fields' DOM (and their focus).
      btn.parentElement.querySelectorAll(".filter-tile").forEach(b => {
        const on = b === btn;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", String(on));
      });
      setState({ [key]: value });
      onChange?.(getState());
    });
  });

  applyT(root);
}

/**
 * Push the current state back into an already-rendered filter bar.
 * Call this from a page's render() so controls stay truthful when the state
 * changes from somewhere else — a tab click, or browser back / forward.
 */
export function syncFilters(root = document) {
  const state = getState();
  root.querySelectorAll(".filter-bar select").forEach(sel => {
    const v = state[sel.dataset.key];
    if (v !== undefined && sel.value !== String(v)) sel.value = String(v);
  });
  root.querySelectorAll(".filter-bar .tile-group").forEach(group => {
    const v = state[group.dataset.key];
    if (v === undefined) return;
    group.querySelectorAll(".filter-tile").forEach(b => {
      const on = String(b.dataset.value) === String(v);
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  });
}

/** Year option list given a manifest list of available years. */
export function yearOptions(years) {
  return years.map(y => ({ value: y, label: String(y) }));
}

/** Month option list: YTD + 1..12. */
export function monthOptions() {
  return MONTH_LABELS.map((label, i) => ({ value: i === 0 ? "YTD" : String(i), label }));
}

export function brandOptions(brandList, includeAll = true) {
  const opts = brandList.map(b => ({ value: b, label: b }));
  if (includeAll) opts.unshift({ value: "ALL", label: t("filter_all") });
  return opts;
}

export function segmentOptions(segList, includeAll = true) {
  const opts = segList.map(s => ({ value: s, label: s }));
  if (includeAll) opts.unshift({ value: "ALL", label: t("filter_all") });
  return opts;
}
