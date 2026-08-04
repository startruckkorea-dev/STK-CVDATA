"""KAIDA monthly Excel parser — pure Python, no Streamlit deps.

Ports utils/kaida_processor.py from the Streamlit project. The aggregation
output is dict-of-dicts ready for json.dump().
"""
from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
BRAND_ORDER = ["MB", "Volvo", "Scania", "MAN", "IVECO"]
# "Cargo" in the source reports is reported as Rigid; "Dump" as Tipper.
SEGMENT_ORDER = ["Tractor", "Rigid", "Tipper"]

BRAND_COLORS = {
    "MB": "#231F20",
    "Volvo": "#1A3A82",
    "Scania": "#D4122A",
    "MAN": "#F7B731",
    "IVECO": "#0097E6",
}
SEGMENT_COLORS = {
    "Tractor": "#808080",
    "Rigid": "#1a56db",
    "Tipper": "#e04f2e",
}

# Tractor power classes. The imported tractor market clusters around the
# 500 / 540 / 560 ratings, so the bands are cut between those clusters rather
# than on round 100hp steps — a 100hp grid would bury the whole volume core in
# one bucket.
HP_BAND_ORDER = ["<500", "500-549", "550-599", "600-699", "700+"]
HP_BAND_EDGES = [(500, "<500"), (550, "500-549"), (600, "550-599"), (700, "600-699")]


def hp_band(hp: float | None) -> str | None:
    """Horsepower -> band label, or None when the row carries no rating."""
    try:
        v = float(hp)
    except (TypeError, ValueError):
        return None
    if v <= 0:
        return None
    for edge, label in HP_BAND_EDGES:
        if v < edge:
            return label
    return "700+"

_MONTH_TOKEN_RE = re.compile(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)", re.I)

# The van-only importer. Its van and bodybuilder volumes are out of scope for
# this report (Sprinter class), so the whole block is dropped.
EXCLUDED_IMPORTERS = {"mercedes-benz korea"}

# IVECO's light van chassis — excluded wherever it appears (Van *and* Cargo).
EXCLUDED_MODEL_RE = re.compile(r"new\s*daily", re.I)


def map_brand_kaida(importer: str, brand: str, model: str) -> str:
    """KAIDA Importer/Brand string -> normalized brand."""
    blob = f"{importer or ''} {brand or ''} {model or ''}".lower()
    # 2026 export sometimes mangles to '0Benz' — match the 'enz' stem too
    if any(s in blob for s in ("mercedes", "benz", "0benz")):
        return "MB"
    if "volvo" in blob:
        return "Volvo"
    if "scania" in blob:
        return "Scania"
    if re.search(r"\bman\b", blob):
        return "MAN"
    if "iveco" in blob or "cnh" in blob:
        return "IVECO"
    # Bodybuilder rows: try chassis brand from model
    if "bodybuilder" in (importer or "").lower() or "bodybuilder" in (brand or "").lower():
        m = model or ""
        if any(s in m.lower() for s in ("mercedes", "benz", "actros", "arocs")):
            return "MB"
        if "volvo" in m.lower() or "fmx" in m.lower() or "fh " in m.lower():
            return "Volvo"
        if "scania" in m.lower():
            return "Scania"
        if re.search(r"\bman\b|\btgs\b|\btgx\b", m.lower()):
            return "MAN"
        if "iveco" in m.lower() or "stralis" in m.lower():
            return "IVECO"
    return "Unknown"


def map_segment_kaida(segment: str, hp_num: float | None = None) -> str | None:
    """KAIDA Segment label -> normalized segment, or None to skip.

    Terminology is unified here: the reports' "Cargo" becomes Rigid and their
    "Dump" becomes Tipper. Van and Bus rows are out of scope.
    """
    s = (segment or "").strip().lower()
    if "tractor" in s:
        return "Tractor"
    if "dump" in s or "tipper" in s:
        return "Tipper"
    if "cargo" in s or "rigid" in s:
        return "Rigid"
    return None


def _file_month_index(path: Path) -> int:
    """Return 1..12 by matching Jan/Feb/.../Dec token in filename. 0 if none."""
    m = _MONTH_TOKEN_RE.search(path.name)
    if not m:
        return 0
    return MONTHS.index(m.group(1).title()) + 1


