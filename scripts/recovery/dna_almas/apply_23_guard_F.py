#!/usr/bin/env python3
"""apply_23 — H4 (go-live): guarda o drip F — Pós-compra (onboarding).

F dispara em stage_changed to_stage=pago mas NÃO tinha guard (apply_18 cobriu só E/B/C/D;
F ficou deferido). Sem guard, um lead que acumula tags e sai de `pago` (ex.: sys:cliente +
sys:renovacao → vai p/ assinante — caso EVERTON real) ainda recebe o onboarding "você comprou
o mapa". Insere, antes de CADA send, um nó condition (field=stage, in_stage=pago):
  predecessor --> [condition] --(source-true)--> send
                              --(source-false)--> [end] (compartilhado)
Ao conectar a instância, isso impede envio contraditório/duplicado.

Splice IDÊNTICO ao apply_18 (mesmo shape de nó/edge/handle). Idempotente (pula se já há condition).
Token de .env.development (sem hardcode). Usage: python apply_23_guard_F.py [--apply]
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


def splice(defn, stage):
    nodes = defn["nodes"]
    edges = defn["edges"]
    if any(n.get("type") == "condition" for n in nodes):
        return None  # já guardado
    sends = [n for n in nodes if n.get("data", {}).get("actionType") == "send_whatsapp"]
    if not sends:
        return None
    end_id = "guard-end"
    base_x = 700
    nodes.append({"id": end_id, "type": "end", "position": {"x": base_x + 260, "y": 900},
                  "measured": {"width": 280, "height": 62},
                  "data": {"type": "end", "label": "Encerrar (saiu do stage)"}})
    for k, s in enumerate(sends):
        cond_id = f"guard-cond-{k}"
        in_edge = next((e for e in edges if e.get("target") == s["id"]), None)
        y = 200 + k * 140
        nodes.append({"id": cond_id, "type": "condition", "position": {"x": base_x, "y": y},
                      "measured": {"width": 280, "height": 62},
                      "data": {"type": "condition", "label": f"Ainda em {stage}?",
                               "conditionMode": "field", "field": "stage",
                               "operator": "in_stage", "value": stage}})
        if in_edge is not None:
            in_edge["target"] = cond_id
        edges.append({"id": f"guard-e-true-{k}", "type": "animated", "source": cond_id,
                      "target": s["id"], "sourceHandle": "source-true", "animated": True})
        edges.append({"id": f"guard-e-false-{k}", "type": "animated", "source": cond_id,
                      "target": end_id, "sourceHandle": "source-false", "animated": True})
    return defn


def main():
    apply = "--apply" in sys.argv
    rows = q(f"SELECT id, name, trigger_config->>'to_stage' AS stage, definition FROM workflows "
             f"WHERE organization_id='{ORG}' AND trigger_type='stage_changed' "
             f"AND trigger_config->>'to_stage'='pago'")
    for r in rows:
        stage = r["stage"]
        defn = r["definition"] if isinstance(r["definition"], dict) else json.loads(r["definition"])
        before = len(defn["nodes"])
        new = splice(defn, stage)
        if new is None:
            print(f"SKIP {r['name']} ({stage}) — já guardado ou sem send")
            continue
        after = len(new["nodes"])
        print(f"{'APPLY' if apply else 'DRY'} {r['name']} ({stage}): nós {before}->{after}")
        if apply:
            payload = json.dumps(new).replace("'", "''")
            q(f"UPDATE workflows SET definition='{payload}'::jsonb, updated_at=now() WHERE id='{r['id']}'")
    print("DONE" + ("" if apply else " (dry-run; passe --apply)"))


if __name__ == "__main__":
    main()
