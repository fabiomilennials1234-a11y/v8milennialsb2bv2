"""Entrada do serviço: `python -m coletor`.

  IG_DADOS                  /data           volume: contas.json, saude.sqlite, sessoes/
  COLETOR_PORTA             8090
  COLETOR_SEGREDO           (opcional) Bearer exigido nas chamadas
  IG_RITMO_MIN_S / MAX_S    3 / 8           pausa entre perfis
  IG_ATRASO_REQ_MIN_S/MAX_S 1 / 3           atraso interno da biblioteca antes de cada requisição
  IG_CAP_DIA                250             requisições por conta por dia
  IG_JOB_MAX_SEGUIDORES     800             teto por job
"""
from __future__ import annotations

import json
import os
import sys
import time

from .coleta import Config, Ritmo
from .contas import Saude, carregar_contas, caminho_seguro
from .ig import ClienteInstagrapi
from .servidor import Coletor, servir


def _num(nome: str, padrao: float) -> float:
    try:
        v = float(os.environ.get(nome, ""))
        return v if v > 0 else padrao
    except ValueError:
        return padrao


def _log(msg: str) -> None:
    print(json.dumps({"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "msg": msg}), flush=True)


def main() -> None:
    dados = os.environ.get("IG_DADOS", "/data")
    caminho_contas = os.path.join(dados, "contas.json")
    pasta_sessoes = os.path.join(dados, "sessoes")
    os.makedirs(pasta_sessoes, exist_ok=True)
    if not os.path.exists(caminho_contas):
        _log(f"falta {caminho_contas}: crie a lista de contas (ver README)")
        sys.exit(1)
    if not caminho_seguro(caminho_contas):
        # Aviso, não erro: num volume montado do Windows/Docker Desktop o modo vem sempre aberto.
        _log("AVISO: contas.json legível por outros usuários; em produção rode chmod 600")
    contas = carregar_contas(caminho_contas)  # valida no boot; erro não imprime segredo
    ritmo = Ritmo(pausa_min_s=_num("IG_RITMO_MIN_S", 3), pausa_max_s=_num("IG_RITMO_MAX_S", 8))
    cfg = Config(ritmo=ritmo, cap_dia=int(_num("IG_CAP_DIA", 250)), max_seguidores_job=int(_num("IG_JOB_MAX_SEGUIDORES", 800)))
    atraso = (_num("IG_ATRASO_REQ_MIN_S", 1), _num("IG_ATRASO_REQ_MAX_S", 3))

    coletor = Coletor(
        carregar_contas=lambda: carregar_contas(caminho_contas),
        saude=Saude(os.path.join(dados, "saude.sqlite")),
        fabrica=lambda: ClienteInstagrapi(pasta_sessoes, *atraso),
        cfg=cfg,
        log=_log,
    )
    porta = int(_num("COLETOR_PORTA", 8090))
    segredo = os.environ.get("COLETOR_SEGREDO") or None
    _log(f"coletor no ar: {len(contas)} conta(s), cap {cfg.cap_dia}/dia, ritmo {ritmo.pausa_min_s}-{ritmo.pausa_max_s}s, segredo={'sim' if segredo else 'nao'}")
    servir(coletor, porta, segredo).serve_forever()


if __name__ == "__main__":
    main()