def _kaida_folder(root: Path, year: int) -> Path | None:
    """Year folder, supporting both the current and the legacy layout."""
    for candidate in (root / "KAIDA" / str(year), root / f"KAIDA {year}"):
        if candidate.is_dir():
            return candidate
    return None


# SharePoint files the whole archive by report type instead of by year:
#   KAIDA/KAIDA/       every main report, all years
#   KAIDA/KAIDA-Dump/  the separate tipper workbooks (2025 and earlier)
# The year then lives in the filename rather than a folder name.
def _kaida_flat_dirs(root: Path) -> tuple[Path | None, Path | None]:
    main = root / "KAIDA" / "KAIDA"
    dump = root / "KAIDA" / "KAIDA-Dump"
    return (main if main.is_dir() else None, dump if dump.is_dir() else None)


_YEAR_RE = re.compile(r"(20\d{2})")


def _year_in_name(path: Path) -> int | None:
    """Year from a filename, e.g. '2025 KAIDA CV ...' or '... (Dec. 2025).xlsx'.

    Takes the LAST match: the year trails the month in the dump naming
    ('(Dec. 2025)') and stands alone in the main one, so the last 20xx token is
    the year in both.
    """
    hits = _YEAR_RE.findall(path.name)
    return int(hits[-1]) if hits else None


def _latest_for_year(folder: Path | None, year: int) -> Path | None:
    """Newest report for `year` in a flat folder, by the month in its name."""
    if folder is None:
        return None
    files = [
        p for p in folder.glob("*.xlsx")
        if not p.name.startswith("~$") and _year_in_name(p) == year
    ]
    return max(files, key=_file_month_index) if files else None


def find_kaida_files(root: Path, year: int) -> tuple[Path | None, Path | None]:
    """Locate the latest CV + Dump reports for one year.

    From 2026 the importers ship a single unified file that already contains
    Tractor / Cargo / Dump rows, so dump_path is often None.

    Handles both layouts: a per-year folder holding every report for that year,
    and SharePoint's split by report type (KAIDA/KAIDA + KAIDA/KAIDA-Dump) where
    the year is in the filename.

    Returns (cv_path, dump_path). Either may be None if missing.
    """
    folder = _kaida_folder(root, year)
    if folder is None:
        main_dir, dump_dir = _kaida_flat_dirs(root)
        return _latest_for_year(main_dir, year), _latest_for_year(dump_dir, year)
    cv_candidates = []
    dump_candidates = []
    for p in folder.glob("*.xlsx"):
        if p.name.startswith("~$"):
            continue
        name_low = p.name.lower()
        is_dump = "dump" in name_low
        if is_dump:
            dump_candidates.append(p)
        else:
            cv_candidates.append(p)
    cv = max(cv_candidates, key=_file_month_index) if cv_candidates else None
    dump = max(dump_candidates, key=_file_month_index) if dump_candidates else None
    return cv, dump


