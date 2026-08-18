// KAIDA monthly Excel → aggregates, in the browser.
//
// A line-by-line port of tools/kaida_processor.py. It exists so the monthly
// update no longer needs one person's PC: the browser reads the source xlsx
// from SharePoint with the signed-in user's token, aggregates here, and writes
// the JSON back. The Python version stays as the reference implementation and
// still owns the historical years — this only ever rebuilds the current one.
//
// Keep the two in step. Where the pandas original relies on behaviour that is
// not obvious (importer blocks closed by a "-Total" row, the two-row header,
// the exclusion rules), the comment explaining it has been carried over rather
// than re-derived.
//
// Assumes SheetJS (XLSX) is loaded globally.

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                       "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BRAND_ORDER = ["MB", "Volvo", "Scania", "MAN", "IVECO"];
const SEGMENT_ORDER = ["Tractor", "Rigid", "Tipper"];

const HP_BAND_ORDER = ["<500", "500-549", "550-599", "600-699", "700+"];
const HP_BAND_EDGES = [[500, "<500"], [550, "500-549"], [600, "550-599"], [700, "600-699"]];

const MONTH_TOKEN = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i;
const MONTH_TOKEN_FULL = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i;

// The van-only importer. Its van and bodybuilder volumes are out of scope for
// this report (Sprinter class), so the whole block is dropped.
const EXCLUDED_IMPORTERS = new Set(["mercedes-benz korea"]);
// IVECO's light van chassis — excluded wherever it appears (Van *and* Cargo).
const EXCLUDED_MODEL_RE = /new\s*daily/i;

function hpBand(hp) {
  const v = Number(hp);
  if (!Number.isFinite(v) || v <= 0) return null;
  for (const [edge, label] of HP_BAND_EDGES) if (v < edge) return label;
  return "700+";
}

/** KAIDA Importer/Brand string -> normalized brand. */
export function mapBrand(importer, brand, model) {
  const blob = `${importer || ""} ${brand || ""} ${model || ""}`.toLowerCase();
  // 2026 export sometimes mangles to '0Benz' — match the 'enz' stem too
  if (["mercedes", "benz", "0benz"].some(s => blob.includes(s))) return "MB";
  if (blob.includes("volvo")) return "Volvo";
  if (blob.includes("scania")) return "Scania";
  if (/\bman\b/.test(blob)) return "MAN";
  if (blob.includes("iveco") || blob.includes("cnh")) return "IVECO";
  // Bodybuilder rows: try chassis brand from model
  const imp = (importer || "").toLowerCase();
  const br = (brand || "").toLowerCase();
  if (imp.includes("bodybuilder") || br.includes("bodybuilder")) {
    const m = (model || "").toLowerCase();
    if (["mercedes", "benz", "actros", "arocs"].some(s => m.includes(s))) return "MB";
    if (m.includes("volvo") || m.includes("fmx") || m.includes("fh ")) return "Volvo";
    if (m.includes("scania")) return "Scania";
    if (/\bman\b|\btgs\b|\btgx\b/.test(m)) return "MAN";
    if (m.includes("iveco") || m.includes("stralis")) return "IVECO";
  }
  return "Unknown";
}

/** Segment label -> normalized segment, or null to skip. The reports' "Cargo"
 *  becomes Rigid and their "Dump" becomes Tipper; Van and Bus are out of scope. */
export function mapSegment(segment) {
  const s = String(segment || "").trim().toLowerCase();
  if (s.includes("tractor")) return "Tractor";
  if (s.includes("dump") || s.includes("tipper")) return "Tipper";
  if (s.includes("cargo") || s.includes("rigid")) return "Rigid";
  return null;
}

/** 1..12 from a Jan/Feb/... token in the filename, 0 when absent. */
export function fileMonthIndex(name) {
  const m = MONTH_TOKEN.exec(String(name));
  if (!m) return 0;
  const t = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return MONTHS.indexOf(t) + 1;
}

