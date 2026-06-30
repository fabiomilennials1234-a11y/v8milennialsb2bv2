#!/usr/bin/env python3
"""Revert Motor 100 dispatch-media wiring (undo apply.py).

- clears audioUrl/audioMode/audioName on action-2/action-5 and imageUrl on image
  nodes (restores the Onda 1 clone state: media unset);
- re-inserts the wave 3/4 audio nodes (action-8, action-11) and their edges on the
  4 non-Terca workflows, removing the action-7->action-9 / action-10->action-12
  rewire edges.

Same auth path as apply.py. PROD.
"""
import json, urllib.request
from apply import service_role, REF, WFS

OFFER = ("Olá, {{nome}}! 👋\nSentimos sua falta por aqui e por isso temos um presente "
         "exclusivo para você voltar a comprar com a Motor 100.\n🎁 Faça um pedido mínimo "
         "de R$200 até sexta-feira e ganhe 3 aditivos para radiador AutoSecurity grátis "
         "junto do seu pedido.\nÉ simples: comprou, ganhou! 😉\nSe quiser aproveitar, é só "
         "responder esta mensagem que nosso time comercial já te atende.")


def audio_node(nid, x, y):
    return {"id": nid, "type": "action", "dragging": False,
            "measured": {"width": 280, "height": 62}, "position": {"x": x, "y": y},
            "selected": False,
            "data": {"type": "action", "label": "Ação",
                     "actionType": "send_whatsapp_audio", "messageTemplate": OFFER}}


def transform(defn, had_extra_audio):
    for n in defn["nodes"]:
        d, at = n["data"], n["data"].get("actionType")
        if at == "send_whatsapp_audio":
            for k in ("audioUrl", "audioMode", "audioName", "audioSourceId"):
                d.pop(k, None)
        elif at == "send_whatsapp_image":
            d.pop("imageUrl", None)
    if had_extra_audio:
        ids = {n["id"] for n in defn["nodes"]}
        if "action-8" not in ids:
            defn["nodes"].append(audio_node("action-8", 391.99999999999994, 1233.5))
        if "action-11" not in ids:
            defn["nodes"].append(audio_node("action-11", 380, 1784))
        rewire = {"xy-edge__action-7-action-9", "xy-edge__action-10-action-12"}
        edges = [e for e in defn["edges"] if e["id"] not in rewire]
        for eid, s, t in [("action-7__action-8__0", "action-7", "action-8"),
                          ("action-8__action-9__1", "action-8", "action-9"),
                          ("action-10__action-11__0", "action-10", "action-11"),
                          ("action-11__action-12__1", "action-11", "action-12")]:
            if not any(e["id"] == eid for e in edges):
                edges.append({"id": eid, "type": "animated", "source": s, "target": t,
                              "animated": True, "selected": False})
        defn["edges"] = edges
    return defn


def main():
    sr = service_role()
    rest = f"https://{REF}.supabase.co/rest/v1/workflows"
    hdr = {"apikey": sr, "Authorization": f"Bearer {sr}", "Content-Type": "application/json"}
    for name, wid, had in WFS:
        req = urllib.request.Request(f"{rest}?id=eq.{wid}&select=definition", headers=hdr)
        defn = json.load(urllib.request.urlopen(req))[0]["definition"]
        before = len(defn["nodes"])
        defn = transform(defn, had)
        body = json.dumps({"definition": defn}).encode("utf-8")
        h = dict(hdr); h["Prefer"] = "return=minimal"
        st = urllib.request.urlopen(urllib.request.Request(
            f"{rest}?id=eq.{wid}", data=body, headers=h, method="PATCH")).status
        print(f"{name:8} PATCH={st} nodes {before}->{len(defn['nodes'])}")


if __name__ == "__main__":
    main()
