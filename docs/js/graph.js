// Microsoft Graph wrapper — browser-direct calls using the signed-in user's
// access token (delegated permissions, no client secret, no backend).
//
// Everything the dashboard reads at runtime lives in the SharePoint folder
//   https://startruckkorea.sharepoint.com/sites/STK-PMM
//     → Shared Documents / mbtruck-cvdata
//       ├── (raw KAIDA / KAMA / CV xlsx — processed by tools/build_site.py)
//       └── site_data/   ← the built JSON the browser actually loads
//
// Authorization is SharePoint's, not ours: Graph returns 403 for anyone who
// lacks access to the folder, so the static login gate never has to be the
// real security boundary.

import { getAccessToken, isSignedIn } from "./auth.js";

const GRAPH = "https://graph.microsoft.com/v1.0";

// SharePoint coordinates — keep in sync with tools/sharepoint_sync.py defaults.
export const SP_HOSTNAME = "startruckkorea.sharepoint.com";
export const SP_SITE_PATH = "/sites/STK-PMM";
export const SP_FOLDER_PATH = "mbtruck-cvdata";
/** Built JSON the pages read. Written by tools/publish_data.py. */
export const SP_DATA_PATH = `${SP_FOLDER_PATH}/site_data`;

let _siteId = null;

/** Can we even try a Graph call? (MSAL present + a real signed-in account) */
export function graphAvailable() {
  return typeof msal !== "undefined" && isSignedIn();
}

/** Encode each path segment (folder names contain spaces and dots) but keep "/". */
function encPath(p) {
  return String(p).split("/").map(encodeURIComponent).join("/");
}

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
  const res = await gFetch(`/sites/${siteId}/drive/root:/${encPath(path)}:/content`);
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
  const res = await gFetch(`/sites/${siteId}/drive/root:/${encPath(path)}:/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`write ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** PUT a file verbatim (creates or overwrites). Used by the publish page, which
 *  uploads the build output byte-for-byte rather than re-serialising it. */
export async function writeFile(filename, body, folder = SP_FOLDER_PATH) {
  const siteId = await getSiteId();
  const path = `${folder}/${filename}`;
  const res = await gFetch(`/sites/${siteId}/drive/root:/${encPath(path)}:/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body,
  });
  if (!res.ok) {
    const detail = res.status === 403
      ? "이 폴더에 쓰기 권한이 없습니다"
      : await res.text();
    throw new Error(`write ${path} failed: ${res.status} ${detail}`);
  }
  return res.json();
}

/** Create `folder` (one level under an existing parent) unless it already
 *  exists. site_data/ won't be there before the first publish. */
export async function ensureFolder(folder) {
  const siteId = await getSiteId();
  const probe = await gFetch(`/sites/${siteId}/drive/root:/${encPath(folder)}`);
  if (probe.ok) return false;

  const cut = folder.lastIndexOf("/");
  const parent = cut < 0 ? "" : folder.slice(0, cut);
  const name = cut < 0 ? folder : folder.slice(cut + 1);
  const base = `/sites/${siteId}/drive/root`;
  const url = parent ? `${base}:/${encPath(parent)}:/children` : `${base}/children`;
  const res = await gFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      folder: {},
      "@microsoft.graph.conflictBehavior": "fail",
    }),
  });
  if (!res.ok) throw new Error(`create ${folder} failed: ${res.status} ${await res.text()}`);
  return true;
}

/** List files in a folder (one level). Returns [] when the folder is absent. */
export async function listFolder(folder = SP_FOLDER_PATH) {
  const siteId = await getSiteId();
  const res = await gFetch(`/sites/${siteId}/drive/root:/${encPath(folder)}:/children`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`list ${folder} failed: ${res.status}`);
  const data = await res.json();
  return data.value || [];
}
