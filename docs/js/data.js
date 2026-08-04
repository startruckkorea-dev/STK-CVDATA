// Data fetcher — SharePoint is the ONLY source.
//
//   https://startruckkorea.sharepoint.com/sites/STK-PMM
//     → Shared Documents / mbtruck-cvdata / site_data / *.json
//
// Read straight from the browser with the signed-in user's delegated Graph
// token, so what everyone sees is whatever was last published there
// (tools/publish_data.py) — never a snapshot committed alongside the site.
//
// There is deliberately NO local fallback. A copy in the repo would be a
// second source of truth that silently goes stale, and this repo is public,
// so committing the numbers would publish them to anyone with the URL.
// When SharePoint can't be reached the pages say so instead of quietly
// rendering older figures.

import { graphAvailable, readJsonFile, SP_DATA_PATH } from "./graph.js";

const _cache = new Map();

let _ready = null;
let _failure = null;

/** "sharepoint" once reachable, null while unresolved or failed. */
export function dataSource() {
  return _failure ? null : (_ready ? "sharepoint" : null);
}

/** Why SharePoint is unreachable, if it is. */
export function dataSourceError() {
  return _failure;
}

/** When the loaded numbers were computed (manifest.generated_at), or null. */
export function generatedAt() {
  const m = _cache.get("manifest.json");
  return m && m.generated_at ? new Date(m.generated_at) : null;
}

// Anything derived from SharePoint that survives a reload belongs under this
// prefix, so "새로 고침" can drop all of it without knowing what wrote it.
// Nothing persists yet; the browser-side xlsx parse cache will.
const PERSIST_PREFIX = "cvdata.cache.";

/**
 * Drop every cached copy of the data and reload the page against SharePoint.
 *
 * A plain reload already refetches — the point of routing it through here is
 * that persisted caches get cleared too, so this stays the one button that
 * means "forget what you know" as more caching is added.
 */
export function refresh() {
  _cache.clear();
  _ready = null;
  _failure = null;
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(PERSIST_PREFIX)) localStorage.removeItem(k);
    }
  } catch (_) {
    // private mode / storage disabled — the in-memory clear still stands
  }
  window.location.reload();
}

/** Thrown for every load once the source is known to be unreachable, so each
 *  page surfaces the same actionable message rather than a raw Graph error. */
function sourceError(detail) {
  const e = new Error(
    "SharePoint 데이터를 읽을 수 없습니다 — " + detail +
    " (사이트: STK-PMM / mbtruck-cvdata/site_data)"
  );
  e.dataSource = true;
  return e;
}

/** Resolve the source once per page load by reading the manifest. */
async function ready() {
  if (_ready) return _ready;

  _ready = (async () => {
    let detail = null;
    if (!graphAvailable()) {
      detail = "Microsoft 계정으로 로그인되지 않았습니다";
    } else {
      try {
        const manifest = await readJsonFile("manifest.json", SP_DATA_PATH);
        if (!manifest) {
          // 404 — the folder or the file isn't there yet.
          detail = "site_data/manifest.json 이 없습니다. " +
                   "관리자가 [관리 → 데이터 발행] 에서 발행해야 합니다";
        } else {
          _cache.set("manifest.json", manifest);
        }
      } catch (e) {
        // 403 is the common one: signed in, but no access to the folder.
        detail = e.message;
      }
    }

    _failure = detail;
    document.dispatchEvent(new CustomEvent("datasource", {
      detail: {
        source: detail ? null : "sharepoint",
        error: detail,
        generatedAt: generatedAt(),
      },
    }));
    if (detail) throw sourceError(detail);
    return true;
  })();

  return _ready;
}

async function fetchJson(name) {
  if (_cache.has(name)) return _cache.get(name);
  await ready();

  const data = await readJsonFile(name, SP_DATA_PATH);
  if (data === null) throw sourceError(`site_data/${name} 이 없습니다`);
  _cache.set(name, data);
  return data;
}

export async function loadManifest() {
  return fetchJson("manifest.json");
}

export async function loadKaida(year) {
  return fetchJson(`kaida_${year}.json`);
}

export async function loadKama(year) {
  return fetchJson(`kama_${year}.json`);
}

export async function loadCvData(year) {
  return fetchJson(`cvdata_${year}.json`);
}

export async function loadKaidaPair(curYear) {
  // Always try to load previous year alongside current for YoY comparison.
  const cur = await loadKaida(curYear);
  let prev = null;
  try {
    prev = await loadKaida(curYear - 1);
  } catch (_) {
    prev = null;
  }
  return { cur, prev };
}
