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
SEGMENT_ORDER = ["Tractor", "Cargo", "Tipper"]

BRAND_COLORS = {
    "MB": "#231F20",
    "Volvo": "#1A3A82",
    "Scania": "#D4122A",
    "MAN": "#F7B731",
    "IVECO": "#0097E6",
}
SEGMENT_COLORS = {
    "Tractor": "#808080",
    "Cargo": "#1a56db",
    "Tipper": "#e04f2e",
}

_MONTH_TOKEN_RE = re.compile(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)", re.I)


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
    """KAIDA Segment label -> normalized segment, or None to skip."""
    s = (segment or "").strip().lower()
    if "tractor" in s:
        return "Tractor"
    if "dump" in s:
        return "Tipper"
    if "cargo" in s:
        return "Cargo"
    if "van" in s:
        return None
    return None


def _file_month_index(path: Path) -> int:
    """Return 1..12 by matching Jan/Feb/.../Dec token in filename. 0 if none."""
    m = _MONTH_TOKEN_RE.search(path.name)
    if not m:
        return 0
    return MONTHS.index(m.group(1).title()) + 1


def find_kaida_files(root: Path, year: int) -> tuple[Path | None, Path | None]:
    """Locate the latest CV + Dump reports under root/KAIDA {year}/.

    Returns (cv_path, dump_path). Either may be None if missing.
    """
    folder = root / f"KAIDA {year}"
    if not folder.exists():
        return None, None
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

    # Forward-fill Importer + Brand
    for col in ("Importer", "Brand"):
        if col in df.columns:
            df[col] = df[col].ffill()

    # Drop subtotal / grand-total / blank-model rows
    if "Model" in df.columns:
        df = df[df["Model"].notna()]
        df = df[~df["Model"].astype(str).str.strip().str.endswith("Total")]
        df = df[~df["Model"].astype(str).str.strip().str.lower().eq("grand-total")]

    # Coerce numeric
    num_cols = [c for c in MONTHS + ["Total", "HP"] if c in df.columns]
    for c in num_cols:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)

    # Derived columns
    df["BrandNorm"] = df.apply(
        lambda r: map_brand_kaida(r.get("Importer", ""), r.get("Brand", ""), r.get("Model", "")),
        axis=1,
    )
    df["SegmentNorm"] = df.apply(
        lambda r: map_segment_kaida(r.get("Segment", ""), r.get("HP")),
        axis=1,
    )
    df = df[df["BrandNorm"] != "Unknown"]
    df = df[df["SegmentNorm"].notna()]
    return df.reset_index(drop=True)


def load_kaida_year(root: Path, year: int) -> pd.DataFrame:
    """Load + parse + concat CV + Dump reports for one year."""
    cv_path, dump_path = find_kaida_files(root, year)
    frames = []
    if cv_path:
        frames.append(_parse_kaida_excel(cv_path))
    if dump_path:
        df = _parse_kaida_excel(dump_path)
        # Dump report uses Segment="Dump" -> Tipper (already handled)
        if not df.empty:
            df["SegmentNorm"] = "Tipper"
        frames.append(df)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def get_available_kaida_years(root: Path) -> list[int]:
    years = []
    for p in root.glob("KAIDA *"):
        if p.is_dir():
            m = re.search(r"(\d{4})", p.name)
            if m:
                years.append(int(m.group(1)))
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

    return out


def detect_last_data_month(agg: dict) -> int:
    """Return 1..12 of the latest month with non-zero registrations."""
    m = agg.get("monthly_totals", {})
    last = 0
    for i, mo in enumerate(MONTHS, start=1):
        if m.get(mo, 0) > 0:
            last = i
    return last
