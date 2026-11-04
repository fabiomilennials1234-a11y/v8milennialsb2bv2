"""Testes do coletor. `python -m unittest discover -s tests -t .` na pasta do serviço.

Tudo roda sem rede e sem conta de Instagram: o motor recebe um cliente falso, e o único teste
que toca a biblioteca (`traduzir`) usa as classes de erro reais dela e é pulado se ela não
estiver instalada.
"""
import json
import os
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

from coletor.coleta import AlvoInvalido, Config, ErroDeConta, Job, Ritmo, executar
from coletor.contas import Conta, Saude, carregar_contas
from coletor.servidor import Coletor, servir


def conta(nome, **k):
    return Conta(nome, password="segredo-" + nome, **k)


class Relogio:
    def __init__(self):
        self.t = 1_000_000.0
        self.dia = "2026-10-28"

    def __call__(self):
        return self.t


def saude_em_memoria(relogio=None):
    r = relogio or Relogio()
    return Saude(":memory:", relogio=r, hoje=lambda: r.dia), r


def curto(n, privado=False):
    return {"pk": str(n), "username": f"user{n}", "full_name": f"Nome {n}", "is_private": privado, "is_verified": False}


PERFIL = {"is_business": True, "public_email": "a@x.com.br", "contact_phone_number": None, "external_url": None,
          "bio_links": [], "biography": "oi", "category": "Dentista"}


class ClienteFalso:
    """Roteiro: `paginas` = lista de (seguidores, cursor); erros por chamada via `falhas`."""

    def __init__(self, paginas, falhas=None, perfil=None, alvo_ok=True):
        self.paginas = list(paginas)
        self.falhas = dict(falhas or {})  # {"perfil:3": ErroDeConta(...), "entrar": ..., "seguidores:1": ...}
        self.perfis_lidos = []
        self.chamadas_seguidores = 0
        self.alvo_ok = alvo_ok
        self.perfil_dados = perfil or PERFIL
        self.contas_que_entraram = []

    def _falha(self, chave):
        e = self.falhas.pop(chave, None)
        if e:
            raise e

    def entrar(self, c):
        self.contas_que_entraram.append(c.username)
        self._falha("entrar:" + c.username)
        self._falha("entrar")

    def id_do_alvo(self, handle):
        if not self.alvo_ok:
            raise AlvoInvalido("UserNotFound")
        return "42"

    def seguidores(self, uid, max_id, quantidade):
        self.chamadas_seguidores += 1
        self._falha(f"seguidores:{self.chamadas_seguidores}")
        if not self.paginas:
            return [], ""
        return self.paginas.pop(0)

    def perfil(self, pk):
        self._falha(f"perfil:{pk}")
        self.perfis_lidos.append(pk)
        return dict(self.perfil_dados)


def rodar(job, contas, saude, cliente, cfg=None, abortar_apos_pausas=None):
    pausas = []

    def dormir(s):
        pausas.append(s)
        if abortar_apos_pausas is not None and len(pausas) >= abortar_apos_pausas:
            job.abortar.set()

    cfg = cfg or Config(ritmo=Ritmo(pausa_min_s=3, pausa_max_s=8, pausa_longa_a_cada=0))
    executar(job, contas, saude, lambda: cliente, cfg, dormir=dormir, sorteio=lambda a, b: a)
    return pausas


# ── contas ─────────────────────────────────────────────────────────────────
class TestContas(unittest.TestCase):
    def _arquivo(self, conteudo):
        d = tempfile.mkdtemp()
        p = os.path.join(d, "contas.json")
        with open(p, "w", encoding="utf-8") as f:
            f.write(conteudo if isinstance(conteudo, str) else json.dumps(conteudo))
        return p

    def test_carrega_senha_ou_sessionid_normaliza_e_nao_vaza_no_repr(self):
        cs = carregar_contas(self._arquivo([
            {"username": "@Conta.Um", "password": "p4ss"},
            {"username": "conta.dois", "sessionid": "sid", "proxy": "http://u:p@proxy:8080"},
        ]))
        self.assertEqual([c.username for c in cs], ["conta.um", "conta.dois"])
        self.assertNotIn("p4ss", repr(cs[0]))
        self.assertNotIn("proxy", repr(cs[1]))
        self.assertNotIn("sid", repr(cs[1]))

    def test_erros_dizem_a_posicao_e_nunca_o_segredo(self):
        casos = [
            ({"username": "x"}, "informe password ou sessionid"),
            ([{"username": "a", "password": "SEGREDO-UM"}, {"username": "A", "password": "SEGREDO-DOIS"}], "repetido"),
            ([{"password": "SEGREDO-TRES"}], "falta username"),
            ({"a": 1}, "lista"),
        ]
        for conteudo, trecho in casos:
            with self.assertRaises(ValueError) as cx:
                carregar_contas(self._arquivo(conteudo if isinstance(conteudo, (list, dict)) and conteudo != {"username": "x"} else [conteudo]))
            self.assertIn(trecho, str(cx.exception))
            self.assertNotIn("SEGREDO", str(cx.exception))