def _parse_kaida_excel(filepath: Path) -> pd.DataFrame:
    """Read one KAIDA xlsx -> detail DataFrame.

    Layout:
      rows 0..4: header / metadata (skipped)
      row 5+: data — Importer | Brand | Model | Segment | AxleType | HP |
                     Payload | Suspension | Total | Jan..Dec | MS
    Importer/Brand are forward-filled.
    Subtotal rows ("Total" suffix or blank Model) are dropped.
    """
    raw = pd.read_excel(filepath, header=None, engine="openpyxl")
    # KAIDA reports vary slightly — find header row by looking for "Importer"
    header_row = None
    for i in range(min(10, len(raw))):
        row = [str(c).lower() for c in raw.iloc[i].tolist()]
        if any("importer" in c for c in row):
            header_row = i
            break
    if header_row is None:
        header_row = 4
    df = pd.read_excel(filepath, header=header_row, engine="openpyxl")
    df.columns = [str(c).strip() for c in df.columns]

    # KAIDA uses a TWO-ROW header: the monthly columns (Jan./Feb./…/Dec.) are
    # sub-headers of "Registration" on the row *below* the Importer/…/Total row.
    # read_excel only consumed the first header row, so those months arrived as
    # generic column names ("Registration", "Unnamed: N", …) and the first data
    # row is actually the month-name row. Promote it: rename the month columns
    # from that row, then drop it. Without this, no monthly data survives and the
    # front-end (which sums Jan..Dec) renders empty charts.
    if len(df) > 0:
        subhdr = df.iloc[0]
        month_rename = {}
        for col in df.columns:
            m = _MONTH_TOKEN_RE.search(str(subhdr[col]))
            if m:
                month_rename[col] = m.group(1).title()
        if month_rename:
            df = df.rename(columns=month_rename)
            df = df.iloc[1:].reset_index(drop=True)

    # Normalize column names
    rename = {}
    for c in df.columns:
        cl = c.lower()
        if "importer" in cl: rename[c] = "Importer"
        elif cl == "brand": rename[c] = "Brand"
        elif "model" in cl and "brand" not in cl: rename[c] = "Model"
        elif "segment" in cl: rename[c] = "Segment"
        elif "axle" in cl: rename[c] = "AxleType"
        elif cl in ("hp", "horsepower"): rename[c] = "HP"
        elif "payload" in cl: rename[c] = "Payload"
        elif "suspension" in cl: rename[c] = "Suspension"
        elif cl in ("total", "ytd", "y.t.d", "y.t.d."): rename[c] = "Total"
        elif cl in ("m.s", "ms", "m/s", "market share", "m.s."): rename[c] = "MS"
        elif _MONTH_TOKEN_RE.fullmatch(c.strip()): rename[c] = c.strip().title()
    df = df.rename(columns=rename)

    for col in ("Importer", "Brand", "Model", "Segment"):
        if col not in df.columns:
            df[col] = None

    # Group rows into importer blocks and drop the subtotal rows that close them
    df["ImporterBlock"] = _assign_importer_blocks(df["Importer"])
    df = df[df["ImporterBlock"].notna()]

    # Coerce numeric
    num_cols = [c for c in MONTHS + ["Total", "HP"] if c in df.columns]
    for c in num_cols:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)

    # Rule 1 — the van-only importer contributes neither vans nor bodybuilder.
    df = df[~df["ImporterBlock"].str.lower().isin(EXCLUDED_IMPORTERS)]
    # Rule 2 — IVECO New Daily is excluded regardless of its segment label.
    df = df[~df["Model"].fillna("").astype(str).str.contains(EXCLUDED_MODEL_RE)]

    # A block's brand is spread over several cells (KAIDA wraps long names over
    # two rows, e.g. "Mercedes" / "-Benz"), so join the block's brand cells and
    # match against that blob rather than any single row.
    brand_blob = _block_brand_blobs(df)
    df["BrandNorm"] = [
        map_brand_kaida(imp, brand_blob.get(imp, ""), model)
        for imp, model in zip(df["ImporterBlock"], df["Model"].fillna(""))
    ]

    # Rule 3 — bodybuilder volumes count as Rigid. In the 2026 layout these rows
    # carry no Segment at all; before that they were labelled Cargo (or Van for
    # the light-van chassis, which stays out of scope).
    is_bb = _is_bodybuilder(df)
    raw_seg = df["Segment"].fillna("").astype(str).str.lower()

    def _segment(bodybuilder: bool, raw: str) -> str | None:
        if bodybuilder:
            return None if "van" in raw else "Rigid"
        return map_segment_kaida(raw)

    df["SegmentNorm"] = [_segment(bb, rs) for bb, rs in zip(is_bb, raw_seg)]

    df = df[df["BrandNorm"] != "Unknown"]
    df = df[df["SegmentNorm"].notna()]
    return df.reset_index(drop=True)