const s2 = v => (v === null || v === undefined) ? "" : String(v);
const num = v => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Label each row with its importer block; null for the block's total row.
 *
 *  KAIDA splits a long importer name over consecutive cells and leaves the rest
 *  blank, so the only reliable name is on the row that closes the block
 *  ("Volvo Trucks Korea-Total"). Rows after the last total row (and the
 *  grand-total row itself) get null and are dropped by the caller. */
function assignImporterBlocks(values) {
  const labels = new Array(values.length).fill(null);
  let pending = [];
  values.forEach((raw, pos) => {
    const text = s2(raw).trim();
    const low = text.toLowerCase();
    if (low === "total" || low === "grand-total" || low === "grand total") {
      pending = [];               // grand total closes the sheet
      return;
    }
    if (low.endsWith("-total") || low.endsWith(" total")) {
      const name = text.replace(/[-\s]total$/i, "").trim();
      for (const i of pending) labels[i] = name;
      pending = [];
      return;
    }
    pending.push(pos);
  });
  return labels;
}

/** Bodybuilder rows: Brand=='Bodybuilder' (2026) or Model '*_Bodybuilder'. */
const isBodybuilder = r =>
  s2(r.Brand).trim().toLowerCase() === "bodybuilder" ||
  s2(r.Model).toLowerCase().includes("bodybuilder");

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

/** Read one KAIDA workbook into detail rows.
 *
 *  Layout: a few metadata rows, then Importer | Brand | Model | Segment |
 *  AxleType | HP | Payload | Suspension | Total | Jan..Dec | MS. */
