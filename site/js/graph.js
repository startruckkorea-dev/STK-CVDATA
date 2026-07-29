// Microsoft Graph wrapper — browser-direct calls using the signed-in
// user's access token. Used for read/write operations that can't go through
// the nightly GitHub Actions JSON pre-build (e.g., translation editing).

import { getAccessToken } from "./auth.js";

const GRAPH = "https://graph.microsoft.com/v1.0";

// SharePoint coordinates — keep in sync with tools/sharepoint_sync.py defaults.
export const SP_HOSTNAME = "startruckkorea.sharepoint.com";
export const SP_SITE_PATH = "/sites/STK-PMM";
export const SP_FOLDER_PATH = "mbtruck-cvdata";

let _siteId = null;

async function gFetch(path, options = {}) {
  const token = await getAccessToken();
  const url = path.startsWith("http") ? path : `${GRAPH}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
}

export async function getSiteId() {
  if (_siteId) return _siteId;
  const res = await gFetch(`/sites/${SP_HOSTNAME}:${SP_SITE_PATH}`);
  if (!res.ok) throw new Error(`site resolve failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  _siteId = data.id;
  return _siteId;
}

/** GET a JSON file from SharePoint. Returns null if file doesn't exist. */
export async function readJsonFile(filename, folder = SP_FOLDER_PATH) {
  const siteId = await getSiteId();
  const path = `${folder}/${filename}`;
  const res = await gFetch(`/sites/${siteId}/drive/root:/${encodeURI(path)}:/content`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`read ${path} failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  try { return JSON.parse(text); }
  catch (e) { throw new Error(`${path} is not valid JSON: ${e.message}`); }
}

/** PUT a JSON file to SharePoint (creates or overwrites). */
export async function writeJsonFile(filename, data, folder = SP_FOLDER_PATH) {
  const siteId = await getSiteId();
  const path = `${folder}/${filename}`;
  const body = JSON.stringify(data, null, 2);
  const res = await gFetch(`/sites/${siteId}/drive/root:/${encodeURI(path)}:/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`write ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** List files in a folder (one level). */
export async function listFolder(folder = SP_FOLDER_PATH) {
  const siteId = await getSiteId();
  const res = await gFetch(`/sites/${siteId}/drive/root:/${encodeURI(folder)}:/children`);
  if (!res.ok) throw new Error(`list ${folder} failed: ${res.status}`);
  const data = await res.json();
  return data.value || [];
}
