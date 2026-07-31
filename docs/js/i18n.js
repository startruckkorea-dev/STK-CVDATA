// i18n loader — ko/en toggle, JSON-driven.
// Ports utils/i18n.py::t/tdata/tmap.

let _translations = null;
let _lang = localStorage.getItem("lang") || "ko";

export async function loadTranslations(url = "/i18n/translations.json") {
  if (_translations) return _translations;
  // Resolve relative to the site root regardless of page depth
  const root = document.documentElement.dataset.siteRoot || "..";
  const path = url.startsWith("/") ? `${root}${url}` : url;
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(res.statusText);
    _translations = await res.json();
  } catch (e) {
    console.warn("translations fetch failed", e);
    _translations = { ui: {}, enum: {} };
  }
  return _translations;
}

export function getLang() { return _lang; }
export function setLang(lang) {
  _lang = lang === "en" ? "en" : "ko";
  localStorage.setItem("lang", _lang);
  document.documentElement.lang = _lang;
  document.dispatchEvent(new CustomEvent("langchange", { detail: _lang }));
}

export function t(key, fmt = {}) {
  const ui = (_translations && _translations.ui) || {};
  const entry = ui[key];
  if (!entry) return key;
  let val = entry[_lang] || entry.en || entry.ko || key;
  for (const [k, v] of Object.entries(fmt)) {
    val = val.replace(new RegExp(`\\{${k}\\}`, "g"), v);
  }
  return val;
}

export function tdata(value, kind) {
  const en = (_translations && _translations.enum) || {};
  const bucket = en[kind] || {};
  const entry = bucket[value];
  if (!entry) return value;
  return entry[_lang] || entry.en || entry.ko || value;
}

export function applyT(root = document) {
  // <span data-t="key"></span>  ->  innerText = t("key")
  root.querySelectorAll("[data-t]").forEach(el => {
    el.textContent = t(el.dataset.t);
  });
  // <option data-tdata-kind="segment" value="Tractor">Tractor</option>
  root.querySelectorAll("[data-tdata-kind]").forEach(el => {
    const kind = el.dataset.tdataKind;
    const val = el.dataset.tdataValue || el.value || el.textContent;
    el.textContent = tdata(val, kind);
  });
  // <title data-t="page_overview"></title> — keep the site name in the tab,
  // which the plain t() replacement would otherwise drop.
  const titleEl = document.querySelector("title[data-t]");
  if (titleEl) {
    const page = t(titleEl.dataset.t);
    const app = t("app_title");
    document.title = page === app ? page : `${page} · ${app}`;
  }
}

document.addEventListener("langchange", () => applyT());
