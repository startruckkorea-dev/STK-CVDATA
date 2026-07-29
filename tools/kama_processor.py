"""KAMA monthly Excel parser — pure Python.

Ports utils/kama_processor.py from the Streamlit project. KAMA files live in
raw_data/KAMA/{year}/Monthly{year}-{MM}.xlsx and aggregate to brand/segment
monthly + YTD volumes.
"""
from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

KAMA_BRAND_ORDER = ["Hyundai", "Tata Daewoo"]
KAMA_SEGMENT_ORDER = ["Cargo", "Tractor", "Dump"]
KAMA_BRAND_COLORS = {"Hyundai": "#1a56db", "Tata Daewoo": "#e04f2e"}

MONTHS_MM = [f"{i:02d}" for i in range(1, 13)]

_COL_COMPANY = 0
_COL_BLOCK = 3
_COL_MODEL = 4
_COL_MONTH = 7
_COL_YTD = 8

_SKIP_LABELS = {"소  계", "소계", "총     계", "총계", "국산", "OEM 수입", "Export", "FCEV"}
_BLOCK_KEEP = {"트럭", "트럭특장"}


def _normalize_company(label: str) -> str | None:
    s = (label or "").replace(" ", "").strip()
    if s in ("현대", "현대자동차"):
        return "Hyundai"
    if "타타대우" in s or s.startswith("타타"):
        return "Tata Daewoo"
    return None


def classify_kama_model(model_name: str) -> str | None:
    """Classify a KAMA model row into Cargo / Tractor / Dump or None to skip."""
    if not model_name:
        return None
    name = str(model_name).upper()
    if "EXPORT" in name or "FCEV" in name:
        return None
    if "PULL CARGO" in name:
        return None
    if "TRACTOR" in name:
        return "Tractor"
    if "8X4 DUMP" in name or " DUMP" in f" {name}":
        # Filter tiny dumpers (<5T) — usually marked as e.g. "8T DUMP"
        m = re.search(r"^(\d+(?:\.\d+)?)\s*T", name)
        if m and float(m.group(1)) < 5:
            return None
        return "Dump"
    m = re.search(r"^(\d+(?:\.\d+)?)\s*T", name)
    if m and float(m.group(1)) >= 5:
        return "Cargo"
    if "CARGO" in name:
        return "Cargo"
    return None


def _read_one_monthly(path: Path) -> pd.DataFrame:
    """Read a single Monthly{YYYY}-{MM}.xlsx — sheet whose name contains '1-4'."""
    xls = pd.ExcelFile(path, engine="openpyxl")
    sheet = next((s for s in xls.sheet_names if "1-4" in s), xls.sheet_names[0])
    raw = pd.read_excel(path, sheet_name=sheet, header=None, engine="openpyxl")

    out_rows = []
    current_company: str | None = None
    for _, row in raw.iterrows():
        company_cell = row.iloc[_COL_COMPANY] if _COL_COMPANY < len(row) else None
        normalized = _normalize_company(company_cell) if isinstance(company_cell, str) else None
        if normalized:
            current_company = normalized
            continue
        if current_company is None:
            continue

        block = str(row.iloc[_COL_BLOCK]).strip() if _COL_BLOCK < len(row) else ""
        if block and block not in _BLOCK_KEEP:
            continue
        model = row.iloc[_COL_MODEL] if _COL_MODEL < len(row) else None
        if not isinstance(model, str) or not model.strip():
            continue
        if model.strip() in _SKIP_LABELS:
            continue
        seg = classify_kama_model(model)
        if not seg:
            continue
        month_val = row.iloc[_COL_MONTH] if _COL_MONTH < len(row) else 0
        ytd_val = row.iloc[_COL_YTD] if _COL_YTD < len(row) else 0
        out_rows.append({
            "Brand": current_company,
            "Model": model.strip(),
            "Segment": seg,
            "Month": pd.to_numeric(month_val, errors="coerce") or 0,
            "YTD": pd.to_numeric(ytd_val, errors="coerce") or 0,
        })
    return pd.DataFrame(out_rows)


def _month_from_filename(path: Path) -> int:
    m = re.search(r"-(\d{2})\.xlsx$", path.name)
    return int(m.group(1)) if m else 0


def load_kama_year(root: Path, year: int) -> pd.DataFrame:
    """Combine 12 monthly KAMA files into one wide DataFrame."""
    folder = root / "KAMA" / str(year)
    if not folder.exists():
        return pd.DataFrame()
    files = sorted(folder.glob(f"Monthly{year}-*.xlsx"), key=_month_from_filename)
    if not files:
        return pd.DataFrame()

    wide: dict[tuple[str, str, str], dict] = {}
    last_ytd_per_key: dict[tuple[str, str, str], int] = {}

    for path in files:
        mm = _month_from_filename(path)
        if not 1 <= mm <= 12:
            continue
        df = _read_one_monthly(path)
        for _, row in df.iterrows():
            key = (row["Brand"], row["Model"], row["Segment"])
            entry = wide.setdefault(key, {f"M{i:02d}": 0 for i in range(1, 13)})
            entry[f"M{mm:02d}"] = int(row["Month"])
            # YTD will be taken from the latest file that has the key
            last_ytd_per_key[key] = int(row["YTD"])

    rows = []
    for key, monthly in wide.items():
        brand, model, segment = key
        ytd = last_ytd_per_key.get(key, sum(monthly.values()))
        rows.append({
            "Brand": brand,
            "Model": model,
            "Segment": segment,
            **monthly,
            "YTD": ytd,
        })
    return pd.DataFrame(rows)


def get_available_kama_years(root: Path) -> list[int]:
    folder = root / "KAMA"
    if not folder.exists():
        return []
    years = []
    for p in folder.iterdir():
        if p.is_dir() and re.fullmatch(r"\d{4}", p.name):
            years.append(int(p.name))
    return sorted(years, reverse=True)


def aggregate_kama(detail: pd.DataFrame) -> dict:
    """Pivot KAMA detail -> json-friendly aggregates."""
    out = {"by_brand": {}, "by_segment": {}, "by_brand_seg": {}, "monthly_totals": {}}
    if detail.empty:
        return out

    month_cols = [f"M{i:02d}" for i in range(1, 13)]

    def _to_int_dict(row) -> dict:
        d = {f"M{i:02d}": int(row[f"M{i:02d}"]) for i in range(1, 13)}
        d["YTD"] = int(row["YTD"])
        return d

    g = detail.groupby("Brand")[month_cols + ["YTD"]].sum()
    for brand in KAMA_BRAND_ORDER:
        if brand in g.index:
            out["by_brand"][brand] = _to_int_dict(g.loc[brand])

    g = detail.groupby("Segment")[month_cols + ["YTD"]].sum()
    for seg in KAMA_SEGMENT_ORDER:
        if seg in g.index:
            out["by_segment"][seg] = _to_int_dict(g.loc[seg])

    g = detail.groupby(["Brand", "Segment"])[month_cols + ["YTD"]].sum()
    for brand in KAMA_BRAND_ORDER:
        out["by_brand_seg"][brand] = {}
        for seg in KAMA_SEGMENT_ORDER:
            if (brand, seg) in g.index:
                out["by_brand_seg"][brand][seg] = _to_int_dict(g.loc[(brand, seg)])

    totals = detail[month_cols + ["YTD"]].sum()
    out["monthly_totals"] = _to_int_dict(totals)
    return out
