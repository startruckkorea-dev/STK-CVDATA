// Data fetcher — two sources, resolved once per page load.
//
//   1. SharePoint (preferred)  Shared Documents/mbtruck-cvdata/site_data/*.json
//      Read straight from the browser with the signed-in user's delegated
//      Graph token. Publishing new numbers is then a SharePoint upload
//      (tools/publish_data.py), not a git push — everyone sees it immediately.
//
//   2. Repo bundle (fallback)  docs/data/*.json committed alongside the site.
//      Used on localhost / *.github.io where there is no login, and whenever
//      a Graph call fails (no permission on the folder, network, 404).
//
// The probe runs ONCE: if site_data/manifest.json is unreachable we stay on the
// bundle for the rest of the page rather than paying a failing Graph round-trip
// per file.

import { graphAvailable, readJsonFile, SP_DATA_PATH } from "./graph.js";

const _cache = new Map();

/** "sharepoint" | "bundled" | null (not resolved yet) */
let _source = null;
let _probe = null;
let _sourceError = null;

function root() {
  return document.documentElement.dataset.siteRoot || ".";
}

/** Which source the numbers on screen came from. Null until the first load. */
export function dataSource() {
  return _source;
}

/** Why SharePoint was skipped, if it was. Shown in the UI as a hint. */
export function dataSourceError() {
  return _sourceError;
}

async function fetchBundled(name) {
  const url = `${root()}/data/${name}`;
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status}`);
  return res.json();
}

/** Decide the source once, by trying to read the manifest from SharePoint. */
async function resolveSource() {
  if (_source) return _source;
  if (_probe) return _probe;

  _probe = (async () => {
    if (!graphAvailable()) {
      _sourceError = "not signed in";
      _source = "bundled";
      return _source;
    }
    try {
      const manifest = await readJsonFile("manifest.json", SP_DATA_PATH);
      if (!manifest) throw new Error("site_data/manifest.json not found");
      _cache.set("manifest.json", manifest);
      _source = "sharepoint";
    } catch (e) {
      console.warn("SharePoint data unavailable, using bundled JSON:", e.message);
      _sourceError = e.message;
      _source = "bundled";
    }
    // The sidebar renders before any data loads, so it can't read _source
    // directly — tell it once the probe settles.
    document.dispatchEvent(new CustomEvent("datasource", {
      detail: { source: _source, error: _sourceError },
    }));
    return _source;
  })();

  return _probe;
}

async function fetchJson(name) {
  if (_cache.has(name)) return _cache.get(name);

  const src = await resolveSource();
  let data = null;

  if (src === "sharepoint") {
    try {
      data = await readJsonFile(name, SP_DATA_PATH);
    } catch (e) {
      // One file missing from SharePoint shouldn't sink the page — the bundle
      // still has last-published numbers for it.
      console.warn(`SharePoint read failed for ${name}:`, e.message);
      data = null;
    }
  }
  if (data === null) data = await fetchBundled(name);

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
