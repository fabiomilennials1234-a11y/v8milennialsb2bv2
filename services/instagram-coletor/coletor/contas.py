"""Contas do Instagram usadas na coleta, e a saúde de cada uma.

As credenciais ficam SÓ num arquivo montado no serviço (`contas.json`, modo 600);
nunca no banco do Torque, nunca no worker, nunca numa resposta HTTP. A saúde (quem
está ok, em cooldown ou com checkpoint, e quanto cada conta já usou hoje) fica num
SQLite no volume de dados.

Uma conta de scraping é consumível: o desenho assume que ela cai, e a saúde existe
para que a queda de uma não leve as outras junto.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional


@dataclass(frozen=True)
class Conta:
    username: str
    password: Optional[str] = None
    # Alternativa à senha: o `sessionid` de um login feito num navegador normal.
    # Evita guardar a senha e o desafio de login automatizado.
    sessionid: Optional[str] = None
    # Proxy dessa conta (ex.: residencial). Uma conta, um IP: misturar IPs dispara bloqueio.
    proxy: Optional[str] = None

    def __repr__(self) -> str:  # nunca vaza segredo em log
        return f"Conta({self.username})"


def carregar_contas(caminho: str) -> list[Conta]:
    """Lê `contas.json`. Erro de formato diz a posição, nunca o conteúdo (tem segredo)."""
    with open(caminho, encoding="utf-8") as f:
        bruto = json.load(f)
    if not isinstance(bruto, list):
        raise ValueError("contas.json precisa ser uma lista")
    contas: list[Conta] = []
    vistos: set[str] = set()
    for i, c in enumerate(bruto):
        if not isinstance(c, dict) or not isinstance(c.get("username"), str) or not c["username"].strip():
            raise ValueError(f"contas.json[{i}]: falta username")
        username = c["username"].strip().lstrip("@").lower()
        if username in vistos:
            raise ValueError(f"contas.json[{i}]: username repetido")
        vistos.add(username)
        senha = c.get("password") or None
        sessionid = c.get("sessionid") or None
        if not senha and not sessionid:
            raise ValueError(f"contas.json[{i}]: informe password ou sessionid")
        contas.append(Conta(username, senha, sessionid, c.get("proxy") or None))
    return contas


STATUS = ("ok", "cooldown", "checkpoint", "login_falhou")


class Saude:
    def __init__(
        self,
        caminho_db: str,
        relogio: Callable[[], float] = time.time,
        hoje: Callable[[], str] = lambda: time.strftime("%Y-%m-%d"),
    ) -> None:
        self._relogio = relogio
        self._hoje = hoje
        self._trava = threading.RLock()
        self._db = sqlite3.connect(caminho_db, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.execute(
            """CREATE TABLE IF NOT EXISTS saude (
                 username TEXT PRIMARY KEY,
                 status TEXT NOT NULL DEFAULT 'ok',
                 cooldown_ate REAL,
                 usos_dia INTEGER NOT NULL DEFAULT 0,
                 dia TEXT,
                 ultimo_erro TEXT,
                 ultimo_uso REAL,
                 em_uso INTEGER NOT NULL DEFAULT 0
               )"""
        )
        # Reinício do serviço derruba os jobs: nenhuma conta pode ficar "em uso" para sempre.
        self._db.execute("UPDATE saude SET em_uso = 0")
        self._db.commit()

    def _linha(self, username: str) -> sqlite3.Row:
        self._db.execute("INSERT OR IGNORE INTO saude (username, dia) VALUES (?, ?)", (username, self._hoje()))
        l = self._db.execute("SELECT * FROM saude WHERE username = ?", (username,)).fetchone()
        if l["dia"] != self._hoje():
            self._db.execute("UPDATE saude SET usos_dia = 0, dia = ? WHERE username = ?", (self._hoje(), username))
            l = self._db.execute("SELECT * FROM saude WHERE username = ?", (username,)).fetchone()
        return l

    def _apta(self, l: sqlite3.Row, cap: int) -> bool:
        if l["em_uso"] or l["usos_dia"] >= cap:
            return False
        if l["status"] == "ok":
            return True
        # Cooldown vence sozinho; checkpoint e login_falhou só saem na mão.
        return l["status"] == "cooldown" and (l["cooldown_ate"] or 0) <= self._relogio()

    def escolher(self, contas: list[Conta], cap: int) -> Optional[Conta]:
        """A primeira conta apta, já marcada como em uso (atômico)."""
        with self._trava:
            for c in contas:
                l = self._linha(c.username)
                if self._apta(l, cap):
                    self._db.execute(
                        "UPDATE saude SET em_uso = 1, status = 'ok', cooldown_ate = NULL, ultimo_uso = ? WHERE username = ?",
                        (self._relogio(), c.username),
                    )
                    self._db.commit()
                    return c
        return None

    def soltar(self, username: str) -> None:
        with self._trava:
            self._db.execute("UPDATE saude SET em_uso = 0 WHERE username = ?", (username,))
            self._db.commit()

    def contar_uso(self, username: str, n: int = 1) -> int:
        """Soma `n` requisições ao dia da conta e devolve o total de hoje."""
        with self._trava:
            self._linha(username)
            self._db.execute("UPDATE saude SET usos_dia = usos_dia + ?, ultimo_uso = ? WHERE username = ?", (n, self._relogio(), username))
            self._db.commit()
            return self._linha(username)["usos_dia"]

    def usos_hoje(self, username: str) -> int:
        with self._trava:
            return self._linha(username)["usos_dia"]

    def marcar(self, username: str, status: str, erro: str, cooldown_s: Optional[float] = None) -> None:
        if status not in STATUS:
            raise ValueError(f"status inválido: {status}")
        with self._trava:
            self._linha(username)
            ate = self._relogio() + cooldown_s if cooldown_s else None
            self._db.execute(
                "UPDATE saude SET status = ?, cooldown_ate = ?, ultimo_erro = ?, em_uso = 0 WHERE username = ?",
                (status, ate, erro[:200], username),
            )
            self._db.commit()

    def liberar_manual(self, username: str) -> bool:
        """O operador resolveu o checkpoint no app e devolve a conta ao rodízio."""
        with self._trava:
            self._linha(username)
            self._db.execute(
                "UPDATE saude SET status = 'ok', cooldown_ate = NULL, ultimo_erro = NULL WHERE username = ?", (username,)
            )
            self._db.commit()
            return True

    def resumo(self, contas: list[Conta], cap: int) -> list[dict]:
        """A tabela de saúde. Sem senha, sem sessionid, sem proxy."""
        with self._trava:
            out = []
            for c in contas:
                l = self._linha(c.username)
                restante = max(0, int((l["cooldown_ate"] or 0) - self._relogio())) if l["status"] == "cooldown" else 0
                out.append(
                    {
                        "username": c.username,
                        "status": l["status"],
                        "apta_agora": self._apta(l, cap),
                        "cooldown_restante_s": restante,
                        "usos_hoje": l["usos_dia"],
                        "limite_dia": cap,
                        "em_uso": bool(l["em_uso"]),
                        "ultimo_erro": l["ultimo_erro"],
                    }
                )
            return out


def caminho_seguro(caminho: str) -> bool:
    """O arquivo de contas não pode ser legível por outros (POSIX). No Windows, sem checagem."""
    if os.name != "posix":
        return True
    return (os.stat(caminho).st_mode & 0o077) == 0
