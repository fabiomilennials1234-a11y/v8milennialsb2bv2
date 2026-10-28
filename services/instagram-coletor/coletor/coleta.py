"""Motor da coleta: lista os seguidores de uma conta pública e lê, de cada perfil
público, o contato que ele mesmo publica.

Duas ideias organizam tudo:

  1. A conta é consumível e o ritmo é o que a mantém viva. Pausa aleatória entre
     perfis, pausa longa de tempos em tempos, teto de requisições por conta por dia.
  2. Ao primeiro sinal de desafio (checkpoint), PARA. Insistir com a mesma conta e o
     mesmo IP só transforma um checkpoint em suspensão. Sinais brandos (limite de
     ritmo, bloqueio de ação) põem a conta em cooldown e o job tenta a próxima.

A biblioteca do Instagram entra por `ClienteIG` (ver `ig.py`), então tudo aqui roda
em teste sem rede e sem conta.
"""
from __future__ import annotations

import random
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Optional, Protocol

from .contas import Conta, Saude


class ErroDeConta(Exception):
    """A conta (ou o IP dela) deu sinal de problema.

    tipo: 'cooldown' (volta sozinha depois), 'checkpoint' (precisa de gente) ou
    'login_falhou' (senha/2FA/sessão inválidos).
    """

    def __init__(self, tipo: str, mensagem: str, cooldown_s: Optional[float] = None) -> None:
        super().__init__(mensagem)
        self.tipo = tipo
        self.cooldown_s = cooldown_s


class AlvoInvalido(Exception):
    """A conta-alvo não existe ou é privada: nenhuma conta nossa resolve isso."""


class ClienteIG(Protocol):
    def entrar(self, conta: Conta) -> None: ...
    def id_do_alvo(self, handle: str) -> str: ...
    def seguidores(self, uid: str, max_id: str, quantidade: int) -> tuple[list[dict], str]: ...
    def perfil(self, pk: str) -> dict: ...


@dataclass
class Ritmo:
    pausa_min_s: float = 3.0
    pausa_max_s: float = 8.0
    # A cada N perfis, uma pausa longa: ninguém lê 200 perfis seguidos sem parar.
    pausa_longa_a_cada: int = 25
    pausa_longa_min_s: float = 30.0
    pausa_longa_max_s: float = 90.0
    # Seguidores pedidos por chamada de lista.
    chunk: int = 100


@dataclass
class Config:
    ritmo: Ritmo = field(default_factory=Ritmo)
    # Requisições por conta por dia (cada lista e cada perfil contam 1).
    cap_dia: int = 250
    max_seguidores_job: int = 800


STATUS_TERMINAIS = ("SUCCEEDED", "FAILED", "ABORTED")


class Job:
    def __init__(self, handle: str, max_seguidores: int) -> None:
        self.id = uuid.uuid4().hex
        self.handle = handle
        self.max_seguidores = max_seguidores
        self.status = "RUNNING"
        self.mensagem: Optional[str] = None
        self.itens: list[dict] = []
        self.abortar = threading.Event()
        self._trava = threading.Lock()
        self._pks: set[str] = set()

    def adicionar(self, pk: str, item: dict) -> bool:
        with self._trava:
            if pk in self._pks:
                return False
            self._pks.add(pk)
            self.itens.append(item)
            return True

    def total(self) -> int:
        with self._trava:
            return len(self.itens)

    def fatia(self, offset: int, limite: int) -> list[dict]:
        with self._trava:
            return self.itens[offset : offset + limite]

    def encerrar(self, status: str, mensagem: Optional[str] = None) -> None:
        with self._trava:
            # Um job abortado não "volta" a falhar quando a thread percebe depois.
            if self.status == "RUNNING":
                self.status = status
                self.mensagem = mensagem


def _item(curto: dict, perfil: Optional[dict]) -> dict:
    """No formato do Actor da Apify (`instagram.ts` no worker lê os mesmos campos)."""
    base = {
        "username": curto["username"],
        "full_name": curto.get("full_name") or "",
        "is_private": bool(curto.get("is_private")),
        "is_verified": bool(curto.get("is_verified")),
        "enrichment_status": "skipped_private" if curto.get("is_private") else "failed",
        "public_email": None,
        "biography_email": None,
        "contact_phone_number": None,
        "external_url": None,
        "bio_links": [],
        "biography": None,
        "category": None,
        "is_business": False,
        "country": None,
    }
    if perfil is not None:
        base.update(perfil)
        base["enrichment_status"] = "success"
    return base


