"""Constrói a base enxuta de CNPJ da Lista Fria (ADR-0043).

Baixa a base aberta do CNPJ da Receita Federal do mês, filtra e grava a base em PARTES Parquet de até
50 MB (o Storage do Supabase limita cada arquivo a 52 MB no projeto inteiro), ordenadas por
(uf, cnae, municipio) para o worker ler só as fatias que a busca pede.

    python construir.py --saida ./saida                      # baixa o mês mais recente
    python construir.py --saida ./saida --mes 2026-10        # um mês específico
    python construir.py --saida ./saida --zips ./zip         # usa zips já baixados (desenvolvimento)
    python construir.py --saida ./saida --dividir base.parquet --mes 2026-10   # só refatia um Parquet já pronto

Entra:  só estabelecimento ATIVO, sem empresário individual (natureza 2135: o CNPJ é uma pessoa
        física) e com e-mail ou telefone.
Sai:    cnpj-enxuto-NNN-<hash>.parquet (partes imutáveis) e manifesto.json com a lista delas.
Colunas: cnpj, razao, fantasia, cnae, cnae_desc, uf, municipio, bairro, endereco, tel, email, porte,
        matriz, celular, email_compartilhado.
Marcas: matriz               é a matriz (uma empresa com 5 filiais não vira 5 contatos cobrados);
        celular              telefone de 9 dígitos começando em 9 (serve para WhatsApp);
        email_compartilhado  o mesmo e-mail em 6 ou mais CNPJs (contador provável).
Fora:   sócios, CPF e qualquer dado que não seja o contato da empresa.

O manifesto traz mês, linhas e, por parte, nome, tamanho e sha256. O nome da parte leva os 12 primeiros
caracteres do hash: arquivo com aquele nome nunca muda, então o worker nunca mistura versão velha com nova.
Disco: processa um arquivo por vez e apaga o CSV depois de ler; o pico é o maior CSV (~8 GB).
Só depende de `duckdb` (pip install duckdb).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import time
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from base64 import b64encode

import duckdb

# Link PÚBLICO da pasta de dados abertos da Receita (Nextcloud do Serpro). Não é segredo.
COMPARTILHAMENTO = os.environ.get("RFB_SHARE", "gn672Ad4CF8N6TK")
BASE = os.environ.get("RFB_WEBDAV", "https://arquivos.receitafederal.gov.br/public.php/webdav")
PASTA = "Dados/Cadastros/CNPJ"
EMAIL_COMPARTILHADO_MINIMO = 6
NATUREZA_EMPRESARIO_INDIVIDUAL = "2135"
# O Storage do Supabase recusa arquivo acima de 52.428.800 bytes (limite do projeto). Margem para o cabeçalho.
TETO_PARTE_BYTES = 50_000_000
LINHAS_POR_PARTE = 800_000
VERSAO_LAYOUT = 2

ESTAB_COLS = ["cnpj_basico", "cnpj_ordem", "cnpj_dv", "matriz", "fantasia", "situacao", "dt_situacao", "motivo",
              "cidade_ext", "pais", "dt_inicio", "cnae", "cnae_sec", "tipo_logr", "logradouro", "numero",
              "complemento", "bairro", "cep", "uf", "municipio", "ddd1", "tel1", "ddd2", "tel2", "ddd_fax",
              "fax", "email", "sit_especial", "dt_sit_especial"]
EMP_COLS = ["cnpj_basico", "razao", "natureza", "qualif", "capital", "porte", "ente"]


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def _requisicao(caminho: str, metodo: str = "GET", extra: dict | None = None) -> urllib.request.Request:
    auth = b64encode(f"{COMPARTILHAMENTO}:".encode()).decode()
    cab = {"Authorization": f"Basic {auth}", "User-Agent": "torque-lista-fria-base/1"}
    cab.update(extra or {})
    return urllib.request.Request(f"{BASE}/{caminho}", method=metodo, headers=cab)


def mes_mais_recente() -> str:
    req = _requisicao(f"{PASTA}/", "PROPFIND", {"Depth": "1"})
    corpo = urllib.request.urlopen(req, timeout=60).read()
    meses = []
    for h in ET.fromstring(corpo).iter("{DAV:}href"):
        m = re.search(r"/(\d{4}-\d{2})/?$", h.text or "")
        if m:
            meses.append(m.group(1))
    if not meses:
        sys.exit("Nenhuma pasta AAAA-MM encontrada na Receita: o layout publicado mudou?")
    return max(meses)


def baixar(mes: str, nome: str, destino: str) -> str:
    arq = os.path.join(destino, nome)
    if os.path.exists(arq) and os.path.getsize(arq) > 0:
        return arq
    log(f"baixando {nome}")
    with urllib.request.urlopen(_requisicao(f"{PASTA}/{mes}/{nome}"), timeout=300) as r, open(arq + ".parte", "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    os.replace(arq + ".parte", arq)
    return arq


def sem_acento_maiusculo(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").upper()


def extrair(zip_path: str, destino: str) -> list[str]:
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(destino)
        return [os.path.join(destino, n) for n in z.namelist()]


def sha256_de(caminho: str) -> str:
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        for bloco in iter(lambda: f.read(1 << 22), b""):
            h.update(bloco)
    return h.hexdigest()


def dividir(con, tabela: str, saida: str, mes: str | None, linhas_por_parte: int = LINHAS_POR_PARTE) -> dict:
    """Fatia `tabela` (já ordenada) em partes de até TETO_PARTE_BYTES e grava o manifesto.

    Refaz com partes menores se alguma passar do teto. O nome leva o hash: parte publicada é imutável.
    """
    os.makedirs(saida, exist_ok=True)
    total = con.execute(f"SELECT count(*) FROM {tabela}").fetchone()[0]
    while True:
        for velho in os.listdir(saida):
            if velho.startswith("cnpj-enxuto-") or velho.startswith("parte-"):
                os.remove(os.path.join(saida, velho))
        partes = []
        for n, inicio in enumerate(range(0, total, linhas_por_parte)):
            tmp = os.path.join(saida, f"parte-{n:03d}.tmp")
            con.execute(f"""COPY (SELECT * FROM {tabela} LIMIT {linhas_por_parte} OFFSET {inicio}) TO '{tmp}'
                            (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)""")
            sha = sha256_de(tmp)
            nome = f"cnpj-enxuto-{n:03d}-{sha[:12]}.parquet"
            os.replace(tmp, os.path.join(saida, nome))
            partes.append({"nome": nome, "bytes": os.path.getsize(os.path.join(saida, nome)), "sha256": sha,
                           "linhas": min(linhas_por_parte, total - inicio)})
        maior = max(p["bytes"] for p in partes)
        if maior <= TETO_PARTE_BYTES:
            break
        linhas_por_parte = max(10_000, int(linhas_por_parte * TETO_PARTE_BYTES * 0.9 / maior))
        log(f"parte de {maior / 1e6:.1f} MB passou do teto; refazendo com {linhas_por_parte} linhas por parte")
    conjunto = hashlib.sha256("\n".join(f"{p['nome']}:{p['sha256']}" for p in partes).encode()).hexdigest()
    manifesto = {"mes": mes, "linhas": total, "bytes": sum(p["bytes"] for p in partes), "sha256": conjunto,
                 "construido_em": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "versao_layout": VERSAO_LAYOUT,
                 "arquivos": partes}
    with open(os.path.join(saida, "manifesto.json"), "w") as f:
        json.dump(manifesto, f, indent=1)
    return manifesto


def construir(zips: str | None, mes: str | None, saida: str, trabalho: str) -> None:
    os.makedirs(saida, exist_ok=True)
    os.makedirs(trabalho, exist_ok=True)
    baixando = zips is None
    if baixando:
        mes = mes or mes_mais_recente()
        zips = os.path.join(trabalho, "zip")
        os.makedirs(zips, exist_ok=True)
        log(f"mês da Receita: {mes}")
    csvdir = os.path.join(trabalho, "csv")
    os.makedirs(csvdir, exist_ok=True)

    def obter(nome: str) -> str:
        return baixar(mes, nome, zips) if baixando else os.path.join(zips, nome)

    con = duckdb.connect(os.path.join(trabalho, "construcao.duckdb"))
    con.execute("PRAGMA threads=4")
    con.execute(f"PRAGMA temp_directory='{trabalho}/tmp'")
    con.execute("DROP TABLE IF EXISTS emp; DROP TABLE IF EXISTS est; DROP TABLE IF EXISTS cnae; DROP TABLE IF EXISTS mun")

    def csv_sql(arquivos: list[str], cols: list[str]) -> str:
        defs = "{" + ", ".join(f"'{c}': 'VARCHAR'" for c in cols) + "}"
        return (f"read_csv({arquivos!r}, delim=';', header=false, quote='\"', escape='\"', "
                f"encoding='windows-1252', columns={defs}, ignore_errors=true)")

    # Tabelas pequenas.
    for nome, tabela, cols in (("Cnaes.zip", "cnae", ["codigo", "descricao"]), ("Municipios.zip", "mun", ["codigo", "nome"])):
        arqs = extrair(obter(nome), csvdir)
        con.execute(f"CREATE TABLE {tabela} AS SELECT * FROM {csv_sql(arqs, cols)}")
        for a in arqs:
            os.remove(a)

    # Empresas: só o que a junção precisa, sem empresário individual.
    con.execute("CREATE TABLE emp (cnpj_basico VARCHAR, razao VARCHAR, porte VARCHAR)")
    for i in range(10):
        zp = obter(f"Empresas{i}.zip")
        arqs = extrair(zp, csvdir)
        con.execute(f"""INSERT INTO emp SELECT cnpj_basico, razao, porte FROM {csv_sql(arqs, EMP_COLS)}
                        WHERE natureza <> '{NATUREZA_EMPRESARIO_INDIVIDUAL}'""")
        for a in arqs:
            os.remove(a)
        if baixando:
            os.remove(zp)
        log(f"Empresas{i} ok")

    # Estabelecimentos: ativos, de empresa que não é empresário individual, com algum contato.
    con.execute("""CREATE TABLE est (cnpj VARCHAR, cnpj_basico VARCHAR, matriz BOOLEAN, fantasia VARCHAR, cnae VARCHAR,
        uf VARCHAR, municipio VARCHAR, bairro VARCHAR, endereco VARCHAR, tel VARCHAR, email VARCHAR)""")
    for i in range(10):
        zp = obter(f"Estabelecimentos{i}.zip")
        arqs = extrair(zp, csvdir)
        con.execute(f"""INSERT INTO est
            SELECT e.cnpj_basico || e.cnpj_ordem || e.cnpj_dv, e.cnpj_basico, e.matriz = '1',
                   NULLIF(trim(e.fantasia), ''), e.cnae, e.uf, m.nome, NULLIF(trim(e.bairro), ''),
                   NULLIF(trim(concat_ws(' ', e.tipo_logr, e.logradouro, e.numero)), ''),
                   CASE WHEN length(regexp_replace(coalesce(e.ddd1,'') || coalesce(e.tel1,''), '[^0-9]', '', 'g')) >= 10
                        THEN regexp_replace(e.ddd1 || e.tel1, '[^0-9]', '', 'g') END,
                   CASE WHEN e.email LIKE '%@%' THEN lower(trim(e.email)) END
            FROM {csv_sql(arqs, ESTAB_COLS)} e
            LEFT JOIN mun m ON m.codigo = e.municipio
            WHERE e.situacao = '02' AND e.uf <> '' AND e.cnae <> ''
              AND (e.email LIKE '%@%' OR length(coalesce(e.tel1, '')) >= 8)""")
        for a in arqs:
            os.remove(a)
        if baixando:
            os.remove(zp)
        log(f"Estabelecimentos{i} ok")

    log("juntando, marcando e ordenando")
    con.execute(f"""CREATE OR REPLACE TABLE ordenada AS
        WITH comp AS (SELECT email FROM est WHERE email IS NOT NULL GROUP BY email HAVING count(*) >= {EMAIL_COMPARTILHADO_MINIMO})
        SELECT e.cnpj, p.razao, e.fantasia, e.cnae, c.descricao AS cnae_desc, e.uf,
               upper(strip_accents(e.municipio)) AS municipio, e.bairro, e.endereco, e.tel, e.email, p.porte,
               e.matriz,
               (e.tel IS NOT NULL AND length(e.tel) = 11 AND substr(e.tel, 3, 1) = '9') AS celular,
               (e.email IS NOT NULL AND e.email IN (SELECT email FROM comp)) AS email_compartilhado
        FROM est e
        JOIN emp p USING (cnpj_basico)
        LEFT JOIN cnae c ON c.codigo = e.cnae
        WHERE e.tel IS NOT NULL OR e.email IS NOT NULL
        ORDER BY e.uf, e.cnae, 7, e.cnpj""")
    manifesto = dividir(con, "ordenada", saida, mes)
    con.close()
    shutil.rmtree(csvdir, ignore_errors=True)
    log(f"pronto: {manifesto['linhas']} linhas em {len(manifesto['arquivos'])} partes, {manifesto['bytes'] / 1e9:.2f} GB, mês {mes}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--saida", required=True)
    ap.add_argument("--mes")
    ap.add_argument("--zips", help="pasta com os zips já baixados (pula o download)")
    ap.add_argument("--dividir", help="refatia um Parquet já pronto (ordenado por uf, cnae, municipio, cnpj) e sai")
    ap.add_argument("--trabalho", default=None, help="pasta temporária (padrão: <saida>/_trabalho)")
    a = ap.parse_args()
    if a.dividir:
        c = duckdb.connect(":memory:")
        c.execute(f"CREATE TABLE ordenada AS SELECT * FROM read_parquet('{a.dividir}')")
        m = dividir(c, "ordenada", a.saida, a.mes or "local")
        log(f"pronto: {m['linhas']} linhas em {len(m['arquivos'])} partes, {m['bytes'] / 1e9:.2f} GB")
        sys.exit(0)
    construir(a.zips, a.mes or ("local" if a.zips else None), a.saida, a.trabalho or os.path.join(a.saida, "_trabalho"))
