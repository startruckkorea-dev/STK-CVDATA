"""docs/data/*.json -> SharePoint  Shared Documents/mbtruck-cvdata/site_data/

The dashboard reads its JSON straight from SharePoint in the browser
(docs/js/data.js), so publishing new numbers is an upload here — not a git
push. The committed docs/data/*.json stays as the fallback for anyone who
can't reach the folder.

Full refresh cycle:
    python tools/sharepoint_sync.py          # SharePoint xlsx -> raw_data/
    python tools/build_site.py               # raw_data/ -> docs/data/*.json
    python tools/publish_data.py             # docs/data/*.json -> SharePoint

Auth reuses the same delegated MSAL cache as sharepoint_sync.py — run
tools/auth_setup.py once, then this works silently. Uploading needs WRITE
permission on the folder; a read-only account gets Graph 403.

Usage:
  python tools/publish_data.py [--src docs/data] [--dry-run]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import requests

# Reuse the token + site resolution that the sync tool already implements, so
# there is exactly one place that knows how to authenticate.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from sharepoint_sync import Graph, acquire_token, env, resolve_site_id  # noqa: E402

GRAPH = "https://graph.microsoft.com/v1.0"
# 4 MB is Graph's ceiling for a simple PUT; above it an upload session is
# required. The built JSON is well under that, so we fail loudly instead of
# silently implementing a second code path that never runs.
SIMPLE_PUT_LIMIT = 4 * 1024 * 1024


def enc_path(path: str) -> str:
    """Percent-encode each segment (folder names contain spaces), keep the /."""
    return "/".join(requests.utils.quote(seg, safe="") for seg in path.split("/"))


def ensure_folder(token: str, site_id: str, folder: str) -> None:
    """Create `folder` under the drive root if it isn't there yet."""
    headers = {"Authorization": f"Bearer {token}"}
    probe = requests.get(
        f"{GRAPH}/sites/{site_id}/drive/root:/{enc_path(folder)}", headers=headers
    )
    if probe.status_code == 200:
        return
    parent, _, name = folder.rpartition("/")
    base = f"{GRAPH}/sites/{site_id}/drive/root"
    url = f"{base}:/{enc_path(parent)}:/children" if parent else f"{base}/children"
    r = requests.post(
        url,
        headers={**headers, "Content-Type": "application/json"},
        json={
            "name": name,
            "folder": {},
            "@microsoft.graph.conflictBehavior": "fail",
        },
    )
    if not r.ok:
        sys.exit(f"could not create {folder}: {r.status_code} {r.text}")
    print(f"created folder: {folder}")


def upload(token: str, site_id: str, folder: str, path: Path) -> None:
    data = path.read_bytes()
    if len(data) > SIMPLE_PUT_LIMIT:
        sys.exit(
            f"{path.name} is {len(data):,} bytes — over Graph's {SIMPLE_PUT_LIMIT:,} "
            "byte simple-upload limit. Split the file or add an upload session."
        )
    target = f"{folder}/{path.name}"
    r = requests.put(
        f"{GRAPH}/sites/{site_id}/drive/root:/{enc_path(target)}:/content",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        data=data,
    )
    if not r.ok:
        detail = r.text
        if r.status_code == 403:
            detail = "no write permission on this folder (Graph 403)"
        sys.exit(f"upload {target} failed: {r.status_code} {detail}")
    print(f"  + {path.name} ({len(data):,} bytes)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", default="docs/data")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    src = Path(args.src).resolve()
    files = sorted(src.glob("*.json"))
    if not files:
        sys.exit(f"no JSON in {src} — run tools/build_site.py first")
    if not (src / "manifest.json").exists():
        sys.exit(
            f"{src}/manifest.json is missing. The browser probes for it to decide "
            "whether SharePoint is live, so publishing without it would leave "
            "every user on the committed fallback."
        )

    hostname = env("SP_SITE_HOSTNAME", "startruckkorea.sharepoint.com")
    site_path = env("SP_SITE_PATH", "/sites/STK-PMM")
    folder = env("SP_FOLDER_PATH", "mbtruck-cvdata") + "/site_data"

    print(f"site   : https://{hostname}{site_path}")
    print(f"target : Shared Documents/{folder}")
    print(f"source : {src}\n")

    if args.dry_run:
        for f in files:
            print(f"  ~ {f.name} ({f.stat().st_size:,} bytes)")
        print(f"\n(dry run — {len(files)} file(s) not uploaded)")
        return

    token = acquire_token()
    site_id = resolve_site_id(Graph(token), hostname, site_path)
    ensure_folder(token, site_id, folder)

    for f in files:
        upload(token, site_id, folder, f)
    print(f"\npublished {len(files)} file(s)")


if __name__ == "__main__":
    main()