# ── saúde ──────────────────────────────────────────────────────────────────
class TestSaude(unittest.TestCase):
    def test_escolher_marca_em_uso_e_ninguem_pega_a_mesma(self):
        s, _ = saude_em_memoria()
        a, b = conta("a"), conta("b")
        self.assertEqual(s.escolher([a, b], 100).username, "a")
        self.assertEqual(s.escolher([a, b], 100).username, "b")
        self.assertIsNone(s.escolher([a, b], 100))
        s.soltar("a")
        self.assertEqual(s.escolher([a, b], 100).username, "a")

    def test_cap_do_dia_barra_e_vira_o_dia_libera(self):
        s, r = saude_em_memoria()
        a = conta("a")
        s.contar_uso("a", 5)
        self.assertIsNone(s.escolher([a], 5))
        r.dia = "2026-10-29"
        self.assertEqual(s.escolher([a], 5).username, "a")
        self.assertEqual(s.usos_hoje("a"), 0)

    def test_cooldown_vence_sozinho_checkpoint_so_na_mao(self):
        s, r = saude_em_memoria()
        a, b = conta("a"), conta("b")
        s.marcar("a", "cooldown", "limite", 1800)
        s.marcar("b", "checkpoint", "desafio")
        self.assertIsNone(s.escolher([a, b], 100))
        r.t += 1801
        self.assertEqual(s.escolher([a, b], 100).username, "a")
        s.soltar("a")
        self.assertIsNone(s.escolher([b], 100), "checkpoint não sai com o tempo")
        s.liberar_manual("b")
        self.assertEqual(s.escolher([b], 100).username, "b")

    def test_resumo_nao_tem_segredo(self):
        s, _ = saude_em_memoria()
        c = Conta("a", password="SEGREDO", sessionid="SID", proxy="http://proxy")
        s.marcar("a", "cooldown", "PleaseWaitFewMinutes", 600)
        txt = json.dumps(s.resumo([c], 250))
        for proibido in ("SEGREDO", "SID", "proxy"):
            self.assertNotIn(proibido, txt)
        linha = s.resumo([c], 250)[0]
        self.assertEqual((linha["status"], linha["apta_agora"], linha["cooldown_restante_s"]), ("cooldown", False, 600))

    def test_reinicio_nao_deixa_conta_presa_em_uso(self):
        d = tempfile.mkdtemp()
        db = os.path.join(d, "s.sqlite")
        s1 = Saude(db)
        a = conta("a")
        s1.escolher([a], 100)
        s2 = Saude(db)
        self.assertEqual(s2.escolher([a], 100).username, "a")


