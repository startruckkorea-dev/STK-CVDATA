// KAMA monthly Excel → aggregates, in the browser.
//
// Port of tools/kama_processor.py, same rationale as kaida-build.js: the
// monthly update runs from SharePoint in the browser rather than from a local
// checkout. A KAMA year is twelve separate workbooks (Monthly{YYYY}-{MM}.xlsx),
// each carrying that month's figure plus a running YTD.
//
// Assumes SheetJS (XLSX) is loaded globally.

const KAMA_BRAND_ORDER = ["Hyundai", "Tata Daewoo"];
// Same terminology as KAIDA: cargo bodies are Rigid, dumpers are Tipper.
// Mixer is kept apart from Rigid because it is a distinct body market, and EV
// holds the electric/fuel-cell heavy trucks, which the source reports as one
// line ("대형트럭 FCEV") with no cargo/tractor split to hand.
const KAMA_SEGMENT_ORDER = ["Rigid", "Tractor", "Tipper", "Mixer", "EV"];

// Dumpers below this are medium-duty and not comparable with the imported
// tipper market: the source lists 8T DUMP alongside 15T and 25.5T.
const MIN_TIPPER_TONNAGE = 9;

// 트럭특장 rows that match no specific body type ("특장기타") are large cargo.
// The block also carries TRACTOR / MIXER / 8X4 DUMP, which keep their own
// segments — this is the fallback for the rest, not a blanket rule.
const BODY_BLOCK = "트럭특장";

const COL_COMPANY = 0;
const COL_BLOCK = 3;
const COL_MODEL = 4;
const COL_MONTH = 7;
const COL_YTD = 8;

// Section and subtotal labels that occupy the model cell. These are exact
// matches: the real FCEV row is named "대형트럭 FCEV" and is classified, not
// skipped — a bare "FCEV" here is a group header carrying a rolled-up figure.
const SKIP_LABELS = new Set(["소  계", "소계", "총     계", "총계", "국산", "OEM 수입", "Export", "FCEV"]);
const BLOCK_KEEP = new Set(["트럭", "트럭특장"]);

function normalizeCompany(label) {
  const s = String(label || "").replace(/ /g, "").trim();
  if (s === "현대" || s === "현대자동차") return "Hyundai";
  if (s.includes("타타대우") || s.startsWith("타타")) return "Tata Daewoo";
  return null;
}

/** Tonnage a model name opens with — '8T DUMP' -> 8.0, '8X4 DUMP' -> null. */
function leadingTonnage(name) {
  const m = /^(\d+(?:\.\d+)?)\s*T\b/.exec(name);
  return m ? parseFloat(m[1]) : null;
}

/** Classify a KAMA model row into a segment, or null to leave it out.
 *
 *  Checked in order — the first match wins, and the order carries meaning:
 *  PULL CARGO must be tested before CARGO or trailer pullers would be counted
 *  as rigids, and MIXER before the tonnage rule for the same reason.
 *
 *  `block` is the row's 차종. It only decides the fallback: an unclassified row
 *  in 트럭특장 ("특장기타") is large cargo, while the same name under 트럭 is
 *  not counted. */
export function classifyKamaModel(modelName, block = null) {
  if (!modelName) return null;
  const name = String(modelName).toUpperCase();

  if (name.includes("EXPORT")) return null;      // 5T EXPORT, 대형트럭 EXPORT
  if (name.includes("FCEV")) return "EV";        // no cargo/tractor split
  if (name.includes("MIXER")) return "Mixer";
  if (name.includes("PULL CARGO")) return null;  // trailer puller; would double count
  if (name.includes("TRACTOR")) return "Tractor";

  if (name.includes("8X4 DUMP") || ` ${name}`.includes(" DUMP")) {
    const t = leadingTonnage(name);
    if (t !== null && t < MIN_TIPPER_TONNAGE) return null;   // 8T DUMP and below
    return "Tipper";
  }

  const t = leadingTonnage(name);
  if (t !== null && t >= 5) return "Rigid";
  if (name.includes("CARGO")) return "Rigid";
  if (block === BODY_BLOCK) return "Rigid";      // 특장기타 — large cargo
  return null;
}

/** The 업체별·모델별 sheet — the only one with per-model rows.
 *
 *  Its section number has moved over the years ('2-4…' in the older books,
 *  '1-4…' in the current ones), so match the name, not the number: keying on
 *  '1-4' silently fell back to sheet 0 ('1-1전체총괄'), which parses to nothing
 *  and looks exactly like a year with no data. */
export function pickModelSheet(sheetNames) {
  for (const s of sheetNames) {
    const flat = String(s).replace(/ /g, "");
    if (flat.includes("업체별") && flat.includes("모델별")) return s;
  }
  for (const s of sheetNames) if (String(s).includes("1-4")) return s;   // legacy
  return sheetNames[0];
}

/** Cell -> int, with blanks and dashes read as 0. */
function cellNum(row, col) {
  if (col >= row.length) return 0;
  const v = row[col];
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : 0;
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Sheet -> 2-D array of cell values.
 *
 *  Not `sheet_to_json` on its own: some KAIDA exports carry a truncated
 *  dimension record (the July 2026 book declares A1:V9 for a 103-row sheet).
 *  SheetJS trusts that range and hands back only the first few rows, which
 *  parses to zero detail and looks exactly like an empty year — pandas never
 *  saw it because openpyxl scans the cells instead. Recompute the used range
 *  from the cells that are actually present.
 */
function sheetGrid(ws) {
  let maxR = 0, maxC = 0;
  for (const k of Object.keys(ws)) {
    if (k.charCodeAt(0) === 33) continue;          // "!ref", "!merges", ...
    const a = XLSX.utils.decode_cell(k);
    if (a.r > maxR) maxR = a.r;
    if (a.c > maxC) maxC = a.c;
  }
  return XLSX.utils.sheet_to_json(ws, {
    header: 1, raw: true, defval: null, blankrows: true,
    range: { s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } },
  });
}