def _assign_importer_blocks(importer: pd.Series) -> pd.Series:
    """Label each row with its importer block; None for the block's total row.

    KAIDA splits a long importer name over consecutive cells and leaves the rest
    blank, so the only reliable name is on the row that closes the block
    ("Volvo Trucks Korea-Total"). Rows after the last total row (and the
    grand-total row itself) get None and are dropped by the caller.
    """
    labels: list[str | None] = [None] * len(importer)
    pending: list[int] = []
    for pos, raw in enumerate(importer):
        text = "" if raw is None or pd.isna(raw) else str(raw).strip()
        low = text.lower()
        if low in ("total", "grand-total", "grand total"):
            pending.clear()          # grand total closes the sheet
            continue
        if low.endswith("-total") or low.endswith(" total"):
            name = re.sub(r"[-\s]total$", "", text, flags=re.I).strip()
            for i in pending:
                labels[i] = name
            pending.clear()
            continue
        pending.append(pos)
    return pd.Series(labels, index=importer.index)


def _is_bodybuilder(df: pd.DataFrame) -> pd.Series:
    """Bodybuilder rows: Brand=='Bodybuilder' (2026) or Model '*_Bodybuilder'."""
    brand = df["Brand"].fillna("").astype(str).str.strip().str.lower()
    model = df["Model"].fillna("").astype(str).str.lower()
    return brand.eq("bodybuilder") | model.str.contains("bodybuilder")


def _block_brand_blobs(df: pd.DataFrame) -> dict[str, str]:
    """Per importer block, the concatenation of its non-bodybuilder brand cells."""
    out: dict[str, str] = {}
    bb = _is_bodybuilder(df)
    for block, chunk in df[~bb].groupby("ImporterBlock"):
        seen = [str(v).strip() for v in chunk["Brand"].dropna().unique() if str(v).strip()]
        out[str(block)] = "".join(seen)
    return out


def load_kaida_year(root: Path, year: int) -> pd.DataFrame:
    """Load + parse + concat the reports for one year.

    Through 2025 tipper volumes arrived in a separate "(Dump)" workbook. From
    2026 they are rows inside the main file, so the dump workbook is only merged
    when the main file has no tipper rows of its own — merging both would double
    count.
    """
    cv_path, dump_path = find_kaida_files(root, year)
    frames = []
    has_tipper = False
    if cv_path:
        cv = _parse_kaida_excel(cv_path)
        has_tipper = not cv.empty and (cv["SegmentNorm"] == "Tipper").any()
        frames.append(cv)
    if dump_path and not has_tipper:
        df = _parse_kaida_excel(dump_path)
        if not df.empty:
            df["SegmentNorm"] = "Tipper"
        frames.append(df)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def get_available_kaida_years(root: Path) -> list[int]:
    years = []
    parent = root / "KAIDA"
    if parent.is_dir():
        for p in parent.iterdir():
            if p.is_dir() and re.fullmatch(r"\d{4}", p.name):
                years.append(int(p.name))
    for p in root.glob("KAIDA *"):          # legacy "KAIDA {year}/" layout
        if p.is_dir():
            m = re.search(r"(\d{4})", p.name)
            if m:
                years.append(int(m.group(1)))
    # SharePoint layout: years come off the filenames, not the folders. Only the
    # main folder counts — a year with a dump workbook but no main report has no
    # tractor/cargo volumes and would build an empty year.
    main_dir, _ = _kaida_flat_dirs(root)
    if main_dir is not None:
        for p in main_dir.glob("*.xlsx"):
            if p.name.startswith("~$"):
                continue
            y = _year_in_name(p)
            if y:
                years.append(y)
    return sorted(set(years), reverse=True)


