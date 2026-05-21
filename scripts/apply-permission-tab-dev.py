#!/usr/bin/env python3
"""Apply permission tab migrations to DEV via Supabase Management API.

Dev baseline divergente — supabase db push --include-all blasta migrations
não-desejadas. Este script aplica APENAS os 3 SQL files desta task.
"""
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

PROJECT_REF = "bcfadphgsibjzivtbjvc"
API_BASE = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"
MIGRATIONS = [
    "20260520000000_permission_tab_schema.sql",
    "20260520000001_permission_tab_backfill.sql",
    "20260520000002_leads_delete_policy_update.sql",
]

TOKEN = os.environ.get("SUPABASE_PAT")
if not TOKEN:
    print("ERROR: SUPABASE_PAT env var required", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
MIG_DIR = ROOT / "supabase" / "migrations"


def post_sql(sql: str):
    body = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(
        API_BASE,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "supabase-cli/2.100.1 (manual-migration-apply)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")


def main():
    dry_run = "--dry-run" in sys.argv
    print(f"Mode: {'DRY RUN' if dry_run else 'APPLY'}  Project: {PROJECT_REF}")
    print(f"Migrations: {len(MIGRATIONS)}")
    print()

    for mig in MIGRATIONS:
        version = mig.split("_")[0]
        name = mig[len(version) + 1 : -4]
        path = MIG_DIR / mig
        if not path.exists():
            print(f"[SKIP] {mig} not found")
            continue
        sql = path.read_text(encoding="utf-8")
        print(f"=== {mig} ({len(sql)} bytes) ===")

        if dry_run:
            print("  (dry-run) skipping execute")
            continue

        check_sql = f"SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='{version}'"
        status, body = post_sql(check_sql)
        if status == 200 and body.strip() != "[]":
            print(f"  ALREADY APPLIED — skipping")
            continue

        status, body = post_sql(sql)
        if status != 200 and status != 201:
            print(f"  FAIL [{status}]: {body[:800]}")
            print("Stopping on first failure.")
            sys.exit(1)
        print(f"  EXEC OK")

        esc_sql = sql.replace("'", "''")
        esc_name = name.replace("'", "''")
        record_sql = (
            f"INSERT INTO supabase_migrations.schema_migrations (version, name, statements) "
            f"VALUES ('{version}', '{esc_name}', ARRAY['{esc_sql}']::text[]) "
            f"ON CONFLICT (version) DO NOTHING"
        )
        status, body = post_sql(record_sql)
        if status != 200 and status != 201:
            print(f"  RECORD WARN [{status}]: {body[:500]}")
        else:
            print(f"  RECORDED")

    print()
    print("Done.")


if __name__ == "__main__":
    main()
