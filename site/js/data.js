// Data fetcher — loads site/data/*.json with simple in-memory caching.

const _cache = new Map();

function root() {
  return document.documentElement.dataset.siteRoot || ".";
}

async function fetchJson(path) {
  if (_cache.has(path)) return _cache.get(path);
  const url = `${root()}${path}`;
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status}`);
  const data = await res.json();
  _cache.set(path, data);
  return data;
}

export async function loadManifest() {
  return fetchJson("/data/manifest.json");
}

export async function loadKaida(year) {
  return fetchJson(`/data/kaida_${year}.json`);
}

export async function loadKama(year) {
  return fetchJson(`/data/kama_${year}.json`);
}

export async function loadCvData(year) {
  return fetchJson(`/data/cvdata_${year}.json`);
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
