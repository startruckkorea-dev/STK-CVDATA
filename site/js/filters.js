// Filter bar rendering — ports utils/kaida_processor.py::kaida_filters
// and utils/filters.py::apply_top_filters.

import { getState, setState } from "./state.js";
import { t, applyT } from "./i18n.js";

const MONTH_LABELS = ["YTD","1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

/**
 * Render a filter bar with the given fields.
 * @param {Element} root - container element
 * @param {Array} fields - each: { key, label, options: [{value, label}], default }
 * @param {Function} onChange - called whenever any select changes
 */
export function renderFilters(root, fields, onChange) {
  const state = getState();
  root.classList.add("filter-bar");
  root.innerHTML = fields.map(f => {
    const cur = state[f.key] ?? f.default ?? (f.options[0] && f.options[0].value);
    return `
      <div>
        <label for="filter-${f.key}" data-t="${f.label}">${f.label}</label>
        <select id="filter-${f.key}" data-key="${f.key}">
          ${f.options.map(o => `<option value="${o.value}" ${String(o.value) === String(cur) ? "selected" : ""}>${o.label}</option>`).join("")}
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

  applyT(root);
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
  if (includeAll) opts.unshift({ value: "ALL", label: "전체" });
  return opts;
}

export function segmentOptions(segList, includeAll = true) {
  const opts = segList.map(s => ({ value: s, label: s }));
  if (includeAll) opts.unshift({ value: "ALL", label: "전체" });
  return opts;
}
