// @vitest-environment node
/**
 * O e-mail canônico da subconta, e o limite que o fornecedor não documenta.
 *
 * ─── O QUE FOI MEDIDO (2026-08-17) ──────────────────────────────────────────
 *
 * Criamos duas subcontas pela API com o e-mail canônico de 61 caracteres. O
 * fornecedor respondeu `HTTP 200 {"Status":"Sucesso"}` e guardou o e-mail
 * CORTADO em 45 caracteres — no meio do domínio:
 *
 *   enviado : torque-38f3bea4-44c6-4732-bb20-065f547a7ed8@milennials.com.br
 *   guardado: torque-38f3bea4-44c6-4732-bb20-065f547a7ed8@m
 *
 * Não é problema daquelas duas contas: `torque-{uuid}@{domínio}` dá 61 caracteres
 * para QUALQUER organização. Toda subconta criada pelo caminho automático
 * nasceria com e-mail truncado, a reconciliação procuraria o e-mail completo,
 * não acharia, e criaria uma segunda subconta — em silêncio, para todo cliente.
 *
 * O e-mail NÃO é editável depois (o PUT /v2/accounts não aceita o campo) e a API
 * não tem exclusão de subconta. Ou seja: o que nasce torto, nasce torto para
 * sempre. Daí as duas defesas abaixo — gerar curto E tolerar o truncamento.
 */
import { describe, it, expect } from "vitest";

import {
  SUBACCOUNT_EMAIL_MAX,
  buildSubaccountEmail,
  legacySubaccountEmail,
  subaccountEmailCandidates,
  findResaleAccountByEmail,
} from "../../supabase/functions/_shared/notificame.ts";

const ORG = "38f3bea4-44c6-4732-bb20-065f547a7ed8";
const DOMINIO = "milennials.com.br";

/** Resposta de `GET /v1/resale/` com o e-mail já truncado pelo fornecedor. */
function resaleComEmail(email: string): string {
  return JSON.stringify([
    { acccount_id: "0f92351a-7a05-4536-b77b-c8c90245c39d", email, name: "Chique", active: true },
  ]);
}

describe("buildSubaccountEmail — tem que caber no limite do fornecedor", () => {
  it("cabe em 45 caracteres com o domínio real", () => {
    const email = buildSubaccountEmail(ORG, DOMINIO);

    expect(email.length).toBeLessThanOrEqual(SUBACCOUNT_EMAIL_MAX);
    expect(email).toContain(`@${DOMINIO}`);
  });

  it("continua determinístico — a mesma org sempre gera o mesmo e-mail", () => {
    expect(buildSubaccountEmail(ORG, DOMINIO)).toBe(buildSubaccountEmail(ORG, DOMINIO));
  });

  it("orgs diferentes geram e-mails diferentes", () => {
    const outra = "27eab7ac-6d14-4b62-9e7b-c3bcdfbb396f";

    expect(buildSubaccountEmail(ORG, DOMINIO)).not.toBe(buildSubaccountEmail(outra, DOMINIO));
  });

  it("cabe mesmo com um domínio mais longo", () => {
    // O domínio vem de secret e pode mudar sem ninguém revisar este arquivo.
    const email = buildSubaccountEmail(ORG, "notificacoes.torquecrm.com.br");

    expect(email.length).toBeLessThanOrEqual(SUBACCOUNT_EMAIL_MAX);
  });
});

describe("subaccountEmailCandidates — o legado precisa continuar reconhecível", () => {
  it("inclui o formato novo e o antigo", () => {
    const candidatos = subaccountEmailCandidates(ORG, DOMINIO);

    expect(candidatos).toContain(buildSubaccountEmail(ORG, DOMINIO));
    expect(candidatos).toContain(legacySubaccountEmail(ORG, DOMINIO));
  });

  it("o formato antigo é o que gerou as subcontas de 17/08", () => {
    expect(legacySubaccountEmail(ORG, DOMINIO))
      .toBe(`torque-${ORG}@${DOMINIO}`);
  });
});

describe("findResaleAccountByEmail — tolera o corte do fornecedor", () => {
  it("casa quando o fornecedor devolve o e-mail INTEIRO", () => {
    const alvo = buildSubaccountEmail(ORG, DOMINIO);
    const r = findResaleAccountByEmail(resaleComEmail(alvo), alvo);

    // `ok` diz que a CONSULTA funcionou; quem diz se achou é o `status`.
    expect(r).toMatchObject({ ok: true, status: "found" });
  });

  it("casa quando o fornecedor truncou em 45 — o caso real", () => {
    const legado = legacySubaccountEmail(ORG, DOMINIO);
    const truncado = legado.slice(0, SUBACCOUNT_EMAIL_MAX);

    const r = findResaleAccountByEmail(resaleComEmail(truncado), legado);

    expect(r).toMatchObject({ ok: true, status: "found" });
  });

  it("NÃO casa por prefixo quando o e-mail não está no limite", () => {
    // Sem esta guarda, `torque-3@m` casaria com qualquer org que comece com 3 —
    // e adotar a subconta de OUTRO cliente é o pior desfecho possível aqui.
    const curto = "torque-3";
    const r = findResaleAccountByEmail(resaleComEmail(curto), legacySubaccountEmail(ORG, DOMINIO));

    expect(r).toMatchObject({ ok: true, status: "absent" });
  });

  it("NÃO casa o truncado de OUTRA organização", () => {
    const outraOrg = "27eab7ac-6d14-4b62-9e7b-c3bcdfbb396f";
    const truncadoDaOutra = legacySubaccountEmail(outraOrg, DOMINIO).slice(0, SUBACCOUNT_EMAIL_MAX);

    const r = findResaleAccountByEmail(
      resaleComEmail(truncadoDaOutra),
      legacySubaccountEmail(ORG, DOMINIO),
    );

    expect(r).toMatchObject({ ok: true, status: "absent" });
  });
});