def aggregate_kaida(detail: pd.DataFrame) -> dict:
    """Pivot detail DataFrame into json-friendly aggregates.

    Returns:
      {
        "by_brand":       {brand: {month: int, ..., "Total": int}},
        "by_segment":     {seg:   {month: int, ..., "Total": int}},
        "by_brand_seg":   {brand: {seg: {month: ..., "Total": int}}},
        "monthly_totals": {month: int, "Total": int}
      }
    """
    out = {"by_brand": {}, "by_segment": {}, "by_brand_seg": {}, "monthly_totals": {}}
    if detail.empty:
        return out

    month_cols = [m for m in MONTHS if m in detail.columns]
    total_col = "Total" if "Total" in detail.columns else None

    def _to_int_dict(row) -> dict:
        d = {m: int(row[m]) for m in month_cols}
        if total_col:
            d["Total"] = int(row[total_col])
        else:
            d["Total"] = sum(d.values())
        return d

    # By brand
    g = detail.groupby("BrandNorm")[month_cols + ([total_col] if total_col else [])].sum()
    for brand in BRAND_ORDER:
        if brand in g.index:
            out["by_brand"][brand] = _to_int_dict(g.loc[brand])

    # By segment
    g = detail.groupby("SegmentNorm")[month_cols + ([total_col] if total_col else [])].sum()
    for seg in SEGMENT_ORDER:
        if seg in g.index:
            out["by_segment"][seg] = _to_int_dict(g.loc[seg])

    # By brand × segment
    g = detail.groupby(["BrandNorm", "SegmentNorm"])[month_cols + ([total_col] if total_col else [])].sum()
    for brand in BRAND_ORDER:
        out["by_brand_seg"][brand] = {}
        for seg in SEGMENT_ORDER:
            if (brand, seg) in g.index:
                out["by_brand_seg"][brand][seg] = _to_int_dict(g.loc[(brand, seg)])

    # Monthly totals
    totals_row = detail[month_cols + ([total_col] if total_col else [])].sum()
    out["monthly_totals"] = _to_int_dict(totals_row)

    out.update(_aggregate_tractor_hp(detail, month_cols, total_col, _to_int_dict))

    return out


def _aggregate_tractor_hp(detail, month_cols, total_col, to_int_dict) -> dict:
    """Tractor-only power-class aggregates.

    Only the tractor segment publishes a meaningful HP rating in the KAIDA
    sheets (rigids and tippers vary by body, not by engine), so the power
    analysis is scoped to it.

      "tractor_by_hp":       {band: {month: int, ..., "Total": int}}
      "tractor_by_hp_brand": {brand: {band: {month: ..., "Total": int}}}
      "tractor_hp_points":   [{"hp": 500, "band": str, "by_brand": {brand: row}, ...row}]
    """
    out = {"tractor_by_hp": {}, "tractor_by_hp_brand": {}, "tractor_hp_points": []}
    if "HP" not in detail.columns:
        return out
    tr = detail[detail["SegmentNorm"] == "Tractor"].copy()
    if tr.empty:
        return out
    tr["HPBand"] = [hp_band(v) for v in tr["HP"]]
    tr = tr[tr["HPBand"].notna()]
    if tr.empty:
        return out

    value_cols = month_cols + ([total_col] if total_col else [])

    g = tr.groupby("HPBand")[value_cols].sum()
    for band in HP_BAND_ORDER:
        if band in g.index:
            out["tractor_by_hp"][band] = to_int_dict(g.loc[band])

    g = tr.groupby(["BrandNorm", "HPBand"])[value_cols].sum()
    for brand in BRAND_ORDER:
        out["tractor_by_hp_brand"][brand] = {}
        for band in HP_BAND_ORDER:
            if (brand, band) in g.index:
                out["tractor_by_hp_brand"][brand][band] = to_int_dict(g.loc[(brand, band)])

    # Exact ratings, so the front-end can draw the real spread inside a band.
    # Monthly detail is kept per brand as well — the page's month filter has to
    # reach this chart too, and at ~16 ratings the payload stays small.
    pts = tr.groupby("HP")[value_cols].sum()
    by_brand = tr.groupby(["HP", "BrandNorm"])[value_cols].sum()
    for hp in sorted(pts.index):
        entry = {"hp": int(hp), "band": hp_band(hp), **to_int_dict(pts.loc[hp]), "by_brand": {}}
        for brand in BRAND_ORDER:
            if (hp, brand) in by_brand.index:
                row = to_int_dict(by_brand.loc[(hp, brand)])
                if any(row.values()):
                    entry["by_brand"][brand] = row
        if entry["Total"] or entry["by_brand"]:
            out["tractor_hp_points"].append(entry)
    return out


def detect_last_data_month(agg: dict) -> int:
    """Return 1..12 of the latest month with non-zero registrations."""
    m = agg.get("monthly_totals", {})
    last = 0
    for i, mo in enumerate(MONTHS, start=1):
        if m.get(mo, 0) > 0:
            last = i
    return last
