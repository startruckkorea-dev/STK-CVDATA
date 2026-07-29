"""CV_DATA (국토부 등록원본) Excel loader — pure Python.

Ports utils/data_loader.py from the Streamlit project. Loads 상용 + 건설기계
sheets, adds 세그먼트 column, converts price to 만원, exposes column constants.
"""
from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

COL_DOMESTIC = "국산_외산"
COL_MANUFACTURER = "제작사"
COL_MODEL_CATEGORY = "모델구분"
COL_MODEL_DETAIL = "모델상세"
COL_SIZE = "크기"
COL_SHAPE = "차체형상"
COL_FINAL_AXLE = "축거형식"
COL_PURPOSE = "용도"
COL_PURPOSE_DETAIL = "용도상세"
COL_BODY_MAKER = "특장업체"
COL_OWNER_TYPE = "소유자구분"
COL_TRANSMISSION = "변속기"
COL_OWNER_REGION = "소유자_시도"
COL_PRICE = "취득가"
COL_FIRST_REG_YEARMONTH = "최초등록년월"
COL_YEAR_TYPE = "연형"

SIZE_ORDER = ["소형", "준중형", "중형", "준대형", "대형"]

BRAND_COLORS = {
    "현대": "#1a56db",
    "타타대우모빌리티": "#e04f2e",
    "타타대우": "#e04f2e",
    "볼보": "#003057",
    "스카니아": "#d4122a",
    "만": "#f7b731",
    "벤츠": "#888888",
    "이스즈": "#c23616",
    "이베코": "#0097e6",
}


def _normalize_strings(df: pd.DataFrame) -> pd.DataFrame:
    for col in df.select_dtypes(include="object").columns:
        df[col] = df[col].astype(str).str.strip()
        df[col] = df[col].replace({"nan": None, "": None, "None": None})
        df[col] = df[col].fillna("미분류")
    return df


def _add_registration_month(df: pd.DataFrame) -> pd.DataFrame:
    if COL_FIRST_REG_YEARMONTH in df.columns:
        ym = pd.to_numeric(df[COL_FIRST_REG_YEARMONTH], errors="coerce")
        df["등록월"] = (ym % 100).fillna(0).astype(int)
    else:
        df["등록월"] = 0
    return df


def _add_price_만원(df: pd.DataFrame) -> pd.DataFrame:
    if COL_PRICE in df.columns:
        won = pd.to_numeric(df[COL_PRICE], errors="coerce").fillna(0)
        df["취득가_만원"] = (won / 10_000).round().astype(int)
    else:
        df["취득가_만원"] = 0
    return df


def _find_cv_data_file(root: Path, year: int) -> Path | None:
    for p in root.glob(f"{year}_CV_DATA*.xlsx"):
        if not p.name.startswith("~$"):
            return p
    # Older naming variant
    for p in root.glob(f"*{year}*CV_DATA*.xlsx"):
        if not p.name.startswith("~$"):
            return p
    return None


def load_data(root: Path, year: int) -> pd.DataFrame:
    """Load only the 상용 sheet."""
    path = _find_cv_data_file(root, year)
    if not path:
        return pd.DataFrame()
    df = pd.read_excel(path, sheet_name="상용", engine="openpyxl")
    df = _normalize_strings(df)
    df = _add_registration_month(df)
    df = _add_price_만원(df)
    df["세그먼트"] = df[COL_MODEL_CATEGORY].apply(_classify_segment_상용)
    return df


def _classify_segment_상용(category: str) -> str:
    c = (category or "").strip()
    if "트랙터" in c:
        return "트랙터"
    if "트럭" in c or "카고" in c:
        return "카고"
    return "기타"


def load_data_combined(root: Path, year: int) -> pd.DataFrame:
    """Load 상용 + 건설기계 sheets, add 세그먼트 column."""
    path = _find_cv_data_file(root, year)
    if not path:
        return pd.DataFrame()
    xls = pd.ExcelFile(path, engine="openpyxl")
    frames = []
    if "상용" in xls.sheet_names:
        df1 = pd.read_excel(path, sheet_name="상용", engine="openpyxl")
        df1 = _normalize_strings(df1)
        df1["세그먼트"] = df1[COL_MODEL_CATEGORY].apply(_classify_segment_상용)
        frames.append(df1)
    if "건설기계" in xls.sheet_names:
        df2 = pd.read_excel(path, sheet_name="건설기계", engine="openpyxl")
        df2 = _normalize_strings(df2)
        df2["세그먼트"] = "덤프(건설기계)"
        if COL_SIZE in df2.columns:
            df2[COL_SIZE] = df2[COL_SIZE].where(df2[COL_SIZE] != "미분류", "대형")
        frames.append(df2)
    if not frames:
        return pd.DataFrame()
    df = pd.concat(frames, ignore_index=True)
    df = _add_registration_month(df)
    df = _add_price_만원(df)
    return df


def list_available_years(root: Path) -> list[int]:
    years = set()
    for p in root.glob("*CV_DATA*.xlsx"):
        m = re.search(r"(\d{4})", p.name)
        if m:
            years.add(int(m.group(1)))
    return sorted(years, reverse=True)


def get_brand_color(brand: str) -> str:
    return BRAND_COLORS.get((brand or "").strip(), "#9aa1a8")
