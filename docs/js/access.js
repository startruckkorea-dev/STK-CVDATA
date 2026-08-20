// Per-user access grades — Admin / Read / NA.
//
// The roster is maintained by admins in
//
//   Shared Documents / mbtruck-cvdata / Access / *.xlsx
//     C열 = 이름, G열 = 이메일, H열 = 권한
//
// but that folder is admin-only: an ordinary user must never be able to open
// it, and a browser gate that read it directly would require exactly that.
// So the flow has two halves:
//
//   1. 관리 → 접속 권한 (pages/access.html, admin only)
//        reads the workbook and publishes a derived roster to
//        site_data/access.json — the folder the dashboard numbers already use
//   2. every sign-in (below)
//        reads that JSON and matches the M365 account's email against it
//
// The published file carries no email addresses and no names: each address is
// stored as SHA-256(salt|email), and the browser hashes the signed-in user's
// own address to look itself up. The gate gets what it needs to decide without
// turning site_data into a staff directory readable by everyone who can open
// the dashboard.
//
// Grades:
//   admin  관리자 — 전 페이지 + 관리(접속 권한 · 발행 · 월간 갱신 · 번역편집)
//   read   읽기   — 관리 메뉴를 뺀 전 페이지
//   na     불가   — 사내 계정이라도 차단. 명부에 없는 사람도 여기로 떨어진다.
//
// Still the UX layer, not the security boundary: the numbers sit in SharePoint
// and Graph enforces that folder's own permissions no matter what this decides.

import { readJsonFile, SP_DATA_PATH, SP_FOLDER_PATH } from "./graph.js";

/** Admin-only folder holding the roster workbook. Only pages/access.html reads it. */
export const SP_ACCESS_PATH = `${SP_FOLDER_PATH}/Access`;
/** Derived roster the gate reads — published next to the data everyone loads. */
export const ACCESS_FILE = "access.json";

// Namespaces the digest, so these hashes are not the same value as a plain
// SHA-256 of the address published anywhere else. Written into the file too, so
// a future change stays readable by whichever version wrote it.
export const HASH_SALT = "mbtruck-cvdata:access:v1";

// Columns are fixed by the sheet the admins maintain (C/G/H). Rows are not: the
// workbook carries a title block above the header, so rather than assume a
// header row we take every row whose email cell actually holds an address.
const COL_NAME = 2;   // C
const COL_MAIL = 6;   // G
const COL_ROLE = 7;   // H

// Re-reading the roster on every page load would put a Graph round trip in
// front of every navigation of a multi-page site.
const CACHE_KEY = "cvdata.cache.access";   // PERSIST_PREFIX in data.js — "새로 고침" clears it
const CACHE_TTL_MS = 60 * 60 * 1000;       // 1 hour

// Bootstrap + recovery hatch. Before access.json exists — and if it is ever
// unpublished or unreadable — these accounts still come in as admin so the
// roster can be (re)published from the site itself. Hashed like everything
// else: this repo is public, and an address in it would be an address in it.
//   sunghan.cho@hyosung.com
const FALLBACK_ADMIN_HASHES = [
  "1d5eea3a75b1787588f14dae9259b3c708131d49cdf493486030bf23534b9196",
];

export const ROLE_ADMIN = "admin";
export const ROLE_READ = "read";
export const ROLE_NA = "na";

/** Sheet wording → role. Anything unrecognised is refused rather than guessed. */
export function normRole(raw) {
  const s = String(raw == null ? "" : raw).trim().toLowerCase();
  if (!s) return ROLE_NA;
  if (s === "admin" || s.startsWith("관리")) return ROLE_ADMIN;
  if (s === "read" || s === "reader" || s === "ro" ||
      s.startsWith("읽") || s.startsWith("일반")) return ROLE_READ;
  return ROLE_NA;   // "NA", "N/A", "불가", 빈칸, 오타 — 모두 차단
}

function _normMail(raw) {
  return String(raw == null ? "" : raw).trim().toLowerCase();
}

/** SHA-256(salt|email) as lowercase hex. Needs a secure context (https or
 *  localhost) — crypto.subtle is undefined on a plain-http origin. */