# ── motor ──────────────────────────────────────────────────────────────────
class TestColeta(unittest.TestCase):
    def test_lista_paginada_privado_nao_gasta_perfil_e_item_no_formato_da_apify(self):
        s, _ = saude_em_memoria()
        cl = ClienteFalso([([curto(1), curto(2, privado=True), curto(3)], "c1"), ([curto(4)], "")])
        job = Job("alvo", 100)
        pausas = rodar(job, [conta("a")], s, cl)
        self.assertEqual(job.status, "SUCCEEDED")
        self.assertEqual(cl.perfis_lidos, ["1", "3", "4"], "conta privada não gasta requisição de perfil")
        self.assertEqual([i["username"] for i in job.itens], ["user1", "user2", "user3", "user4"])
        priv = job.itens[1]
        self.assertEqual((priv["enrichment_status"], priv["public_email"]), ("skipped_private", None))
        ok = job.itens[0]
        self.assertEqual((ok["enrichment_status"], ok["public_email"], ok["category"]), ("success", "a@x.com.br", "Dentista"))
        for campo in ("username", "full_name", "is_private", "public_email", "contact_phone_number", "external_url", "bio_links", "biography", "category"):
            self.assertIn(campo, ok)
        self.assertEqual(len(pausas), 3 * 3, "3 perfis lidos, cada pausa em fatias de 1 s (3 s)")
        self.assertEqual(s.usos_hoje("a"), 2 + 3, "2 listas + 3 perfis")
        self.assertEqual(s.resumo([conta("a")], 250)[0]["em_uso"], False, "conta solta no fim")

    def test_pausa_longa_a_cada_n_perfis(self):
        s, _ = saude_em_memoria()
        cl = ClienteFalso([([curto(i) for i in range(1, 7)], "")])
        cfg = Config(ritmo=Ritmo(pausa_min_s=2, pausa_max_s=2, pausa_longa_a_cada=3, pausa_longa_min_s=10, pausa_longa_max_s=10))
        pausas = rodar(Job("alvo", 100), [conta("a")], s, cl, cfg)
        self.assertEqual(sum(pausas), 6 * 2 + 2 * 10, "6 pausas curtas de 2 s e 2 longas de 10 s")

    def test_respeita_o_maximo_do_job_e_o_teto_do_servico(self):
        s, _ = saude_em_memoria()
        cl = ClienteFalso([([curto(i) for i in range(1, 11)], "x")])
        job = Job("alvo", 4)
        rodar(job, [conta("a")], s, cl)
        self.assertEqual((job.status, job.total()), ("SUCCEEDED", 4))
        job2 = Job("alvo", 999)
        rodar(job2, [conta("b")], saude_em_memoria()[0], ClienteFalso([([curto(i) for i in range(1, 11)], "x")]),
              Config(ritmo=Ritmo(pausa_longa_a_cada=0), max_seguidores_job=3))
        self.assertEqual(job2.total(), 3, "o teto do serviço vence o pedido")

    def test_abortar_no_meio_guarda_o_que_ja_saiu_e_interrompe_a_pausa(self):
        s, _ = saude_em_memoria()
        cl = ClienteFalso([([curto(i) for i in range(1, 6)], "x")])
        job = Job("alvo", 100)
        rodar(job, [conta("a")], s, cl, abortar_apos_pausas=4)
        self.assertEqual(job.status, "ABORTED")
        self.assertGreaterEqual(job.total(), 1)
        self.assertLess(job.total(), 5)

    def test_primeiro_checkpoint_PARA_tudo_sem_rodizio(self):
        s, _ = saude_em_memoria()
        cl = ClienteFalso([([curto(1), curto(2), curto(3)], "x")], falhas={"perfil:2": ErroDeConta("checkpoint", "ChallengeRequired")})
        job = Job("alvo", 100)
        rodar(job, [conta("a"), conta("b")], s, cl)
        self.assertEqual((job.status, job.mensagem), ("FAILED", "checkpoint"))
        self.assertEqual([i["username"] for i in job.itens], ["user1"], "guarda o que saiu antes do desafio")
        self.assertEqual(cl.contas_que_entraram, ["a"], "não tentou a conta b")
        res = {l["username"]: l for l in s.resumo([conta("a"), conta("b")], 250)}
        self.assertEqual(res["a"]["status"], "checkpoint")
        self.assertEqual(res["b"]["status"], "ok", "a outra conta fica intacta")

    def test_cooldown_troca_de_conta_e_segue_do_mesmo_ponto_sem_duplicar(self):
        s, _ = saude_em_memoria()
        cl = ClienteFalso([([curto(1), curto(2), curto(3)], "")], falhas={"perfil:2": ErroDeConta("cooldown", "PleaseWaitFewMinutes", 1800)})
        # Depois da troca, o motor pede a lista de novo com o cursor vazio e a página já esgotada.
        cl.paginas.append(([curto(2), curto(3)], ""))
        job = Job("alvo", 100)
        rodar(job, [conta("a"), conta("b")], s, cl)
        self.assertEqual(cl.contas_que_entraram, ["a", "b"])
        self.assertEqual(sorted(i["username"] for i in job.itens), ["user1", "user2", "user3"])
        self.assertEqual(len({i["username"] for i in job.itens}), 3, "sem duplicata")
        st = {l["username"]: l["status"] for l in s.resumo([conta("a"), conta("b")], 250)}
        self.assertEqual(st["a"], "cooldown")

    def test_login_falhou_pula_a_conta_sem_derrubar_o_job(self):
        s, _ = saude_em_memoria()
        cl = ClienteFalso([([curto(1)], "")], falhas={"entrar:a": ErroDeConta("login_falhou", "BadPassword")})
        job = Job("alvo", 100)
        rodar(job, [conta("a"), conta("b")], s, cl)
        self.assertEqual(job.status, "SUCCEEDED")
        self.assertEqual(cl.contas_que_entraram, ["a", "b"])
        self.assertEqual({l["username"]: l["status"] for l in s.resumo([conta("a"), conta("b")], 250)}["a"], "login_falhou")

    def test_teto_diario_da_conta_passa_para_a_proxima_ou_falha_sem_conta(self):
        s, _ = saude_em_memoria()
        cl = ClienteFalso([([curto(i) for i in range(1, 7)], "")])
        cl.paginas.append(([curto(i) for i in range(4, 7)], ""))
        job = Job("alvo", 100)
        # cap de 3 requisições por conta: a conta a faz 1 lista + 2 perfis e para.
        rodar(job, [conta("a"), conta("b")], s, cl, Config(ritmo=Ritmo(pausa_longa_a_cada=0), cap_dia=3))
        self.assertEqual(cl.contas_que_entraram[:2], ["a", "b"])

        s2, _ = saude_em_memoria()
        job2 = Job("alvo", 100)
        cl2 = ClienteFalso([([curto(i) for i in range(1, 7)], "x")])
        rodar(job2, [conta("a")], s2, cl2, Config(ritmo=Ritmo(pausa_longa_a_cada=0), cap_dia=3))
        self.assertEqual((job2.status, job2.mensagem), ("FAILED", "sem_conta_disponivel"))
        self.assertEqual(job2.total(), 2, "o que deu dentro do teto fica")

    def test_sem_contas_e_alvo_invalido_e_pagina_vazia_e_erro_inesperado(self):
        s, _ = saude_em_memoria()
        j1 = Job("alvo", 10)
        rodar(j1, [], s, ClienteFalso([]))
        self.assertEqual((j1.status, j1.mensagem), ("FAILED", "sem_conta_disponivel"))

        j2 = Job("alvo", 10)
        rodar(j2, [conta("a")], s, ClienteFalso([], alvo_ok=False))
        self.assertEqual((j2.status, j2.mensagem), ("FAILED", "alvo_invalido"))
        self.assertFalse(s.resumo([conta("a")], 250)[0]["em_uso"], "conta solta mesmo com alvo inválido")

        j3 = Job("alvo", 10)
        rodar(j3, [conta("a")], s, ClienteFalso([([], "cursor-que-nunca-zera")]))
        self.assertEqual(j3.status, "SUCCEEDED", "página vazia encerra, não prende em laço")

        j4 = Job("alvo", 10)
        cl4 = ClienteFalso([([curto(1)], "")], falhas={"perfil:1": RuntimeError("senha=SEGREDO")})
        rodar(j4, [conta("a")], s, cl4)
        self.assertEqual((j4.status, j4.mensagem), ("FAILED", "erro:RuntimeError"))
        self.assertNotIn("SEGREDO", j4.mensagem, "a mensagem do erro não vai para o job")

    def test_aborto_vence_a_falha_tardia(self):
        j = Job("alvo", 10)
        j.encerrar("ABORTED")
        j.encerrar("FAILED", "x")
        self.assertEqual(j.status, "ABORTED")


