#!/usr/bin/env python3
"""apply_23 ROLLBACK — remove os guards inseridos no drip F — Pós-compra.

Reverse do splicer: remove nós guard-end + guard-cond-* e edges guard-e-*, e re-aponta
a edge do predecessor de cada guard de volta pro send original. Idempotente (no-op se não
há guard). Token de .env.development. Usage: python apply_23_rollback.py [--apply]
"""
import sys, os, re, json, urllib.request, urllib.error

REF = "jsjsmuncfkbsbzqzqhfq"
ORG = "d67ae17a-815d-476d-b3a9-287c7b267997"


def token():
    d = os.path.abspath(os.path.dirname(__file__))
    for _ in range(8):
        p = os.path.join(d, ".env.development")
        if os.path.isfile(p):
            for line in open(p, encoding="utf-8"):
                m = re.search(r"(sbp_[A-Za-z0-9]+)", line)
                if m:
                    return m.group(1)
        nd = os.path.dirname(d)
        if nd == d:
            break
        d = nd
    sys.exit("no token / .env.development")


def q(sql):
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=json.dumps({"query": sql}).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json", "User-Agent": "supabase-cli/2.x"},
    )
    try:
        return json.loads(urllib.request.urlopen(req).read().decode())
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()}")


def unsplice(defn):
    nodes, edges = defn["nodes"], defn["edges"]
    guard_conds = [n for n in nodes if n["id"].startswith("guard-cond-")]
    if not guard_conds:
        return None
    for cond in guard_conds:
        cid = cond["id"]
        true_edge = next((e for e in edges if e["source"] == cid and e.get("sourceHandle") == "source-true"), None)
        pred_edge = next((e for e in edges if e.get("target") == cid), None)
        if true_edge and pred_edge:
            pred_edge["target"] = true_edge["target"]  # predecessor → send de novo
    defn["edges"] = [e for e in edges if not e["id"].startswith("guard-e-")]
    defn["nodes"] = [n for n in nodes if not (n["id"].startswith("guard-cond-") or n["id"] == "guard-end")]
    return defn


def main():
    apply = "--apply" in sys.argv
    rows = q(f"SELECT id, name, definition FROM workflows WHERE organization_id='{ORG}' "
             f"AND trigger_type='stage_changed' AND trigger_config->>'to_stage'='pago'")
    for r in rows:
        defn = r["definition"] if isinstance(r["definition"], dict) else json.loads(r["definition"])
        before = len(defn["nodes"])
        new = unsplice(defn)
        if new is None:
            print(f"SKIP {r['name']} — sem guard")
            continue
        print(f"{'APPLY' if apply else 'DRY'} {r['name']}: nós {before}->{len(new['nodes'])}")
        if apply:
            payload = json.dumps(new).replace("'", "''")
            q(f"UPDATE workflows SET definition='{payload}'::jsonb, updated_at=now() WHERE id='{r['id']}'")
    print("DONE" + ("" if apply else " (dry-run; passe --apply)"))


if __name__ == "__main__":
    main()
