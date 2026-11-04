"""Sobe o coletor de verdade com um cliente de Instagram FALSO, numa porta livre.

Usado pelo teste do worker (tests/integration/lista-fria-instagram.test.mjs) para travar o
contrato JSON entre o worker (Node) e este serviço (Python). Imprime `PORT <n>` e fica no ar.
Só biblioteca padrão: não precisa de instagrapi nem de conta.
"""
import threading
import sys

from coletor.coleta import Config, Ritmo
from coletor.contas import Conta, Saude
from coletor.servidor import Coletor, servir


class Cliente:
    SEGUIDORES = [
        {"pk": "1", "username": "Ana.Dentista", "full_name": "Ana Souza", "is_private": False, "is_verified": False},
        {"pk": "2", "username": "bia_privada", "full_name": "Bia", "is_private": True, "is_verified": False},
        {"pk": "3", "username": "caio.zap", "full_name": "Caio Lima", "is_private": False, "is_verified": False},
        {"pk": "4", "username": "duda.sem.contato", "full_name": "Duda", "is_private": False, "is_verified": False},
    ]
    PERFIS = {
        "1": {"is_business": True, "public_email": "ana@clinica.com.br", "contact_phone_number": None, "external_url": "https://clinica.com.br",
              "bio_links": [{"title": "site", "url": "https://clinica.com.br"}], "biography": "Dentista | Pinheiros", "category": "Dentista"},
        "3": {"is_business": False, "public_email": None, "contact_phone_number": "+55 11 99319-5517", "external_url": None,
              "bio_links": [], "biography": "agende", "category": None},
        "4": {"is_business": False, "public_email": None, "contact_phone_number": None, "external_url": None,
              "bio_links": [], "biography": "vida", "category": None},
    }

    def entrar(self, conta):
        pass

    def id_do_alvo(self, handle):
        return "42"

    def seguidores(self, uid, max_id, quantidade):
        return list(self.SEGUIDORES), ""

    def perfil(self, pk):
        return dict(self.PERFIS[pk])


def main():
    relogio = [1_000_000.0]
    saude = Saude(":memory:", relogio=lambda: relogio[0])
    cfg = Config(ritmo=Ritmo(pausa_min_s=0, pausa_max_s=0, pausa_longa_a_cada=0))
    coletor = Coletor(lambda: [Conta("conta.teste", password="x")], saude, Cliente, cfg)
    srv = servir(coletor, 0, "segredo-de-teste", host="127.0.0.1")
    print(f"PORT {srv.server_address[1]}", flush=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    sys.stdin.read()  # vive até o teste fechar o stdin


if __name__ == "__main__":
    main()