def executar(
    job: Job,
    contas: list[Conta],
    saude: Saude,
    fabrica: Callable[[], ClienteIG],
    cfg: Config,
    dormir: Callable[[float], None] = time.sleep,
    sorteio: Callable[[float, float], float] = random.uniform,
    log: Callable[[str], None] = lambda m: None,
) -> None:
    """Roda o job até acabar, falhar ou ser abortado. Nunca lança."""
    maximo = min(job.max_seguidores, cfg.max_seguidores_job)
    r = cfg.ritmo
    cursor = ""
    uid: Optional[str] = None
    lidos = 0  # perfis públicos lidos (para a pausa longa)
    conta: Optional[Conta] = None

    def pausar(minimo: float, maximo_s: float) -> None:
        # Fatias curtas: um aborto não espera uma pausa de 90 s terminar.
        resta = sorteio(minimo, maximo_s)
        while resta > 0 and not job.abortar.is_set():
            passo = min(1.0, resta)
            dormir(passo)
            resta -= passo

    try:
        while job.total() < maximo and not job.abortar.is_set():
            if conta is None:
                conta = saude.escolher(contas, cfg.cap_dia)
                if conta is None:
                    job.encerrar("FAILED", "sem_conta_disponivel")
                    return
                cliente = fabrica()
                try:
                    cliente.entrar(conta)
                    if uid is None:
                        uid = cliente.id_do_alvo(job.handle)
                except ErroDeConta as e:
                    saude.marcar(conta.username, e.tipo, str(e), e.cooldown_s)
                    log(f"conta {conta.username}: {e.tipo}")
                    if e.tipo == "checkpoint":
                        job.encerrar("FAILED", "checkpoint")
                        return
                    conta = None
                    continue

            try:
                if saude.usos_hoje(conta.username) >= cfg.cap_dia:
                    raise ErroDeConta("cooldown", "limite diário da conta", cooldown_s=None)
                lote, cursor_novo = cliente.seguidores(uid, cursor, min(r.chunk, maximo - job.total()))
                saude.contar_uso(conta.username)
                cursor = cursor_novo
                if not lote:
                    # Página vazia: acabou a lista (ou o Instagram parou de paginar). Sem isto, um cursor
                    # que nunca zera prenderia o job num laço.
                    job.encerrar("SUCCEEDED")
                    return

                for curto in lote:
                    if job.abortar.is_set() or job.total() >= maximo:
                        break
                    if curto.get("is_private"):
                        job.adicionar(str(curto["pk"]), _item(curto, None))
                        continue
                    if saude.usos_hoje(conta.username) >= cfg.cap_dia:
                        raise ErroDeConta("cooldown", "limite diário da conta", cooldown_s=None)
                    pausar(r.pausa_min_s, r.pausa_max_s)
                    if job.abortar.is_set():
                        break
                    perfil = cliente.perfil(str(curto["pk"]))
                    saude.contar_uso(conta.username)
                    job.adicionar(str(curto["pk"]), _item(curto, perfil))
                    lidos += 1
                    if r.pausa_longa_a_cada and lidos % r.pausa_longa_a_cada == 0:
                        pausar(r.pausa_longa_min_s, r.pausa_longa_max_s)

                if not cursor:
                    job.encerrar("SUCCEEDED")
                    return
            except ErroDeConta as e:
                saude.marcar(conta.username, e.tipo, str(e), e.cooldown_s)
                log(f"conta {conta.username}: {e.tipo}: {e}")
                if e.tipo == "checkpoint":
                    # Primeiro desafio: para tudo. Rodízio aqui só espalharia o problema.
                    job.encerrar("FAILED", "checkpoint")
                    return
                conta = None  # cooldown / login: tenta a próxima conta, do mesmo ponto
            except AlvoInvalido:
                job.encerrar("FAILED", "alvo_invalido")
                return

        job.encerrar("ABORTED" if job.abortar.is_set() else "SUCCEEDED")
    except AlvoInvalido:
        job.encerrar("FAILED", "alvo_invalido")
    except Exception as e:  # noqa: BLE001 - qualquer falha inesperada fecha o job, com o que já saiu
        log(f"job {job.id}: erro inesperado: {type(e).__name__}")
        job.encerrar("FAILED", f"erro:{type(e).__name__}")
    finally:
        if conta is not None:
            saude.soltar(conta.username)
