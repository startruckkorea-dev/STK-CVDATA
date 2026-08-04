"""Microsoft Graph SharePoint -> raw_data/ mirror.

NOT IN USE with the delegated flow: the Entra app has "Allow public client
flows" disabled, so tools/auth_setup.py cannot mint the cache this reads and
every delegated token request fails with AADSTS7000218. Download the raw xlsx
from the SharePoint folder by hand (Explorer sync or the browser) until that
setting changes. The client_credentials path below still works if someone
grants application permissions and supplies GRAPH_CLIENT_SECRET.

Supports two auth flows (auto-selected based on env vars):

  1. Application (client_credentials)
       Requires APPLICATION permissions Files.Read.All + Sites.Read.All
       (granted by an admin).
       Env: GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_TENANT_ID

  2. Delegated (cached refresh token)  -- preferred if you only have
     delegated permissions on the existing SPA app.
       Run tools/auth_setup.py once locally to mint MSAL_CACHE_B64,
       then store it as a GitHub Actions secret.
       Env: GRAPH_CLIENT_ID, GRAPH_TENANT_ID, MSAL_CACHE_B64

SharePoint coordinates (defaults match startruckkorea.sharepoint.com):
  SP_SITE_HOSTNAME   default startruckkorea.sharepoint.com
  SP_SITE_PATH       default /sites/STK-PMM
  SP_FOLDER_PATH     default mbtruck-cvdata

Usage:
  python tools/sharepoint_sync.py [--out raw_data]
"""
from __future__ import annotations

import argparse
import base64
import os
import sys
from pathlib import Path

import msal
import requests

GRAPH = "https://graph.microsoft.com/v1.0"

DEFAULT_CLIENT_ID = "9b247088-5afb-4622-9c5e-b5f27142761d"
DEFAULT_TENANT_ID = "19cab1f5-21f4-44df-8ac6-96d6ca595203"


def env(name: str, default: str | None = None, required: bool = False) -> str | None:
    val = os.environ.get(name, default)
    if required and not val:
        sys.exit(f"missing env: {name}")
    return val


def acquire_token() -> str:
    client_id = env("GRAPH_CLIENT_ID", DEFAULT_CLIENT_ID)
    tenant_id = env("GRAPH_TENANT_ID", DEFAULT_TENANT_ID)
    authority = f"https://login.microsoftonline.com/{tenant_id}"
    client_secret = env("GRAPH_CLIENT_SECRET")
    cache_b64 = env("MSAL_CACHE_B64")
    cache_path = Path(".msal_cache.json")

    # Flow 1: application credentials (cleanest, needs admin grant)
    if client_secret:
        print("auth: client_credentials (Application permission)")
        app = msal.ConfidentialClientApplication(
            client_id, authority=authority, client_credential=client_secret,
        )
        result = app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
        if "access_token" not in result:
            sys.exit(f"client_credentials failed: {result.get('error_description', result)}")
        return result["access_token"]

    # Flow 2: delegated, via cached refresh token
    cache = msal.SerializableTokenCache()
    if cache_b64:
        print("auth: refresh token from MSAL_CACHE_B64")
        try:
            cache.deserialize(base64.b64decode(cache_b64).decode("utf-8"))
        except Exception as e:
            sys.exit(f"failed to decode MSAL_CACHE_B64: {e}")
    elif cache_path.exists():
        print(f"auth: refresh token from {cache_path}")
        cache.deserialize(cache_path.read_text(encoding="utf-8"))
    else:
        sys.exit(
            "no auth credentials. Set either:\n"
            "  - GRAPH_CLIENT_SECRET   (Application permission flow)\n"
            "  - MSAL_CACHE_B64        (Delegated flow — run tools/auth_setup.py first)\n"
            "  - .msal_cache.json file (Delegated flow — local)"
        )

    app = msal.PublicClientApplication(client_id, authority=authority, token_cache=cache)
    accounts = app.get_accounts()
    if not accounts:
        sys.exit("no accounts in MSAL cache — re-run tools/auth_setup.py")

    scopes = ["User.Read", "Sites.ReadWrite.All", "Files.ReadWrite.All"]
    result = app.acquire_token_silent(scopes, account=accounts[0])
    if not result or "access_token" not in result:
        sys.exit(
            "silent token acquisition failed — refresh token may be expired.\n"
            "Re-run tools/auth_setup.py and update the MSAL_CACHE_B64 secret."
        )

    # Persist refreshed cache locally (no-op when running in CI)
    if cache.has_state_changed and not cache_b64:
        cache_path.write_text(cache.serialize(), encoding="utf-8")

    return result["access_token"]


class Graph:
    def __init__(self, token: str):
        self.headers = {"Authorization": f"Bearer {token}"}

    def get(self, path: str) -> dict:
        url = path if path.startswith("http") else f"{GRAPH}{path}"
        r = requests.get(url, headers=self.headers)
        r.raise_for_status()
        return r.json()


def resolve_site_id(graph: Graph, hostname: str, site_path: str) -> str:
    return graph.get(f"/sites/{hostname}:{site_path}")["id"]


def walk_folder(graph: Graph, site_id: str, folder_path: str):
    """Yield (relative_path, download_url, size) for every file in folder_path,
    using the SITE'S DEFAULT DRIVE (= 'Shared Documents' library).
    """
    base = f"/sites/{site_id}/drive/root:/{folder_path}:/children"
    stack = [(base, "")]
    while stack:
        url, prefix = stack.pop()
        data = graph.get(url)
        for item in data["value"]:
            name = item["name"]
            rel = f"{prefix}{name}"
            if "folder" in item:
                stack.append((f"/sites/{site_id}/drive/items/{item['id']}/children", f"{rel}/"))
            else:
                dl = item.get("@microsoft.graph.downloadUrl")
                if not dl:
                    detail = graph.get(f"/sites/{site_id}/drive/items/{item['id']}")
                    dl = detail.get("@microsoft.graph.downloadUrl")
                if dl:
                    yield rel, dl, int(item.get("size", 0))
        next_link = data.get("@odata.nextLink")
        if next_link:
            stack.append((next_link, prefix))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="raw_data")
    args = parser.parse_args()

    hostname = env("SP_SITE_HOSTNAME", "startruckkorea.sharepoint.com")
    site_path = env("SP_SITE_PATH", "/sites/STK-PMM")
    folder_path = env("SP_FOLDER_PATH", "mbtruck-cvdata")

    out_root = Path(args.out).resolve()
    out_root.mkdir(parents=True, exist_ok=True)
    print(f"site     : https://{hostname}{site_path}")
    print(f"folder   : Shared Documents/{folder_path}")
    print(f"target   : {out_root}\n")

    token = acquire_token()
    g = Graph(token)
    site_id = resolve_site_id(g, hostname, site_path)
    print(f"site_id  : {site_id}\n")

    n = 0
    for rel, url, size in walk_folder(g, site_id, folder_path):
        if rel.startswith("~$") or "/~$" in rel:
            continue
        if not rel.lower().endswith((".xlsx", ".xls", ".csv", ".json")):
            continue
        dst = out_root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists() and dst.stat().st_size == size:
            print(f"  = {rel}")
            continue
        print(f"  + {rel} ({size:,} bytes)")
        dst.write_bytes(requests.get(url).content)
        n += 1
    print(f"\nsynced {n} file(s)")


if __name__ == "__main__":
    main()