export function parseKaidaWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: "array" });
  const grid = sheetGrid(wb.Sheets[wb.SheetNames[0]]);
  if (!grid.length) return [];

  // The reports vary slightly — find the header row by looking for "Importer".
  let headerRow = null;
  for (let i = 0; i < Math.min(10, grid.length); i++) {
    if ((grid[i] || []).some(c => s2(c).toLowerCase().includes("importer"))) { headerRow = i; break; }
  }
  if (headerRow === null) headerRow = 4;

  const cols = (grid[headerRow] || []).map(c => s2(c).trim());
  let rows = grid.slice(headerRow + 1);

  // KAIDA uses a TWO-ROW header: the monthly columns (Jan./Feb./…/Dec.) are
  // sub-headers of "Registration" on the row *below* the Importer/…/Total row,
  // so the first data row is actually the month-name row. Promote it, then drop
  // it. Without this no monthly data survives and the charts render empty.
  if (rows.length) {
    const sub = rows[0] || [];
    let renamed = false;
    sub.forEach((cell, i) => {
      const m = MONTH_TOKEN.exec(s2(cell));
      if (m) {
        cols[i] = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
        renamed = true;
      }
    });
    if (renamed) rows = rows.slice(1);
  }

  // Normalize column names to the ones the aggregation speaks.
  const idx = {};              // canonical name -> column index
  cols.forEach((c, i) => {
    const cl = c.toLowerCase();
    let name = null;
    if (cl.includes("importer")) name = "Importer";
    else if (cl === "brand") name = "Brand";
    else if (cl.includes("model") && !cl.includes("brand")) name = "Model";
    else if (cl.includes("segment")) name = "Segment";
    else if (cl.includes("axle")) name = "AxleType";
    else if (cl === "hp" || cl === "horsepower") name = "HP";
    else if (cl.includes("payload")) name = "Payload";
    else if (cl.includes("suspension")) name = "Suspension";
    else if (["total", "ytd", "y.t.d", "y.t.d."].includes(cl)) name = "Total";
    else if (["m.s", "ms", "m/s", "market share", "m.s."].includes(cl)) name = "MS";
    else if (MONTH_TOKEN_FULL.test(c)) name = c[0].toUpperCase() + c.slice(1).toLowerCase();
    // First column wins, matching pandas' left-to-right rename.
    if (name && !(name in idx)) idx[name] = i;
  });

  const cell = (row, key) => (key in idx ? (row || [])[idx[key]] : null);

  // Group rows into importer blocks and drop the subtotal rows that close them.
  const blocks = assignImporterBlocks(rows.map(r => cell(r, "Importer")));

  let detail = [];
  rows.forEach((r, i) => {
    if (blocks[i] === null) return;
    const rec = {
      ImporterBlock: blocks[i],
      Brand: s2(cell(r, "Brand")),
      Model: s2(cell(r, "Model")),
      Segment: s2(cell(r, "Segment")),
      HP: num(cell(r, "HP")),
      Total: "Total" in idx ? num(cell(r, "Total")) : null,
    };
    for (const m of MONTHS) rec[m] = m in idx ? num(cell(r, m)) : null;
    detail.push(rec);
  });

  // Rule 1 — the van-only importer contributes neither vans nor bodybuilder.
  detail = detail.filter(r => !EXCLUDED_IMPORTERS.has(r.ImporterBlock.toLowerCase()));
  // Rule 2 — IVECO New Daily is excluded regardless of its segment label.
  detail = detail.filter(r => !EXCLUDED_MODEL_RE.test(r.Model));

  // A block's brand is spread over several cells (KAIDA wraps long names over
  // two rows, e.g. "Mercedes" / "-Benz"), so join the block's brand cells and
  // match against that blob rather than any single row.
  const blobs = new Map();
  for (const r of detail) {
    if (isBodybuilder(r)) continue;
    if (!blobs.has(r.ImporterBlock)) blobs.set(r.ImporterBlock, new Set());
    if (r.Brand !== "") blobs.get(r.ImporterBlock).add(r.Brand);
  }
  const blobFor = b => [...(blobs.get(b) || [])].map(v => v.trim()).filter(Boolean).join("");

  for (const r of detail) {
    r.BrandNorm = mapBrand(r.ImporterBlock, blobFor(r.ImporterBlock), r.Model);
    // Rule 3 — bodybuilder volumes count as Rigid. In the 2026 layout these
    // rows carry no Segment at all; before that they were labelled Cargo (or
    // Van for the light-van chassis, which stays out of scope).
    const rawSeg = r.Segment.toLowerCase();
    r.SegmentNorm = isBodybuilder(r)
      ? (rawSeg.includes("van") ? null : "Rigid")
      : mapSegment(rawSeg);
  }

  return detail.filter(r => r.BrandNorm !== "Unknown" && r.SegmentNorm !== null);
}

// ---- aggregation ----------------------------------------------------------

