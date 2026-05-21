#!/usr/bin/env python
"""One-shot apply of 20261101000000_no_show_count_by_stage_movement.sql to prod."""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

TOKEN = os.environ.get("SUPABASE_ACCESS_TOKEN")
PROJECT = os.environ.get("SUPABASE_PROJECT_REF", "jsjsmuncfkbsbzqzqhfq")
if not TOKEN:
    sys.exit("ERROR: set SUPABASE_ACCESS_TOKEN env var")

API = f"https://api.supabase.com/v1/projects/{PROJECT}/database/query"
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json",
    "User-Agent": "torque-prod-deploy/1.0",
}


def run(sql: str, label: str) -> None:
    body = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(API, data=body, method="POST", headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read().decode()
            print(f"  OK [{r.status}] {label}")
            if data and data != "[]":
                print(f"     resp: {data[:200]}")
    except urllib.error.HTTPError as e:
        print(f"  FAIL [{e.code}] {label}\n     {e.read().decode()[:500]}", file=sys.stderr)
        sys.exit(1)


fname = "supabase/migrations/20261101000000_no_show_count_by_stage_movement.sql"
sql = Path(fname).read_text(encoding="utf-8")
print(f"[1/2] Apply {fname} ({len(sql)} bytes)")
run(sql, "no_show_count_by_stage_movement")

version = "20261101000000"
name = "no_show_count_by_stage_movement"
tracker_sql = (
    "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ("
    f"$ver${version}$ver$, $nm${name}$nm$, "
    f"ARRAY[$stmt${sql}$stmt$]"
    ") ON CONFLICT (version) DO NOTHING"
)
print(f"[2/2] Record in supabase_migrations.schema_migrations")
run(tracker_sql, f"tracker {version}_{name}")
print("\nDone.")
