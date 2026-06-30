#!/usr/bin/env python3
"""Motor 100 — wire dispatch media (2026-06-30).

Aligns the 5 weekday reactivation workflows to the Terca model:
- keep only 2 audio nodes (action-2 wave1, action-5 wave2), drop action-8/action-11
  on the 4 non-Terca workflows and rewire edges;
- set audioUrl on action-2/action-5, imageUrl on all image nodes.

Patches workflows.definition via PostgREST (Data API) so handles/positions and
per-day waits/trigger are preserved. Idempotent. PROD.

Reads the account PAT from .env.development (2nd SUPABASE_ACCESS_TOKEN=sbp_ line)
and fetches the prod service_role via the Management API. No secrets in repo.
"""
import json, os, urllib.request

REF = "jsjsmuncfkbsbzqzqhfq"
ORG = "1003870a-ceea-487b-8dd5-910018c7a7d7"
UA = "motor100-wf-edit/1.0"
ENVF = os.environ.get("ENV_FILE", os.path.join(
    os.path.dirname(__file__), "..", "..", "..", ".env.development"))

PUB = f"https://{REF}.supabase.co/storage/v1/object/public/media"
AUDIO_PROS = f"{PUB}/workflow-audios/{ORG}/76eb3a9f-51ce-49f9-b341-a861f5284530.mp3"
AUDIO_POS = f"{PUB}/workflow-audios/{ORG}/e4f87654-4d01-4986-a1ef-f18d13a4fce2.mp3"
IMG = f"{PUB}/workflow-assets/{ORG}/991340c8-a747-431f-be48-dfa1ef08aa7a.png"

WFS = [  # (name, id, remove_extra_audio)
    ("Segunda", "2203a57f-f907-49a4-8489-3fc72c06e0ee", True),
    ("Terca",   "8d5b9cd4-ae1d-4b5c-bfc6-5fa8c1919e10", False),
    ("Quarta",  "762627e2-3512-4ab8-9f06-e0f1978fbfa7", True),
    ("Quinta",  "d824b021-fe82-4836-a8b5-e49a7cc275d3", True),
    ("Sexta",   "9d4df301-14cc-40db-925a-8f7c8d099f6a", True),
]


def service_role():
    pat = None
    for line in open(ENVF, encoding="utf-8"):
        if line.startswith("SUPABASE_ACCESS_TOKEN=sbp_"):
            pat = line.split("=", 1)[1].strip().strip('"')
    if not pat:
        raise SystemExit("PAT sbp_ not found in " + ENVF)
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{REF}/api-keys?reveal=true",
        headers={"Authorization": f"Bearer {pat}", "User-Agent": UA})
    keys = json.load(urllib.request.urlopen(req))
    return [k["api_key"] for k in keys if k.get("name") == "service_role"][0]


def transform(defn, remove_audio):
    nodes, edges = defn["nodes"], defn["edges"]
    for n in nodes:
        d, at = n["data"], n["data"].get("actionType")
        if at == "send_whatsapp_audio" and n["id"] == "action-2":
            d.update(audioUrl=AUDIO_PROS, audioMode="recorded", audioName="Áudio prospecção")
            d.pop("audioSourceId", None)
        elif at == "send_whatsapp_audio" and n["id"] == "action-5":
            d.update(audioUrl=AUDIO_POS, audioMode="recorded", audioName="2º áudio pós prospecção")
            d.pop("audioSourceId", None)
        elif at == "send_whatsapp_image":
            d["imageUrl"] = IMG
    if remove_audio:
        defn["nodes"] = [n for n in nodes if n["id"] not in ("action-8", "action-11")]
        drop = {"action-7__action-8__0", "action-8__action-9__1",
                "action-10__action-11__0", "action-11__action-12__1"}
        edges = [e for e in edges if e["id"] not in drop]
        edges.append({"id": "xy-edge__action-7-action-9", "type": "animated",
                      "source": "action-7", "target": "action-9", "animated": True})
        edges.append({"id": "xy-edge__action-10-action-12", "type": "animated",
                      "source": "action-10", "target": "action-12", "animated": True})
        defn["edges"] = edges
    return defn


def main():
    sr = service_role()
    rest = f"https://{REF}.supabase.co/rest/v1/workflows"
    hdr = {"apikey": sr, "Authorization": f"Bearer {sr}", "Content-Type": "application/json"}
    for name, wid, rm in WFS:
        req = urllib.request.Request(f"{rest}?id=eq.{wid}&select=definition", headers=hdr)
        defn = json.load(urllib.request.urlopen(req))[0]["definition"]
        before = len(defn["nodes"])
        defn = transform(defn, rm)
        body = json.dumps({"definition": defn}).encode("utf-8")
        h = dict(hdr); h["Prefer"] = "return=minimal"
        st = urllib.request.urlopen(urllib.request.Request(
            f"{rest}?id=eq.{wid}", data=body, headers=h, method="PATCH")).status
        na = sum(1 for n in defn["nodes"] if n["data"].get("actionType") == "send_whatsapp_audio")
        ni = sum(1 for n in defn["nodes"] if n["data"].get("actionType") == "send_whatsapp_image")
        print(f"{name:8} PATCH={st} nodes {before}->{len(defn['nodes'])} audio={na} img={ni}")


if __name__ == "__main__":
    main()
