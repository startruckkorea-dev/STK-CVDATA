"""Build step — raw xlsx -> build/data/*.json.

Reads the KAIDA / KAMA / CV_Data folders and emits compact JSON aggregates that
the static HTML pages consume client-side.

--raw can point straight at the SharePoint folder synced into Explorer
(mbtruck-cvdata), so there is no local copy of the source to keep in step.
Set CV_RAW_DIR once and plain `python tools/build_site.py` uses it.

The output is STAGING, not the deployed site: build/ is gitignored, and the
pages read their JSON from SharePoint. Publish it from the site's
"관리 → 데이터 발행" page — that upload is what users actually see.

Usage:
  python tools/build_site.py
  python tools/build_site.py --raw "C:/Users/.../mbtruck-cvdata" --out build/data
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from cv_data_loader import (
    COL_BODY_MAKER,
    COL_DOMESTIC,
    COL_MANUFACTURER,
    COL_MODEL_CATEGORY,
    COL_MODEL_DETAIL,
    COL_OWNER_REGION,
    COL_OWNER_TYPE,
    COL_PURPOSE,
    COL_PURPOSE_DETAIL,
    COL_SIZE,
    COL_TRANSMISSION,
    COL_YEAR_TYPE,
    SIZE_ORDER,
    list_available_years as cv_list_years,
    load_data_combined,
)
from kaida_processor import (
    aggregate_kaida,
    detect_last_data_month,
    get_available_kaida_years,
    load_kaida_year,
)
from kama_processor import (
    aggregate_kama,
    get_available_kama_years,
    load_kama_year,
)


def _write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"  -> {path.relative_to(path.parents[2])} ({path.stat().st_size:,} bytes)")


def build_kaida(raw_root: Path, out_dir: Path) -> list[int]:
    print("[KAIDA]")
    years = get_available_kaida_years(raw_root)
    if not years:
        print("  (no KAIDA folders found — skipping)")
        return []
    for year in years:
        detail = load_kaida_year(raw_root, year)
        if detail.empty:
            print(f"  {year}: empty, skip")
            continue
        agg = aggregate_kaida(detail)
        agg["year"] = year
        agg["last_data_month"] = detect_last_data_month(agg)
        _write_json(out_dir / f"kaida_{year}.json", agg)
    return years


def build_kama(raw_root: Path, out_dir: Path) -> list[int]:
    print("[KAMA]")
    years = get_available_kama_years(raw_root)
    if not years:
        print("  (no KAMA folders found — skipping)")
        return []
    for year in years:
        detail = load_kama_year(raw_root, year)
        if detail.empty:
            print(f"  {year}: empty, skip")
            continue
        agg = aggregate_kama(detail)
        agg["year"] = year
        _write_json(out_dir / f"kama_{year}.json", agg)
    return years


def _aggregate_cv_data(df: pd.DataFrame) -> dict:
    """Compress CV_DATA rows to per-page aggregates (no raw row dump)."""
    if df.empty:
        return {}

    def vc(col: str, top: int | None = None) -> list[dict]:
        if col not in df.columns:
            return []
        s = df[col].value_counts()
        if top:
            s = s.head(top)
        return [{"label": str(k), "count": int(v)} for k, v in s.items()]

    def grouped(by_cols: list[str], agg_col: str = "count", top: int | None = None) -> list[dict]:
        present = [c for c in by_cols if c in df.columns]
        if not present:
            return []
        if agg_col == "count":
            g = df.groupby(present).size().reset_index(name="count")
        else:
            g = df.groupby(present)[agg_col].agg(["count", "mean", "median", "min", "max"]).reset_index()
        g = g.sort_values(by=g.columns[-1], ascending=False)
        if top:
            g = g.head(top)
        return g.to_dict(orient="records")

    # Overview slice
    overview = {
        "total": int(len(df)),
        "by_manufacturer": vc(COL_MANUFACTURER),
        "by_size": vc(COL_SIZE),
        "by_owner_region": vc(COL_OWNER_REGION, top=20),
        "by_owner_type": vc(COL_OWNER_TYPE),
        "by_transmission": vc(COL_TRANSMISSION),
        "by_domestic": vc(COL_DOMESTIC),
        "by_month": (df.groupby("등록월").size().reset_index(name="count")
                       .to_dict(orient="records")) if "등록월" in df.columns else [],
        "monthly_by_brand": (
            df[df[COL_MANUFACTURER].isin(df[COL_MANUFACTURER].value_counts().head(6).index)]
              .groupby([COL_MANUFACTURER, "등록월"]).size().reset_index(name="count")
              .to_dict(orient="records")
        ) if COL_MANUFACTURER in df.columns and "등록월" in df.columns else [],
        "monthly_by_domestic": (
            df.groupby([COL_DOMESTIC, "등록월"]).size().reset_index(name="count")
              .to_dict(orient="records")
        ) if COL_DOMESTIC in df.columns and "등록월" in df.columns else [],
    }

    # Bestselling models
    if COL_MODEL_DETAIL in df.columns:
        top_models = (
            df.groupby([COL_MANUFACTURER, COL_MODEL_DETAIL])
              .agg(count=(COL_MODEL_DETAIL, "size"),
                   avg_price=("취득가_만원", "mean"))
              .reset_index()
              .sort_values("count", ascending=False)
              .head(20)
        )
        top_models["avg_price"] = top_models["avg_price"].round().astype(int)
        bestselling = top_models.to_dict(orient="records")
    else:
        bestselling = []

    # Cargo (truck) slice
    cargo = {}
    if COL_MODEL_CATEGORY in df.columns:
        cargo_df = df[df[COL_MODEL_CATEGORY].str.contains("트럭", na=False)]
        if not cargo_df.empty:
            cargo = {
                "total": int(len(cargo_df)),
                "purpose_hierarchy": grouped([COL_PURPOSE, COL_PURPOSE_DETAIL], top=120),
                "purpose_detail_top": vc(COL_PURPOSE_DETAIL, top=20) if COL_PURPOSE_DETAIL in cargo_df.columns else [],
                "axle_by_size": grouped(["축거형식", COL_SIZE]),
                "axle_by_manufacturer": grouped(["축거형식", COL_MANUFACTURER], top=80),
                "axle_by_purpose": grouped(["축거형식", COL_PURPOSE], top=80),
            }

    # Price analysis (per model min/median/avg/max)
    price = {}
    if "취득가_만원" in df.columns:
        nz = df[df["취득가_만원"] > 0]
        if not nz.empty:
            per_model = (
                nz.groupby([COL_MANUFACTURER, COL_MODEL_DETAIL])["취득가_만원"]
                  .agg(["count", "mean", "median", "min", "max"])
                  .reset_index()
                  .sort_values("count", ascending=False)
                  .head(30)
            )
            for c in ("mean", "median", "min", "max"):
                per_model[c] = per_model[c].round().astype(int)
            per_model["count"] = per_model["count"].astype(int)
            price = {
                "per_model": per_model.to_dict(orient="records"),
                "by_size_quartiles": (
                    nz.groupby(COL_SIZE)["취득가_만원"]
                      .agg(["count", "mean", "median",
                            lambda s: int(s.quantile(0.25)),
                            lambda s: int(s.quantile(0.75)),
                            "min", "max"])
                      .reset_index()
                      .rename(columns={"<lambda_0>": "q25", "<lambda_1>": "q75"})
                      .round({"mean": 0, "median": 0})
                      .to_dict(orient="records")
                ),
                "by_year_type": (
                    nz.groupby(COL_YEAR_TYPE)["취득가_만원"]
                      .agg(["count", "mean", "median", "min", "max"])
                      .reset_index()
                      .round({"mean": 0, "median": 0})
                      .to_dict(orient="records")
                ) if COL_YEAR_TYPE in nz.columns else [],
            }

    # Bodybuilder analysis
    body = {}
    if COL_BODY_MAKER in df.columns:
        body_df = df[df[COL_BODY_MAKER] != "미분류"]
        if not body_df.empty:
            body = {
                "top_makers": vc(COL_BODY_MAKER, top=20),
                "maker_by_purpose": grouped([COL_BODY_MAKER, COL_PURPOSE_DETAIL], top=200),
                "maker_by_chassis": grouped([COL_BODY_MAKER, COL_MANUFACTURER], top=200),
                "maker_avg_price": (
                    body_df[body_df["취득가_만원"] > 0]
                        .groupby(COL_BODY_MAKER)["취득가_만원"]
                        .agg(["count", "mean"])
                        .reset_index()
                        .round({"mean": 0})
                        .sort_values("count", ascending=False)
                        .head(15)
                        .to_dict(orient="records")
                ) if "취득가_만원" in body_df.columns else [],
            }

    return {
        "overview": overview,
        "bestselling": bestselling,
        "cargo": cargo,
        "price": price,
        "body": body,
        "size_order": SIZE_ORDER,
    }


def sync_translations(raw_root: Path) -> None:
    """If raw_data/translations.json exists (mirrored from SharePoint),
    overwrite the bundled site/i18n/translations.json with it. Other pages
    read the local file for fast loads; the translate editor reads/writes
    SharePoint directly via Graph.
    """
    src = raw_root / "translations.json"
    if not src.exists():
        print("[i18n] no SharePoint translations.json yet — keeping bundled seed")
        return
    dst = Path("docs/i18n/translations.json").resolve()
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(src, dst)
    print(f"[i18n] {src.name} -> {dst}")


def build_cv_data(raw_root: Path, out_dir: Path) -> list[int]:
    print("[CV_DATA]")
    years = cv_list_years(raw_root)
    if not years:
        print("  (no CV_DATA files found — skipping)")
        return []
    for year in years:
        df = load_data_combined(raw_root, year)
        if df.empty:
            print(f"  {year}: empty, skip")
            continue
        agg = _aggregate_cv_data(df)
        agg["year"] = year
        _write_json(out_dir / f"cvdata_{year}.json", agg)
    return years


def main() -> None:
    # A Windows console defaults to cp949 here, which cannot encode the em-dash
    # and arrows used in the progress output — without this the build dies after
    # writing the JSON but before the manifest.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser()
    # Point this at the SharePoint folder synced into Explorer and there is no
    # copy to keep in step — the build reads exactly what SharePoint holds.
    # CV_RAW_DIR saves retyping the long OneDrive path on every run.
    parser.add_argument(
        "--raw",
        default=os.environ.get("CV_RAW_DIR", "raw_data"),
        help="raw Excel directory (default: $CV_RAW_DIR or raw_data)",
    )
    # Staging only — build/ is gitignored and never deployed. The site reads
    # its JSON from SharePoint, so the build's job is to produce files for
    # tools/publish_data.py to upload, not to drop them into docs/.
    parser.add_argument("--out", default="build/data", help="JSON output directory")
    args = parser.parse_args()

    raw_root = Path(args.raw).resolve()
    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    if not raw_root.exists():
        print(f"raw directory not found: {raw_root}")
        raise SystemExit(1)

    print(f"raw_data:  {raw_root}")
    print(f"out_dir:   {out_dir}")
    print()

    kaida_years = build_kaida(raw_root, out_dir)
    kama_years = build_kama(raw_root, out_dir)
    cv_years = build_cv_data(raw_root, out_dir)
    sync_translations(raw_root)

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "kaida_years": kaida_years,
        "kama_years": kama_years,
        "cv_years": cv_years,
    }
    _write_json(out_dir / "manifest.json", manifest)
    print("\nDone.")


if __name__ == "__main__":
    main()
