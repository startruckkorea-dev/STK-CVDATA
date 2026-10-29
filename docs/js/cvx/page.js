// CV DATA 특장·가격 — what the four pages share: sign-in, data, the URL
// state, the filter bar and the period strings.

import { requireAdmin } from "../auth.js";
import { loadTranslations, applyT, t } from "../i18n.js";
import { renderSidebar } from "../sidebar.js";
import { loadManifest, loadCvRows } from "../data.js";
import { getState, setState, subscribe } from "../state.js";
import { decodeRows } from "./agg.js";
import { esc } from "./ui.js";

const _decoded = new Map();

/** Decoded rows of a year, or null when that year was not published. */
export async function rowsOf(year, years) {
  if (!years.includes(year)) return null;
  if (!_decoded.has(year)) _decoded.set(year, loadCvRows(year).then(decodeRows));
  return _decoded.get(year);
}

/**
 * Sign in, draw the chrome, then call render(ctx) now and on every change of
 * the URL (filters, back / forward) or the language. ctx: { years, state, set }.
 * `set(patch)` pushes a history entry, so back restores the previous filters.
 */
export async function bootPage(render) {
  if (!(await requireAdmin())) return;
  await loadTranslations();
  renderSidebar(window.location.pathname);
  applyT();

  const main = document.querySelector(".main");
  let years;
  try {
    const manifest = await loadManifest();
    years = (manifest.cv_rows_years || []).slice().sort((a, b) => b - a);
  } catch (e) {
    main.insertAdjacentHTML("afterbegin", `<div class="banner error">${esc(e.message)}</div>`);
    return;
  }
  if (!years.length) {
    main.insertAdjacentHTML("afterbegin", `<div class="banner warn">${t("cvx_no_rows")}</div>`);
    return;
  }

  const set = (patch) => setState(patch, { replace: false });
  let seq = 0;
  const run = async () => {
    const mine = ++seq;
    try {
      await render({ years, state: getState(), set, stale: () => mine !== seq });
    } catch (e) {
      console.error(e);
      main.insertAdjacentHTML("afterbegin", `<div class="banner error">${esc(e.message)}</div>`);
    }
  };
  subscribe(run);
  document.addEventListener("langchange", run);
  run();
}

// ---- filter bar -------------------------------------------------------------

/**
 * fields: [{ key, label, kind: "select" | "toggle" | "tabs" | "search",
 *            value, options: [{ value, label, sub }] }]
 * Each change goes to the URL as one history entry. `search` is a typed
 * select: an input over a datalist, settled when the text matches an option.
 */
export function filterBar(root, fields, set) {
  root.innerHTML = `<div class="cvx-filters">${fields.map(f => {
    const label = `<label>${f.label}</label>`;
    if (f.kind === "toggle" || f.kind === "tabs") {
      return `<div class="cvx-field ${f.kind}">${label}<div class="cvx-toggle" data-key="${f.key}">${f.options.map(o =>
        `<button type="button" data-value="${esc(o.value)}" class="${String(o.value) === String(f.value) ? "on" : ""}">
          ${esc(o.label)}${o.sub !== undefined ? `<small>${esc(o.sub)}</small>` : ""}</button>`).join("")}</div></div>`;
    }
    if (f.kind === "search") {
      const cur = f.options.find(o => String(o.value) === String(f.value));
      return `<div class="cvx-field wide">${label}
        <input type="search" data-key="${f.key}" list="dl-${f.key}" value="${esc(cur ? cur.label : "")}" autocomplete="off" />
        <datalist id="dl-${f.key}">${f.options.map(o => `<option value="${esc(o.label)}"></option>`).join("")}</datalist></div>`;
    }
    return `<div class="cvx-field">${label}<select data-key="${f.key}">${f.options.map(o =>
      `<option value="${esc(o.value)}"${String(o.value) === String(f.value) ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select></div>`;
  }).join("")}</div>`;

  root.querySelectorAll("select").forEach(el =>
    el.addEventListener("change", () => set({ [el.dataset.key]: el.value })));
  root.querySelectorAll(".cvx-toggle button").forEach(el =>
    el.addEventListener("click", () => set({ [el.parentElement.dataset.key]: el.dataset.value })));
  root.querySelectorAll("input[type=search]").forEach(el => {
    const f = fields.find(x => x.key === el.dataset.key);
    const settle = () => {
      const v = el.value.trim();
      const hit = f.options.find(o => o.label === v) || f.options.find(o => String(o.value) === v);
      if (hit) set({ [f.key]: hit.value });
    };
    el.addEventListener("change", settle);
    el.addEventListener("focus", () => el.select());
  });
}

// ---- options & labels -------------------------------------------------------

export const monthField = (value, lastMonth) => ({
  key: "month", label: t("filter_month"), kind: "select", value: value ?? "ytd",
  options: [{ value: "ytd", label: `YTD (1–${lastMonth}${t("cvx_month_suffix")})` },
    ...Array.from({ length: lastMonth }, (_, i) => ({ value: String(i + 1), label: `${i + 1}${t("cvx_month_suffix")}` }))],
});

export const yearField = (value, years) => ({
  key: "year", label: t("filter_year"), kind: "select", value,
  options: years.map(y => ({ value: String(y), label: String(y) })),
});

export const oemField = (value) => ({
  key: "oem", label: t("cvx_oem"), kind: "select", value,
  options: [
    { value: "all", label: t("filter_all") },
    { value: "import", label: t("cvx_import_brands") },
    { value: "domestic", label: t("cvx_domestic") },
  ],
});

export const axleModeField = (value) => ({
  key: "axleMode", label: t("cvx_axle_mode"), kind: "toggle", value,
  options: [{ value: "detail", label: t("cvx_detail") }, { value: "group", label: t("cvx_group") }],
});

const mm = (m) => String(m).padStart(2, "0");

/** '2026.09 YTD' / 'vs 2025 YTD', or '2026.04' / 'vs 2025.04'. */
export function periodText(year, period) {
  if (period.mode === "ytd") {
    return { now: `${year}.${mm(period.to)} YTD`, vs: `vs ${year - 1} YTD`, short: `${year}.${mm(period.to)} YTD` };
  }
  return { now: `${year}.${mm(period.sel)}`, vs: `vs ${year - 1}.${mm(period.sel)}`, short: `${year}.${mm(period.sel)}` };
}

export const oemLabel = (oem) =>
  (oem === "import" ? t("cvx_import_brands") : oem === "domestic" ? t("cvx_domestic") : t("filter_all"));

/** The page URL with these query values — for drill-down links. */
export function linkTo(page, params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, v);
  return `${page}?${q.toString()}`;
}

/** Normalised state for the ①–③ pages: year, month, oem, cat, axleMode. */
export function baseState(s, years, defaults = {}) {
  const year = years.includes(parseInt(s.year, 10)) ? parseInt(s.year, 10) : years[0];
  return {
    year,
    month: s.month || "ytd",
    oem: ["all", "import", "domestic"].includes(s.oem) ? s.oem : (defaults.oem || "all"),
    cat: s.cat || "all",
    axleMode: s.axleMode === "group" ? "group" : "detail",
  };
}
