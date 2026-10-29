"""Publica a base enxuta de CNPJ no Storage do Supabase (ADR-0043).

    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python publicar.py --saida ./saida

Cria o bucket privado `lista-fria-base` se não existir e envia, NESSA ORDEM:
  1. as partes `cnpj-enxuto-NNN-<hash>.parquet` que ainda não estão lá (o nome leva o hash do
     conteúdo, então parte já publicada é idêntica e não precisa subir de novo);
  2. `manifesto.json` (o ponteiro: mês, linhas, lista de partes com sha256);
  3. só então apaga do bucket as partes que o manifesto novo não cita.
O manifesto vai depois das partes: ele nunca aponta para um arquivo que ainda não chegou. O worker só
baixa quando o hash do manifesto muda e confere o sha256 de cada parte antes de aceitá-la.

Limite de arquivo: o Storage do Supabase tem um teto global por arquivo no projeto (52.428.800 bytes
aqui). Por isso a base é dividida em partes de até 50 MB. Este script NÃO mexe na configuração do
projeto; se uma parte passar do teto, para antes de enviar qualquer coisa.
Só depende da biblioteca padrão.
"""
from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

BUCKET = "lista-fria-base"
MANIFESTO = "manifesto.json"
TETO_ARQUIVO_BYTES = 52_428_800
NOME_PARTE = re.compile(r"^cnpj-enxuto-\d{3}-[0-9a-f]{12}\.parquet$")
VERSAO_LAYOUT = 2


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


def garantir_bucket(base: str, chave: str) -> None:
    status, _ = chamar(f"{base}/storage/v1/bucket/{BUCKET}", chave)
    if status == 200:
        return
    status, corpo = chamar(f"{base}/storage/v1/bucket", chave, "POST",
                           {"id": BUCKET, "name": BUCKET, "public": False, "file_size_limit": TETO_ARQUIVO_BYTES})
    if status not in (200, 201):
        sair(f"não consegui criar o bucket {BUCKET}: HTTP {status} {corpo[:200]!r}")
    print(f"bucket {BUCKET} criado (privado, teto de {TETO_ARQUIVO_BYTES} bytes por arquivo)")


def listar(base: str, chave: str) -> list[str]:
    status, corpo = chamar(f"{base}/storage/v1/object/list/{BUCKET}", chave, "POST", {"prefix": "", "limit": 1000, "offset": 0})
    if status != 200:
        sair(f"não consegui listar o bucket: HTTP {status} {corpo[:200]!r}")
    return [o["name"] for o in json.loads(corpo)]


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
        sair(f"envio de {nome} falhou: HTTP {r.status} {corpo[:300]!r}")
    print(f"enviado {nome} ({tamanho / 1e6:.1f} MB)")


def sha256_de(caminho: str) -> str:
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        for bloco in iter(lambda: f.read(1 << 22), b""):
            h.update(bloco)
    return h.hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--saida", required=True, help="pasta que o construir.py gerou")
    a = ap.parse_args()
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    chave = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not chave:
        sair("defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY")
    caminho_manifesto = os.path.join(a.saida, MANIFESTO)
    if not os.path.exists(caminho_manifesto):
        sair(f"falta {MANIFESTO} em {a.saida}: rode construir.py antes")
    m = json.load(open(caminho_manifesto))
    if m.get("versao_layout") != VERSAO_LAYOUT or not m.get("arquivos"):
        sair(f"manifesto de layout {m.get('versao_layout')}: este publicador entende o layout {VERSAO_LAYOUT}")

    # Tudo conferido ANTES de enviar qualquer byte.
    for p in m["arquivos"]:
        if not NOME_PARTE.match(p["nome"]) or p["nome"].split("-")[-1][:12] != p["sha256"][:12]:
            sair(f"nome de parte inválido ou fora do hash: {p['nome']}")
        caminho = os.path.join(a.saida, p["nome"])
        if not os.path.exists(caminho):
            sair(f"falta a parte {p['nome']}")
        if os.path.getsize(caminho) != p["bytes"]:
            sair(f"tamanho de {p['nome']} não confere com o manifesto")
        if p["bytes"] > TETO_ARQUIVO_BYTES:
            sair(f"{p['nome']} tem {p['bytes']} bytes, acima do teto de {TETO_ARQUIVO_BYTES} do Storage: refaça com partes menores")
        if sha256_de(caminho) != p["sha256"]:
            sair(f"sha256 de {p['nome']} não confere com o manifesto")

    garantir_bucket(url, chave)
    ja = set(listar(url, chave))
    novas = [p for p in m["arquivos"] if p["nome"] not in ja]
    print(f"{len(m['arquivos'])} partes no manifesto, {len(novas)} novas para enviar")
    for p in novas:
        enviar(url, chave, os.path.join(a.saida, p["nome"]), p["nome"], "application/octet-stream")
    enviar(url, chave, caminho_manifesto, MANIFESTO, "application/json")

    # Só depois do manifesto novo no ar: parte que ele não cita já não tem leitor.
    manter = {p["nome"] for p in m["arquivos"]}
    velhas = [n for n in listar(url, chave) if n.startswith("cnpj-enxuto-") and n not in manter]
    if velhas:
        status, corpo = chamar(f"{url}/storage/v1/object/{BUCKET}", chave, "DELETE", {"prefixes": velhas})
        print(f"removidas {len(velhas)} partes antigas" if status == 200 else f"AVISO: limpeza falhou (HTTP {status}): {corpo[:200]!r}")
    print(f"publicado: mês {m['mes']}, {m['linhas']} linhas em {len(m['arquivos'])} partes, hash {m['sha256'][:12]}…")


if __name__ == "__main__":
    main()