# ── HTTP ───────────────────────────────────────────────────────────────────
class TestHttp(unittest.TestCase):
    def setUp(self):
        self.saude, _ = saude_em_memoria()
        self.cliente = ClienteFalso([([curto(1), curto(2), curto(3)], "")])
        self.contas = [Conta("alvo.conta", password="SEGREDO", proxy="http://proxy")]
        cfg = Config(ritmo=Ritmo(pausa_min_s=0, pausa_max_s=0, pausa_longa_a_cada=0))
        self.coletor = Coletor(lambda: self.contas, self.saude, lambda: self.cliente, cfg)
        self.srv = servir(self.coletor, 0, "tok", host="127.0.0.1")
        self.porta = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.addCleanup(self.srv.shutdown)

    def req(self, metodo, caminho, corpo=None, token="tok"):
        r = urllib.request.Request(f"http://127.0.0.1:{self.porta}{caminho}", method=metodo,
                                   data=None if corpo is None else json.dumps(corpo).encode(),
                                   headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
        try:
            with urllib.request.urlopen(r, timeout=10) as resp:
                t = resp.read()
                return resp.status, (json.loads(t) if t else None)
        except urllib.error.HTTPError as e:
            t = e.read()
            return e.code, (json.loads(t) if t else None)

    def esperar(self, jid):
        for _ in range(200):
            st, c = self.req("GET", f"/v1/jobs/{jid}")
            if c["status"] != "RUNNING":
                return c
            time.sleep(0.02)
        self.fail("job não terminou")

    def test_fluxo_completo(self):
        st, c = self.req("POST", "/v1/jobs", {"handle": "@clinica.x", "max_seguidores": 50})
        self.assertEqual(st, 201)
        fim = self.esperar(c["id"])
        self.assertEqual((fim["status"], fim["total"]), ("SUCCEEDED", 3))
        st, itens = self.req("GET", f"/v1/jobs/{c['id']}/itens?offset=1&limit=5")
        self.assertEqual([i["username"] for i in itens], ["user2", "user3"])
        self.assertEqual(self.req("GET", f"/v1/jobs/{c['id']}/itens?offset=9")[1], [])

    def test_autenticacao_validacao_e_404(self):
        self.assertEqual(self.req("GET", "/v1/contas", token=None)[0], 401)
        self.assertEqual(self.req("GET", "/v1/contas", token="errado")[0], 401)
        self.assertEqual(self.req("POST", "/v1/jobs", {"handle": "x", "max_seguidores": 1}, token=None)[0], 401)
        self.assertEqual(self.req("GET", "/saude", token=None)[0], 200)
        for corpo in ({"handle": "dois nomes", "max_seguidores": 5}, {"handle": "", "max_seguidores": 5}, {"handle": "ok", "max_seguidores": 0}, {"handle": "ok"}, {"handle": "a" * 31, "max_seguidores": 5}):
            self.assertEqual(self.req("POST", "/v1/jobs", corpo)[0], 422, str(corpo))
        self.assertEqual(self.req("GET", "/v1/jobs/" + "0" * 32)[0], 404)
        self.assertEqual(self.req("GET", "/v1/jobs/nao-hex")[0], 404)
        self.assertEqual(self.req("GET", "/v1/outra")[0], 404)

    def test_abort_e_tabela_de_saude_sem_segredo_e_liberar(self):
        self.cliente.paginas = [([curto(i) for i in range(1, 400)], "x")]
        self.coletor.cfg.ritmo.pausa_min_s = self.coletor.cfg.ritmo.pausa_max_s = 0.05
        st, c = self.req("POST", "/v1/jobs", {"handle": "alvo", "max_seguidores": 800})
        self.assertEqual(self.req("POST", f"/v1/jobs/{c['id']}/abort")[0], 200)
        self.assertEqual(self.esperar(c["id"])["status"], "ABORTED")
        st, saude = self.req("GET", "/v1/contas")
        txt = json.dumps(saude)
        for proibido in ("SEGREDO", "proxy"):
            self.assertNotIn(proibido, txt)
        self.assertEqual(saude[0]["username"], "alvo.conta")
        self.saude.marcar("alvo.conta", "checkpoint", "x")
        self.assertEqual(self.req("POST", "/v1/contas/alvo.conta/liberar")[0], 200)
        self.assertEqual(self.req("GET", "/v1/contas")[1][0]["status"], "ok")
        self.assertEqual(self.req("POST", "/v1/contas/inexistente/liberar")[0], 404)


# ── prazo e handlers (sem biblioteca) ──────────────────────────────────────
class TestPrazo(unittest.TestCase):
    def test_chamada_pendurada_vira_cooldown_em_vez_de_prender_a_thread(self):
        from coletor.ig import COOLDOWN_PRAZO_S, com_prazo

        t0 = time.time()
        with self.assertRaises(ErroDeConta) as cx:
            com_prazo(lambda: time.sleep(5), 0.2)
        self.assertLess(time.time() - t0, 2, "devolveu no prazo, sem esperar a chamada")
        self.assertEqual((cx.exception.tipo, cx.exception.cooldown_s), ("cooldown", COOLDOWN_PRAZO_S))

    def test_chamada_normal_devolve_o_valor_e_o_erro_original_sobe(self):
        from coletor.ig import com_prazo

        self.assertEqual(com_prazo(lambda: 42, 1), 42)
        with self.assertRaises(KeyError):
            com_prazo(lambda: {}["x"], 1)

    def test_handler_interativo_vira_checkpoint_e_nao_pede_teclado(self):
        from coletor.ig import _sem_interacao

        with self.assertRaises(ErroDeConta) as cx:
            _sem_interacao("usuario", "EMAIL")
        self.assertEqual(cx.exception.tipo, "checkpoint")

    def test_job_com_chamada_pendurada_termina_e_solta_a_conta(self):
        # O motor + o prazo: a 1ª conta pendura, o prazo a põe em cooldown, a 2ª conclui.
        from coletor.ig import com_prazo

        s, _ = saude_em_memoria()

        class Cl(ClienteFalso):
            def __init__(self, trava):
                super().__init__([([curto(1)], "")])
                self.trava = trava

            def entrar(self, c):
                self.entrou = c.username
                if self.trava and c.username == "a":
                    com_prazo(lambda: time.sleep(5), 0.2)

        cl = Cl(True)
        job = Job("alvo", 10)
        rodar(job, [conta("a"), conta("b")], s, cl)
        self.assertEqual((job.status, job.total()), ("SUCCEEDED", 1))
        res = {l["username"]: l for l in s.resumo([conta("a"), conta("b")], 250)}
        self.assertEqual(res["a"]["status"], "cooldown")
        self.assertFalse(res["a"]["em_uso"] or res["b"]["em_uso"])


# ── tradução dos erros da biblioteca real ──────────────────────────────────
try:
    import instagrapi.exceptions as ex  # noqa: F401
    TEM_LIB = True
except ImportError:  # pragma: no cover
    TEM_LIB = False


@unittest.skipUnless(TEM_LIB, "instagrapi não instalado")
class TestTraducao(unittest.TestCase):
    def test_classes_reais_viram_a_acao_certa(self):
        from instagrapi import exceptions as ex
        from coletor.ig import COOLDOWN_ACAO_S, COOLDOWN_RITMO_S, traduzir

        casos = [
            (ex.ChallengeRequired, "checkpoint", None),
            (ex.LoginRequired, "checkpoint", None),
            (ex.ClientLoginRequired, "checkpoint", None),
            (ex.CaptchaChallengeRequired, "checkpoint", None),
            (ex.AccountSuspended, "checkpoint", None),
            (ex.SentryBlock, "checkpoint", None),
            (ex.ReloginAttemptExceeded, "checkpoint", None),
            (ex.RecaptchaChallengeForm, "checkpoint", None),
            (ex.ChallengeSelfieCaptcha, "checkpoint", None),
            (ex.SignupSpamError, "cooldown", COOLDOWN_ACAO_S),
            (ex.ProxyAddressIsBlocked, "cooldown", COOLDOWN_ACAO_S),
            (ex.BadPassword, "login_falhou", None),
            (ex.TwoFactorRequired, "login_falhou", None),
            (ex.PleaseWaitFewMinutes, "cooldown", COOLDOWN_RITMO_S),
            (ex.RateLimitError, "cooldown", COOLDOWN_RITMO_S),
            (ex.FeedbackRequired, "cooldown", COOLDOWN_ACAO_S),
            (ex.ClientForbiddenError, "cooldown", COOLDOWN_ACAO_S),
        ]
        for cls, tipo, cd in casos:
            t = traduzir(cls())
            self.assertIsInstance(t, ErroDeConta, cls.__name__)
            self.assertEqual((t.tipo, t.cooldown_s), (tipo, cd), cls.__name__)
        for cls in (ex.UserNotFound, ex.PrivateAccount):
            self.assertIsInstance(traduzir(cls()), AlvoInvalido, cls.__name__)
        inesperado = ValueError("x")
        self.assertIs(traduzir(inesperado), inesperado)


if __name__ == "__main__":
    unittest.main()
