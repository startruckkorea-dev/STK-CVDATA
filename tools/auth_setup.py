"""One-time MSAL device-code login.

Runs interactively on your PC, prints a code, you open the URL on any
device, enter the code, and sign in with the company Microsoft account.
The resulting refresh token + account info is saved to .msal_cache.json
(gitignored) AND printed as base64 so you can paste it into the GitHub
Actions secret MSAL_CACHE_B64.

Usage:
  python tools/auth_setup.py

Requires:
  - Azure AD app: "Allow public client flows" = Yes
  - Delegated permissions: Files.Read.All, Sites.Read.All (already granted)
"""
from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path

import msal

CLIENT_ID = os.environ.get("GRAPH_CLIENT_ID", "9b247088-5afb-4622-9c5e-b5f27142761d")
TENANT_ID = os.environ.get("GRAPH_TENANT_ID", "19cab1f5-21f4-44df-8ac6-96d6ca595203")
AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"

# Delegated scopes (User.Read is required so Graph can return the user object;
# Sites/Files .Read.All let us walk the SharePoint folder)
SCOPES = ["User.Read", "Sites.ReadWrite.All", "Files.ReadWrite.All"]

CACHE_PATH = Path(".msal_cache.json")


def main() -> int:
    cache = msal.SerializableTokenCache()
    if CACHE_PATH.exists():
        cache.deserialize(CACHE_PATH.read_text(encoding="utf-8"))

    app = msal.PublicClientApplication(
        CLIENT_ID,
        authority=AUTHORITY,
        token_cache=cache,
    )

    # Try silent first (in case we already have a usable account)
    accounts = app.get_accounts()
    if accounts:
        print(f"found cached account: {accounts[0].get('username')}")
        result = app.acquire_token_silent(SCOPES, account=accounts[0])
        if result and "access_token" in result:
            print("silent auth OK — refreshing cache")
            _save_cache(cache)
            _print_secret(cache)
            return 0
        print("silent auth failed, falling back to device code")

    flow = app.initiate_device_flow(scopes=SCOPES)
    if "user_code" not in flow:
        print(f"device flow init failed: {flow.get('error_description', flow)}")
        return 1

    print("\n" + "=" * 70)
    print(flow["message"])
    print("=" * 70 + "\n")
    print("Waiting for sign-in...")

    result = app.acquire_token_by_device_flow(flow)
    if "access_token" not in result:
        print(f"auth failed: {result.get('error_description', result)}")
        return 1

    user = result.get("id_token_claims", {}).get("preferred_username")
    print(f"\nsigned in as: {user}")
    _save_cache(cache)
    _print_secret(cache)
    return 0


def _save_cache(cache: msal.SerializableTokenCache) -> None:
    if cache.has_state_changed:
        CACHE_PATH.write_text(cache.serialize(), encoding="utf-8")
        print(f"cache saved to {CACHE_PATH.resolve()}")


def _print_secret(cache: msal.SerializableTokenCache) -> None:
    raw = cache.serialize().encode("utf-8")
    b64 = base64.b64encode(raw).decode("ascii")
    print()
    print("-" * 70)
    print("Add this to GitHub Actions secrets as MSAL_CACHE_B64:")
    print("-" * 70)
    print(b64)
    print("-" * 70)
    print()
    print("Steps:")
    print("  1. GitHub repo -> Settings -> Secrets and variables -> Actions")
    print("  2. New repository secret")
    print("     Name:  MSAL_CACHE_B64")
    print("     Value: (paste the long base64 string above)")
    print("  3. Re-run 'Sync data and deploy' workflow.")


if __name__ == "__main__":
    sys.exit(main())
