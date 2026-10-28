"""Publica a base enxuta de CNPJ no Storage do Supabase (ADR-0043).

    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python publicar.py --saida ./saida

Cria o bucket privado `lista-fria-base` se não existir e envia, NESSA ORDEM:
  1. cnpj-enxuto.parquet   (o dado)
  2. manifesto.json        (o ponteiro: mês, linhas, sha256)
O manifesto vai por último: ele nunca aponta para um arquivo que ainda não chegou. O worker só baixa
quando o sha256 do manifesto muda e confere o hash do arquivo antes de trocá-lo.

Limite de arquivo: o Storage do Supabase tem um teto global por arquivo (padrão 50 MB). O Parquet tem
~0,4 GB, então o projeto precisa estar com o limite acima disso (Settings > Storage). O script
confere o tamanho que o servidor aceita e para com uma frase clara em vez de falhar no meio do envio.
Só depende da biblioteca padrão.
"""
from __future__ import annotations

import argparse
import http.client
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BUCKET = "lista-fria-base"
ARQUIVO = "cnpj-enxuto.parquet"
MANIFESTO = "manifesto.json"


def sair(msg: str) -> None:
    print(f"ERRO: {msg}", file=sys.stderr)
    sys.exit(1)


def chamar(url: str, chave: str, metodo: str = "GET", corpo: dict | None = None) -> tuple[int, bytes]:
    dados = json.dumps(corpo).encode() if corpo is not None else None
    req = urllib.request.Request(url, data=dados, method=metodo, headers={
        "Authorization": f"Bearer {chave}", "apikey": chave, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def garantir_bucket(base: str, chave: str, limite: int) -> None:
    status, corpo = chamar(f"{base}/storage/v1/bucket/{BUCKET}", chave)
    if status == 200:
        return
    status, corpo = chamar(f"{base}/storage/v1/bucket", chave, "POST",
                           {"id": BUCKET, "name": BUCKET, "public": False, "file_size_limit": limite})
    if status not in (200, 201):
        sair(f"não consegui criar o bucket {BUCKET}: HTTP {status} {corpo[:200]!r}")
    print(f"bucket {BUCKET} criado (privado)")


def enviar(base: str, chave: str, caminho_local: str, nome: str, tipo: str) -> None:
    partes = urllib.parse.urlsplit(base)
    cls = http.client.HTTPSConnection if partes.scheme == "https" else http.client.HTTPConnection
    tamanho = os.path.getsize(caminho_local)
    con = cls(partes.netloc, timeout=1800)
    with open(caminho_local, "rb") as f:
        con.request("POST", f"/storage/v1/object/{BUCKET}/{urllib.parse.quote(nome)}", body=f, headers={
            "Authorization": f"Bearer {chave}", "apikey": chave, "Content-Type": tipo,
            "Content-Length": str(tamanho), "x-upsert": "true", "cache-control": "no-cache"})
        r = con.getresponse()
        corpo = r.read()
    con.close()
    if r.status not in (200, 201):
        dica = " (o limite de tamanho por arquivo do projeto pode estar abaixo de %.0f MB)" % (tamanho / 1e6) if r.status in (413, 400) else ""
        sair(f"envio de {nome} falhou: HTTP {r.status} {corpo[:300]!r}{dica}")
    print(f"enviado {nome} ({tamanho / 1e6:.1f} MB)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--saida", required=True, help="pasta que o construir.py gerou")
    a = ap.parse_args()
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    chave = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not chave:
        sair("defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY")
    parquet = os.path.join(a.saida, ARQUIVO)
    manifesto = os.path.join(a.saida, MANIFESTO)
    if not (os.path.exists(parquet) and os.path.exists(manifesto)):
        sair(f"faltam {ARQUIVO} e/ou {MANIFESTO} em {a.saida}: rode construir.py antes")
    m = json.load(open(manifesto))
    if os.path.getsize(parquet) != m["bytes"]:
        sair("o tamanho do parquet não confere com o manifesto")
    garantir_bucket(url, chave, int(m["bytes"] * 1.5))
    enviar(url, chave, parquet, ARQUIVO, "application/octet-stream")
    enviar(url, chave, manifesto, MANIFESTO, "application/json")
    print(f"publicado: mês {m['mes']}, {m['linhas']} linhas, sha256 {m['sha256'][:12]}…")


if __name__ == "__main__":
    main()
