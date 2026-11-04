"""API HTTP do coletor. Só biblioteca padrão.

  POST /v1/jobs                    {handle, max_seguidores}      -> 201 {id}
  GET  /v1/jobs/{id}                                             -> {status, mensagem, total}
  GET  /v1/jobs/{id}/itens?offset=&limit=                        -> [item, ...]
  POST /v1/jobs/{id}/abort                                       -> 200
  GET  /v1/contas                                                -> tabela de saúde (sem segredo)
  POST /v1/contas/{username}/liberar                             -> 200 (o operador resolveu o checkpoint)
  GET  /saude                                                    -> 200

`status` usa os mesmos nomes da Apify (RUNNING, SUCCEEDED, FAILED, ABORTED): o worker lê as
duas fontes pelo mesmo código. Sem autenticação forte por desenho: o serviço só pode ficar
numa rede interna. `COLETOR_SEGREDO` põe um Bearer na frente, como defesa em profundidade.
"""
from __future__ import annotations

import hmac
import json
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Optional
from urllib.parse import parse_qs, urlparse

from .coleta import ClienteIG, Config, Job, executar
from .contas import Conta, Saude

HANDLE = re.compile(r"^[A-Za-z0-9._]{1,30}$")
ROTA_JOB = re.compile(r"^/v1/jobs/([0-9a-f]{32})(/itens|/abort)?$")
ROTA_CONTA = re.compile(r"^/v1/contas/([A-Za-z0-9._]{1,30})/liberar$")


class Coletor:
    """O estado do serviço: jobs em andamento e as contas."""

    def __init__(
        self,
        carregar_contas: Callable[[], list[Conta]],
        saude: Saude,
        fabrica: Callable[[], ClienteIG],
        cfg: Config,
        log: Callable[[str], None] = lambda m: None,
        em_thread: Callable[[Callable[[], None]], None] = lambda f: threading.Thread(target=f, daemon=True).start(),
    ) -> None:
        self.carregar_contas = carregar_contas
        self.saude = saude
        self.fabrica = fabrica
        self.cfg = cfg
        self.log = log
        self._em_thread = em_thread
        self.jobs: dict[str, Job] = {}
        self._trava = threading.Lock()

    def iniciar(self, handle: str, max_seguidores: int) -> Job:
        job = Job(handle, max_seguidores)
        with self._trava:
            self.jobs[job.id] = job
            # Memória limitada: guarda os 200 mais recentes.
            if len(self.jobs) > 200:
                for antigo in list(self.jobs)[: len(self.jobs) - 200]:
                    self.jobs.pop(antigo, None)
        contas = self.carregar_contas()  # relê a cada job: o operador edita o arquivo sem reiniciar
        self._em_thread(lambda: executar(job, contas, self.saude, self.fabrica, self.cfg, log=self.log))
        return job


def fazer_handler(coletor: Coletor, segredo: Optional[str]) -> type[BaseHTTPRequestHandler]:
    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a: object) -> None:  # silencia o log padrão (tem caminho e IP)
            pass

        def _responder(self, status: int, corpo: object = None) -> None:
            dados = b"" if corpo is None else json.dumps(corpo, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(dados)))
            self.end_headers()
            if dados:
                self.wfile.write(dados)

        def _autorizado(self) -> bool:
            if not segredo:
                return True
            enviado = self.headers.get("Authorization", "")
            return hmac.compare_digest(enviado.encode(), f"Bearer {segredo}".encode())

        def _corpo(self) -> dict:
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > 10_000:
                return {}
            try:
                v = json.loads(self.rfile.read(n))
                return v if isinstance(v, dict) else {}
            except ValueError:
                return {}

        def do_GET(self) -> None:  # noqa: N802
            u = urlparse(self.path)
            if u.path == "/saude":
                return self._responder(200, {"ok": True})
            if not self._autorizado():
                return self._responder(401, {"erro": "não autorizado"})
            if u.path == "/v1/contas":
                return self._responder(200, coletor.saude.resumo(coletor.carregar_contas(), coletor.cfg.cap_dia))
            m = ROTA_JOB.match(u.path)
            if not m:
                return self._responder(404, {"erro": "não encontrado"})
            job = coletor.jobs.get(m.group(1))
            if job is None:
                return self._responder(404, {"erro": "job não encontrado"})
            if m.group(2) == "/itens":
                q = parse_qs(u.query)
                try:
                    offset = max(0, int(q.get("offset", ["0"])[0]))
                    limite = min(1000, max(1, int(q.get("limit", ["500"])[0])))
                except ValueError:
                    return self._responder(400, {"erro": "offset/limit inválidos"})
                return self._responder(200, job.fatia(offset, limite))
            if m.group(2) is None:
                return self._responder(200, {"status": job.status, "mensagem": job.mensagem, "total": job.total()})
            return self._responder(404, {"erro": "não encontrado"})

        def do_POST(self) -> None:  # noqa: N802
            if not self._autorizado():
                return self._responder(401, {"erro": "não autorizado"})
            u = urlparse(self.path)
            if u.path == "/v1/jobs":
                c = self._corpo()
                handle = str(c.get("handle", "")).strip().lstrip("@")
                if not HANDLE.match(handle):
                    return self._responder(422, {"erro": "handle inválido"})
                try:
                    maximo = int(c.get("max_seguidores", 0))
                except (TypeError, ValueError):
                    maximo = 0
                if maximo < 1:
                    return self._responder(422, {"erro": "max_seguidores inválido"})
                job = coletor.iniciar(handle, maximo)
                return self._responder(201, {"id": job.id})
            m = ROTA_JOB.match(u.path)
            if m and m.group(2) == "/abort":
                job = coletor.jobs.get(m.group(1))
                if job is None:
                    return self._responder(404, {"erro": "job não encontrado"})
                job.abortar.set()
                return self._responder(200, {"ok": True})
            m = ROTA_CONTA.match(u.path)
            if m:
                if m.group(1).lower() not in {c.username for c in coletor.carregar_contas()}:
                    return self._responder(404, {"erro": "conta não encontrada"})
                coletor.saude.liberar_manual(m.group(1).lower())
                return self._responder(200, {"ok": True})
            return self._responder(404, {"erro": "não encontrado"})

    return H


def servir(coletor: Coletor, porta: int, segredo: Optional[str], host: str = "0.0.0.0") -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, porta), fazer_handler(coletor, segredo))
