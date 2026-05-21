#!/usr/bin/env python3
"""Apply pending migrations to prod via Supabase Management API."""
import os
import sys
import urllib.request
import urllib.error
import json
from pathlib import Path

TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN")
PROJECT_REF = os.environ.get("SUPABASE_PROJECT_REF", "jsjsmuncfkbsbzqzqhfq")
if not TOKEN:
    sys.exit("ERROR: set SUPABASE_ACCESS_TOKEN (sbp_*) env var")
API = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"

MIGRATIONS = [
    "20261031000005_fix_upsell_rls_multi_org.sql",
    "20261031000006_org_default_reorder_cycle.sql",
    "20261031000007_portfolio_trends_rpc.sql",
]

base = Path(__file__).resolve().parent.parent / "supabase" / "migrations"

def run_sql(sql: str, name: str):
    body = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(
        API,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "torque-prod-deploy/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = resp.read().decode()
            print(f"  OK [{resp.status}] {name}")
            if data and data != "[]":
                print(f"     resp: {data[:200]}")
            return True
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"  FAIL [{e.code}] {name}", file=sys.stderr)
        print(f"     {err[:500]}", file=sys.stderr)
        return False

for fname in MIGRATIONS:
    path = base / fname
    sql = path.read_text(encoding="utf-8")
    print(f"-> {fname} ({len(sql)} bytes)")
    if not run_sql(sql, fname):
        print(f"\nSTOPPED at {fname}", file=sys.stderr)
        sys.exit(1)

print("\nAll migrations applied.")
