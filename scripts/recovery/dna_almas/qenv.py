#!/usr/bin/env python3
"""Token-less Supabase Management API query helper.
Reads the sbp_* personal access token from .env.development (gitignored) — NO hardcoded secret.
Usage:
    python qenv.py prod < sql_from_stdin
    python qenv.py prod path/to/file.sql
    echo "SELECT 1" | python qenv.py prod
"""
import sys, os, re, json, urllib.request, urllib.error

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

REFS = {"prod": "jsjsmuncfkbsbzqzqhfq", "dev": "bcfadphgsibjzivtbjvc"}


def find_env(start):
    d = os.path.abspath(start)
    for _ in range(8):
        p = os.path.join(d, ".env.development")
        if os.path.isfile(p):
            return p
        nd = os.path.dirname(d)
        if nd == d:
            break
        d = nd
    return None


def load_token():
    envp = find_env(os.getcwd()) or find_env(os.path.dirname(__file__))
    if not envp:
        sys.exit("ERROR: .env.development not found")
    for line in open(envp, encoding="utf-8"):
        m = re.search(r"(sbp_[A-Za-z0-9]+)", line)
        if m:
            return m.group(1)
    sys.exit("ERROR: no sbp_ token in .env.development")


def main():
    ref = REFS.get(sys.argv[1] if len(sys.argv) > 1 else "prod", "jsjsmuncfkbsbzqzqhfq")
    if len(sys.argv) > 2:
        sql = open(sys.argv[2], encoding="utf-8").read()
    else:
        sql = sys.stdin.read()
    tok = load_token()
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        data=json.dumps({"query": sql}).encode("utf-8"),
        method="POST",
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json", "User-Agent": "supabase-cli/2.x"},
    )
    try:
        with urllib.request.urlopen(req) as r:
            print(json.dumps(json.loads(r.read().decode()), indent=2, ensure_ascii=False, default=str))
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