export async function hashEmail(email, salt = HASH_SALT) {
  if (!self.crypto || !self.crypto.subtle) {
    throw new Error("이 주소에서는 암호화 API를 쓸 수 없습니다 (https 또는 localhost 필요)");
  }
  const data = new TextEncoder().encode(`${salt}|${_normMail(email)}`);
  const digest = await self.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// ---- the roster workbook (admin side) --------------------------------------

/** Newest workbook in the Access folder, so a re-upload under a new name wins.
 *  Takes Graph driveItem entries; used only by pages/access.html. */
export function pickWorkbook(items) {
  const sheets = (items || []).filter(it =>
    it.file && /\.(xlsx|xlsm|xlsb)$/i.test(it.name) && !it.name.startsWith("~$"));
  if (!sheets.length) return null;
  sheets.sort((a, b) =>
    new Date(b.lastModifiedDateTime || 0) - new Date(a.lastModifiedDateTime || 0));
  return sheets[0];
}

/** Sheet rows (array of arrays) → [{name, email, role}], skipping every row
 *  whose G cell is not an address — titles, headers, notes, blank lines. */
export function parseRoster(rows) {
  const out = [];
  const seen = new Set();
  for (const row of rows || []) {
    const email = _normMail(row[COL_MAIL]);
    if (!email.includes("@")) continue;
    if (seen.has(email)) continue;          // 같은 사람이 두 줄이면 첫 줄만
    seen.add(email);
    out.push({
      email,
      name: String(row[COL_NAME] == null ? "" : row[COL_NAME]).trim(),
      role: normRole(row[COL_ROLE]),
    });
  }
  return out;
}

/**
 * Roster rows → the JSON the gate reads. NA is expressed by absence, so the
 * published file lists only the people who get in; the counts are kept so the
 * admin screen can show what the workbook actually said.
 */
export async function buildAccessFile(roster, { source = "", by = "" } = {}) {
  const entries = {};
  const counts = { admin: 0, read: 0, na: 0 };
  for (const r of roster) {
    counts[r.role] = (counts[r.role] || 0) + 1;
    if (r.role === ROLE_NA) continue;
    entries[await hashEmail(r.email)] = r.role;
  }
  return {
    generated_at: new Date().toISOString(),
    generated_by: by,
    source,
    algo: "sha256",
    salt: HASH_SALT,
    counts,
    entries,
  };
}

// ---- the published roster (every user) -------------------------------------

function _readCache({ ignoreAge = false } = {}) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || !c.at || !c.file) return null;
    if (!ignoreAge && Date.now() - c.at > CACHE_TTL_MS) return null;
    return c.file;
  } catch (_) {
    return null;
  }
}

function _writeCache(file) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), file }));
  } catch (_) {
    // private mode / quota — just re-read next time
  }
}

let _file = null;        // the access.json in force for this page load
let _error = null;       // why it could not be read, if it could not

/** Why the access list is unavailable, if it is. */
export function accessError() { return _error; }

/** The published roster in force (metadata included), or null. */
export function accessFile() { return _file; }

/**
 * Fetch (or reuse) the published roster. Never throws: on failure `_error` is
 * set and the last copy this browser saw is reused at any age, so a network
 * hiccup does not lock out people who were already graded. A browser that has
 * never read it has nothing cached and falls through to FALLBACK_ADMIN_HASHES.
 */
export async function loadAccessList({ force = false } = {}) {
  if (_file && !force) return _file;
  if (!force) {
    const cached = _readCache();
    if (cached) { _file = cached; return _file; }
  }
  try {
    const file = await readJsonFile(ACCESS_FILE, SP_DATA_PATH);
    if (!file) throw new Error(`${SP_DATA_PATH}/${ACCESS_FILE} 이 아직 발행되지 않았습니다`);
    if (!file.entries || typeof file.entries !== "object") {
      throw new Error(`${ACCESS_FILE} 형식이 올바르지 않습니다`);
    }
    _file = file;
    _error = null;
    _writeCache(file);
  } catch (e) {
    _error = e.message || String(e);
    _file = _readCache({ ignoreAge: true });
  }
  return _file;
}

/**
 * Grade for an email against the roster already loaded.
 *
 * Unlisted → `na`. The fallback admins count only while no roster is in force,
 * so publishing one takes their hard-coded privilege away again.
 */
export async function roleFor(email) {
  let hash;
  try {
    hash = await hashEmail(email, (_file && _file.salt) || HASH_SALT);
  } catch (e) {
    _error = _error || e.message;
    return ROLE_NA;
  }
  if (_file && _file.entries) {
    const role = _file.entries[hash];
    return role === ROLE_ADMIN || role === ROLE_READ ? role : ROLE_NA;
  }
  const bare = await hashEmail(email, HASH_SALT);
  return FALLBACK_ADMIN_HASHES.includes(bare) ? ROLE_ADMIN : ROLE_NA;
}
