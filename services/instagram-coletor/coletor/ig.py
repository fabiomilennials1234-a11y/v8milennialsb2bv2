"""Adaptador da biblioteca `instagrapi` (login real). Única parte que fala com o Instagram.

API conferida na versão FIXADA (`instagrapi==3.2.2`, ver requirements.txt) instalando-a e
lendo as assinaturas, em 28/10/2026:

    Client.login(username, password, relogin, verification_code)
    Client.login_by_sessionid(sessionid)
    Client.load_settings(path) / dump_settings(path) / set_proxy(dsn)
    Client.delay_range = [min, max]            # atraso aleatório antes de cada requisição privada
    Client.user_id_from_username(username)
    Client.user_followers_v1_chunk(user_id, max_amount, max_id) -> (list[UserShort], next_max_id)
    Client.user_info(user_id) -> User           # public_email, contact_phone_number, bio_links, ...

`UserShort` (a lista de seguidores) NÃO traz contato: só `user_info` traz, uma requisição por
perfil. É por isso que o ritmo é o custo da coleta.

NÃO foi exercitado contra o Instagram de verdade (sem conta no ambiente de desenvolvimento).
Os testes cobrem o mapeamento de erros com as classes reais da biblioteca e o resto do
serviço com um cliente falso.
"""
from __future__ import annotations

import concurrent.futures
import os
from typing import Any, Callable, Optional

from .coleta import AlvoInvalido, ErroDeConta
from .contas import Conta

COOLDOWN_RITMO_S = 30 * 60        # "espere alguns minutos", limite de requisições
COOLDOWN_ACAO_S = 6 * 3600        # bloqueio de ação (feedback_required), IP bloqueado (403)
COOLDOWN_PRAZO_S = 30 * 60        # chamada que não voltou a tempo: rede, proxy ou Instagram lentos
PRAZO_LOGIN_S = 90.0
PRAZO_CHAMADA_S = 75.0            # a biblioteca dorme até 60 s num timeout antes de tentar de novo


def com_prazo(fn: Callable[[], Any], segundos: float) -> Any:
    """Roda `fn` com prazo rígido. A biblioteca não tem prazo total: uma chamada pendurada
    seguraria a thread, o job e a conta para sempre. Estourou, a conta vai a cooldown e o cliente
    é descartado (a thread pendurada fica para trás e morre sozinha; não dá para matá-la)."""
    ex = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    try:
        return ex.submit(fn).result(timeout=segundos)
    except concurrent.futures.TimeoutError:
        raise ErroDeConta("cooldown", "tempo_esgotado", COOLDOWN_PRAZO_S) from None
    finally:
        ex.shutdown(wait=False, cancel_futures=True)


def _sem_interacao(*_a: Any, **_k: Any) -> Any:
    """Substitui os handlers interativos da biblioteca (`input()` no terminal). Num serviço não há
    quem digite o código: desafio que pede código é checkpoint, e o motor para."""
    raise ErroDeConta("checkpoint", "desafio_pede_codigo")


def traduzir(exc: BaseException) -> Exception:
    """Erro da biblioteca -> o que o motor sabe tratar. O que não reconhece volta como está."""
    from instagrapi import exceptions as ex

    nome = type(exc).__name__
    # Desafio de segurança, sessão inválida, conta suspensa ou bloqueada: precisa de gente. Não insistir.
    # `CaptchaChallengeRequired`, `AccountSuspended`, `SentryBlock` e `ReloginAttemptExceeded` NÃO herdam de
    # `ChallengeError` na biblioteca (conferido): listá-las é o que impede o motor de insistir num captcha.
    desafios = (
        ex.ChallengeRequired, ex.ChallengeError, ex.LoginRequired, ex.ClientLoginRequired,
        ex.CaptchaChallengeRequired, ex.AccountSuspended, ex.SentryBlock, ex.ReloginAttemptExceeded,
    )
    if isinstance(exc, desafios):
        return ErroDeConta("checkpoint", nome)
    if isinstance(exc, (ex.BadPassword, ex.TwoFactorRequired)):
        return ErroDeConta("login_falhou", nome)
    if isinstance(exc, (ex.PleaseWaitFewMinutes, ex.RateLimitError)):
        return ErroDeConta("cooldown", nome, COOLDOWN_RITMO_S)
    if isinstance(exc, (ex.FeedbackRequired, ex.ClientForbiddenError, ex.ProxyAddressIsBlocked)):
        return ErroDeConta("cooldown", nome, COOLDOWN_ACAO_S)
    if isinstance(exc, (ex.UserNotFound, ex.PrivateAccount)):
        return AlvoInvalido(nome)
    return exc  # type: ignore[return-value]


