#!/usr/bin/env python3
"""Repair supabase_migrations.schema_migrations for migrations applied via direct SQL.

Inserts version rows for migrations whose schema is already live in prod but
that were never recorded in the tracker. Idempotent — uses ON CONFLICT.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN")
PROJECT_REF = os.environ.get("SUPABASE_PROJECT_REF", "jsjsmuncfkbsbzqzqhfq")
if not TOKEN:
    sys.exit("ERROR: set SUPABASE_ACCESS_TOKEN (sbp_*) env var")
API = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"

ENTRIES = [
    ("20260520000000", "permission_tab_schema"),
    ("20260520000001", "permission_tab_backfill"),
    ("20260520000002", "leads_delete_policy_update"),
    ("20261031000004", "api_key_usage_log"),
    ("20261031000005", "member_default_admin_permissions"),
    ("20261031000006", "org_default_reorder_cycle"),
    ("20261031000007", "portfolio_trends_rpc"),
    ("20261031000008", "fix_upsell_rls_multi_org"),
]

base = Path(__file__).resolve().parent.parent / "supabase" / "migrations"


def run(sql: str, label: str) -> bool:
    body = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(
        API,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "torque-tracker-repair/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = resp.read().decode()
            print(f"  OK [{resp.status}] {label}")
            if data and data != "[]":
                print(f"     resp: {data[:200]}")
            return True
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"  FAIL [{e.code}] {label}", file=sys.stderr)
        print(f"     {err[:500]}", file=sys.stderr)
        return False


for version, name in ENTRIES:
    # Locate file by version prefix (handles 20261031000008_fix_upsell_rls_multi_org)
    matches = list(base.glob(f"{version}_*.sql"))
    if not matches:
        print(f"  SKIP {version} — no file found", file=sys.stderr)
        continue
    fpath = matches[0]
    sql_content = fpath.read_text(encoding="utf-8")
    # PG array literal — escape via dollar quoting
    sql = (
        "INSERT INTO supabase_migrations.schema_migrations "
        "(version, name, statements) VALUES ("
        f"$ver${version}$ver$, $nm${name}$nm$, "
        f"ARRAY[$stmt${sql_content}$stmt$]"
        ") ON CONFLICT (version) DO NOTHING"
    )
    label = f"{version}_{name}"
    if not run(sql, label):
        print(f"\nSTOPPED at {label}", file=sys.stderr)
        sys.exit(1)

print("\nTracker repair done.")