function sumRows(rows, monthCols, hasTotal) {
  const d = {};
  for (const m of monthCols) d[m] = 0;
  let total = 0;
  for (const r of rows) {
    for (const m of monthCols) d[m] += r[m] || 0;
    if (hasTotal) total += r.Total || 0;
  }
  for (const m of monthCols) d[m] = Math.trunc(d[m]);
  d.Total = hasTotal ? Math.trunc(total)
                     : monthCols.reduce((a, m) => a + d[m], 0);
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

export function aggregateKaida(detail) {
  const out = { by_brand: {}, by_segment: {}, by_brand_seg: {}, monthly_totals: {} };
  if (!detail.length) return out;

  const monthCols = MONTHS.filter(m => detail[0][m] !== null && detail[0][m] !== undefined);
  const hasTotal = detail[0].Total !== null;

  const byBrand = groupBy(detail, r => r.BrandNorm);
  for (const b of BRAND_ORDER) if (byBrand.has(b)) out.by_brand[b] = sumRows(byBrand.get(b), monthCols, hasTotal);

  const bySeg = groupBy(detail, r => r.SegmentNorm);
  for (const s of SEGMENT_ORDER) if (bySeg.has(s)) out.by_segment[s] = sumRows(bySeg.get(s), monthCols, hasTotal);

  const byBS = groupBy(detail, r => `${r.BrandNorm} ${r.SegmentNorm}`);
  for (const b of BRAND_ORDER) {
    out.by_brand_seg[b] = {};
    for (const s of SEGMENT_ORDER) {
      const k = `${b} ${s}`;
      if (byBS.has(k)) out.by_brand_seg[b][s] = sumRows(byBS.get(k), monthCols, hasTotal);
    }
  }

  out.monthly_totals = sumRows(detail, monthCols, hasTotal);
  Object.assign(out, aggregateTractorHp(detail, monthCols, hasTotal));
  return out;
}

/** Tractor-only power classes. Only the tractor segment publishes a meaningful
 *  HP rating in these sheets (rigids and tippers vary by body, not engine). */
function aggregateTractorHp(detail, monthCols, hasTotal) {
  const out = { tractor_by_hp: {}, tractor_by_hp_brand: {}, tractor_hp_points: [] };
  const tr = detail.filter(r => r.SegmentNorm === "Tractor")
                   .map(r => ({ ...r, HPBand: hpBand(r.HP) }))
                   .filter(r => r.HPBand !== null);
  if (!tr.length) return out;

  const byBand = groupBy(tr, r => r.HPBand);
  for (const band of HP_BAND_ORDER) {
    if (byBand.has(band)) out.tractor_by_hp[band] = sumRows(byBand.get(band), monthCols, hasTotal);
  }

  const byBrandBand = groupBy(tr, r => `${r.BrandNorm} ${r.HPBand}`);
  for (const b of BRAND_ORDER) {
    out.tractor_by_hp_brand[b] = {};
    for (const band of HP_BAND_ORDER) {
      const k = `${b} ${band}`;
      if (byBrandBand.has(k)) out.tractor_by_hp_brand[b][band] = sumRows(byBrandBand.get(k), monthCols, hasTotal);
    }
  }

  // Exact ratings, so the front-end can draw the real spread inside a band.
  const byHp = groupBy(tr, r => r.HP);
  const byHpBrand = groupBy(tr, r => `${r.HP} ${r.BrandNorm}`);
  for (const hp of [...byHp.keys()].sort((a, b) => a - b)) {
    const entry = {
      hp: Math.trunc(hp),
      band: hpBand(hp),
      ...sumRows(byHp.get(hp), monthCols, hasTotal),
      by_brand: {},
    };
    for (const b of BRAND_ORDER) {
      const k = `${hp} ${b}`;
      if (!byHpBrand.has(k)) continue;
      const row = sumRows(byHpBrand.get(k), monthCols, hasTotal);
      if (Object.values(row).some(v => v)) entry.by_brand[b] = row;
    }
    if (entry.Total || Object.keys(entry.by_brand).length) out.tractor_hp_points.push(entry);
  }
  return out;
}

/** 1..12 of the latest month with non-zero registrations. */
export function detectLastDataMonth(agg) {
  const m = agg.monthly_totals || {};
  let last = 0;
  MONTHS.forEach((mo, i) => { if ((m[mo] || 0) > 0) last = i + 1; });
  return last;
}

/** Split a folder listing into the latest main report and the latest dump
 *  workbook. They are located independently: a year folder may hold both (told
 *  apart by "dump" in the name), or the dumps may be filed on their own. */
export function pickKaidaFiles(names) {
  const clean = names.filter(n => !n.startsWith("~$") && /\.xlsx$/i.test(n));
  const dumps = clean.filter(n => n.toLowerCase().includes("dump"));
  const mains = clean.filter(n => !n.toLowerCase().includes("dump"));
  const latest = list => list.length
    ? list.reduce((a, b) => (fileMonthIndex(b) > fileMonthIndex(a) ? b : a))
    : null;
  return { cv: latest(mains), dump: latest(dumps) };
}