def _traduzindo(fn: Callable[..., Any]) -> Callable[..., Any]:
    def envolvido(*a: Any, **k: Any) -> Any:
        try:
            return fn(*a, **k)
        except (ErroDeConta, AlvoInvalido):
            raise
        except Exception as e:  # noqa: BLE001
            t = traduzir(e)
            if t is e:
                raise
            raise t from None

    return envolvido


class ClienteInstagrapi:
    def __init__(self, pasta_sessoes: str, atraso_min_s: float, atraso_max_s: float) -> None:
        self._pasta = pasta_sessoes
        self._atraso = [atraso_min_s, atraso_max_s]
        self._cl: Any = None

    @_traduzindo
    def entrar(self, conta: Conta) -> None:
        from instagrapi import Client

        cl = Client()
        cl.challenge_code_handler = _sem_interacao
        cl.change_password_handler = _sem_interacao
        # Atraso aleatório da própria biblioteca, ANTES de cada requisição privada (soma-se à pausa do motor).
        cl.delay_range = list(self._atraso)
        if conta.proxy:
            cl.set_proxy(conta.proxy)
        sessao = os.path.join(self._pasta, f"{conta.username}.json")

        def logar() -> None:
            if conta.sessionid:
                cl.login_by_sessionid(conta.sessionid)
            else:
                # Reusa a sessão e o "aparelho" da última vez: login novo a cada job é o que parece robô.
                if os.path.exists(sessao):
                    cl.load_settings(sessao)
                cl.login(conta.username, conta.password)

        com_prazo(logar, PRAZO_LOGIN_S)
        cl.dump_settings(sessao)
        try:
            os.chmod(sessao, 0o600)
        except OSError:
            pass
        self._cl = cl

    @_traduzindo
    def id_do_alvo(self, handle: str) -> str:
        return str(com_prazo(lambda: self._cl.user_id_from_username(handle), PRAZO_CHAMADA_S))

    @_traduzindo
    def seguidores(self, uid: str, max_id: str, quantidade: int) -> tuple[list[dict], str]:
        usuarios, proximo = com_prazo(
            lambda: self._cl.user_followers_v1_chunk(uid, max_amount=quantidade, max_id=max_id), PRAZO_CHAMADA_S
        )
        curtos = [
            {
                "pk": str(u.pk),
                "username": u.username,
                "full_name": u.full_name,
                "is_private": bool(u.is_private),
                "is_verified": bool(u.is_verified),
            }
            for u in usuarios
        ]
        return curtos, proximo or ""

    @_traduzindo
    def perfil(self, pk: str) -> dict:
        u = com_prazo(lambda: self._cl.user_info(pk), PRAZO_CHAMADA_S)
        telefone = u.contact_phone_number or (
            f"+{u.public_phone_country_code}{u.public_phone_number}" if u.public_phone_number and u.public_phone_country_code else None
        )
        return {
            "is_business": bool(u.is_business),
            "public_email": u.public_email or None,
            "contact_phone_number": telefone or None,
            "external_url": str(u.external_url) if u.external_url else None,
            "bio_links": [{"title": getattr(l, "title", None), "url": str(l.url)} for l in (u.bio_links or []) if getattr(l, "url", None)],
            "biography": u.biography or None,
            "category": u.category_name or u.category or u.business_category_name or None,
        }
