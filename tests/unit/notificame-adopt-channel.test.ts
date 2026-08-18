// @vitest-environment node
/**
 * ADOÇÃO DE CANAL PRÉ-EXISTENTE.
 *
 * Medido em produção com a Chique Distribuidora (18/08/2026): o canal de
 * WhatsApp já estava conectado no NotificaMe desde a véspera, feito pelo painel
 * do fornecedor. O Torque nunca conseguiu vinculá-lo, e por dois motivos que se
 * somam:
 *
 *   1. a cota da subconta (1 canal) estava inteira ocupada por ele, então o
 *      Seamless respondia `channel limit exceeded` — o popup morria antes de
 *      carregar, e sem popup não há `postMessage`, que é o ÚNICO gatilho do
 *      `channel-finish`;
 *   2. mesmo forçando o finish, a baseline — a foto tirada no clique — continha
 *      esse canal, e o finish descarta tudo que já estava na foto. Zero
 *      candidatos ⇒ `409 no_channel_found`, sete vezes seguidas.
 *
 * A saída manual foi zerar a baseline e chamar o finish pelo console. Isto aqui
 * é a saída pelo produto: o start percebe que existe canal adotável e o REMOVE
 * DA FOTO — só ele, nunca os outros. O finish então enxerga exatamente um
 * candidato e faz o vínculo pelo caminho normal, com todos os guards.
 *
 * A REGRA É "EXATAMENTE UM". Zero não é adoção (é conexão nova, fluxo antigo).
 * Dois ou mais é ambiguidade, e adivinhar em vínculo de tenant entrega as
 * mensagens de uma empresa a outra — o mesmo motivo pelo qual o finish já para
 * em `ambiguous_channel`.
 */
import { describe, it, expect } from "vitest";

import { pickAdoptableChannel } from "../../supabase/functions/_shared/notificame-adopt.ts";

const canal = (id: string, type: string | null) => ({
  id,
  name: `canal ${id}`,
  phone: null,
  type,
  status: "connected",
});

describe("pickAdoptableChannel", () => {
  it("adota o único canal do tipo pedido que ainda não está vinculado", () => {
    const r = pickAdoptableChannel(
      [canal("c1", "whatsapp_business_account")],
      new Set<string>(),
      "whatsapp",
    );
    expect(r).toEqual({ ok: true, channelId: "c1" });
  });

  it("reconhece o vocabulário do fornecedor, não só a palavra do nosso pedido", () => {
    // `whatsapp_business_account` é como o canal oficial aparece em /v1/channels.
    const r = pickAdoptableChannel(
      [canal("c1", "whatsapp_business_account"), canal("c2", "instagram")],
      new Set<string>(),
      "whatsapp",
    );
    expect(r).toEqual({ ok: true, channelId: "c1" });
  });

  it("ignora canal de outro tipo", () => {
    const r = pickAdoptableChannel([canal("c1", "instagram")], new Set(), "whatsapp");
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: "none" });
  });

  it("ignora canal que o Torque JÁ vinculou — senão a segunda conexão rouba a primeira", () => {
    const r = pickAdoptableChannel(
      [canal("c1", "whatsapp")],
      new Set(["c1"]),
      "whatsapp",
    );
    expect(r).toMatchObject({ ok: false, reason: "none" });
  });

  it("dois candidatos NÃO adota — ambiguidade em vínculo de tenant é vazamento", () => {
    const r = pickAdoptableChannel(
      [canal("c1", "whatsapp"), canal("c2", "whatsapp_business_account")],
      new Set(),
      "whatsapp",
    );
    expect(r).toMatchObject({ ok: false, reason: "ambiguous" });
  });

  it("dois canais, um já vinculado: o que sobra é adotável", () => {
    const r = pickAdoptableChannel(
      [canal("c1", "whatsapp"), canal("c2", "whatsapp")],
      new Set(["c1"]),
      "whatsapp",
    );
    expect(r).toEqual({ ok: true, channelId: "c2" });
  });

  it("canal sem type declarado não é adotado — o finish também recusaria", () => {
    const r = pickAdoptableChannel([canal("c1", null)], new Set(), "whatsapp");
    expect(r).toMatchObject({ ok: false, reason: "none" });
  });

  it("lista vazia (subconta nova) → nada a adotar, é o fluxo de conexão normal", () => {
    const r = pickAdoptableChannel([], new Set(), "instagram");
    expect(r).toMatchObject({ ok: false, reason: "none" });
  });

  it("instagram funciona pelo mesmo caminho", () => {
    const r = pickAdoptableChannel(
      [canal("c1", "instagram"), canal("c2", "whatsapp_business_account")],
      new Set(),
      "instagram",
    );
    expect(r).toEqual({ ok: true, channelId: "c1" });
  });
});

describe("baselineExcluindoAdotado", () => {
  it("tira SÓ o adotado da foto — os outros seguem protegidos", async () => {
    const { baselineExcluindoAdotado } = await import(
      "../../supabase/functions/_shared/notificame-adopt.ts"
    );
    expect(baselineExcluindoAdotado(["c1", "c2", "c3"], "c2")).toEqual(["c1", "c3"]);
  });

  it("sem adoção, a foto fica inteira", async () => {
    const { baselineExcluindoAdotado } = await import(
      "../../supabase/functions/_shared/notificame-adopt.ts"
    );
    expect(baselineExcluindoAdotado(["c1", "c2"], null)).toEqual(["c1", "c2"]);
  });
});