/** Read a single Monthly{YYYY}-{MM}.xlsx — the 업체별·모델별 sheet. */
export function parseKamaWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = pickModelSheet(wb.SheetNames);
  const grid = sheetGrid(wb.Sheets[sheet]);

  const out = [];
  let company = null;
  let block = null;
  for (const row of grid) {
    const companyCell = COL_COMPANY < row.length ? row[COL_COMPANY] : null;
    const normalized = typeof companyCell === "string" ? normalizeCompany(companyCell) : null;
    if (normalized && normalized !== company) {
      company = normalized;
      block = null;            // reset 차종 tracking at each company boundary
    }

    // 차종 (block) is labeled once per group then left blank — forward-fill it
    // so every model row inherits its group's 차종 (트럭 / 트럭특장 / 승용 / …).
    const blockCell = COL_BLOCK < row.length ? row[COL_BLOCK] : null;
    if (typeof blockCell === "string" && blockCell.trim() && blockCell.trim() !== "nan") {
      block = blockCell.trim();
    }

    if (normalized) continue;
    if (company === null) continue;
    if (!block || !BLOCK_KEEP.has(block)) continue;

    const model = COL_MODEL < row.length ? row[COL_MODEL] : null;
    if (typeof model !== "string" || !model.trim()) continue;
    if (SKIP_LABELS.has(model.trim())) continue;

    const seg = classifyKamaModel(model, block);
    if (!seg) continue;

    out.push({
      Brand: company,
      Model: model.trim(),
      Segment: seg,
      Month: cellNum(row, COL_MONTH),
      YTD: cellNum(row, COL_YTD),
    });
  }
  return out;
}

/** Month index from "Monthly{YYYY}-{MM}".
 *
 *  Revised files keep a suffix after the month ("Monthly2026-04_수정.xlsx"),
 *  so the month is matched in place rather than at the end of the name —
 *  anchoring on ".xlsx" silently dropped those months. */
export function kamaMonthFromName(name) {
  const m = /Monthly\d{4}-(\d{2})/.exec(String(name));
  return m ? parseInt(m[1], 10) : 0;
}

const mKey = i => `M${String(i).padStart(2, "0")}`;

/** Combine the monthly books of one year into wide per-model rows.
 *  `books` is [{ month, rows }] as produced by parseKamaWorkbook. */
export function combineKamaYear(books) {
  const wide = new Map();
  const lastYtd = new Map();

  for (const { month, rows } of books) {
    if (!(month >= 1 && month <= 12)) continue;
    for (const r of rows) {
      const key = `${r.Brand}\u0001${r.Model}\u0001${r.Segment}`;
      if (!wide.has(key)) {
        const blank = {};
        for (let i = 1; i <= 12; i++) blank[mKey(i)] = 0;
        wide.set(key, blank);
      }
      wide.get(key)[mKey(month)] = r.Month;
      // YTD is taken from the latest file that carries the key.
      lastYtd.set(key, r.YTD);
    }
  }

  const rows = [];
  for (const [key, monthly] of wide) {
    const [Brand, Model, Segment] = key.split("\u0001");
    const ytd = lastYtd.has(key)
      ? lastYtd.get(key)
      : Object.values(monthly).reduce((a, b) => a + b, 0);
    rows.push({ Brand, Model, Segment, ...monthly, YTD: ytd });
  }
  return rows;
}

function sumKama(rows) {
  const d = {};
  for (let i = 1; i <= 12; i++) d[mKey(i)] = 0;
  let ytd = 0;
  for (const r of rows) {
    for (let i = 1; i <= 12; i++) d[mKey(i)] += r[mKey(i)] || 0;
    ytd += r.YTD || 0;
  }
  for (let i = 1; i <= 12; i++) d[mKey(i)] = Math.trunc(d[mKey(i)]);
  d.YTD = Math.trunc(ytd);
  return d;
}

const groupBy = (rows, keyFn) => {
  const g = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(r);
  }
  return g;
};

export function aggregateKama(detail) {
  const out = { by_brand: {}, by_segment: {}, by_brand_seg: {}, monthly_totals: {} };
  if (!detail.length) return out;

  const byBrand = groupBy(detail, r => r.Brand);
  for (const b of KAMA_BRAND_ORDER) if (byBrand.has(b)) out.by_brand[b] = sumKama(byBrand.get(b));

  const bySeg = groupBy(detail, r => r.Segment);
  for (const s of KAMA_SEGMENT_ORDER) if (bySeg.has(s)) out.by_segment[s] = sumKama(bySeg.get(s));

  const byBS = groupBy(detail, r => `${r.Brand}\u0001${r.Segment}`);
  for (const b of KAMA_BRAND_ORDER) {
    out.by_brand_seg[b] = {};
    for (const s of KAMA_SEGMENT_ORDER) {
      const k = `${b}\u0001${s}`;
      if (byBS.has(k)) out.by_brand_seg[b][s] = sumKama(byBS.get(k));
    }
  }

  out.monthly_totals = sumKama(detail);
  return out;
}
