// @vitest-environment node
/**
 * Quais reações um evento de entrada do NotificaMe merece.
 *
 * ─── O QUE ESTA REGRA IMPEDE ────────────────────────────────────────────────
 *
 * O segundo nó mais executado do produto é o "esperar resposta" — 11.653
 * execuções em 7 dias. Ele destrava porque o webhook do chip chama uma RPC
 * quando o cliente responde. O webhook do NotificaMe não chama nada, e uma
 * execução que espere resposta naquele canal espera para sempre.
 *
 * A regra fica separada do handler porque o eixo do Instagram vai reusá-la, e
 * porque ela é onde as três decisões perigosas moram: o que conta como resposta
 * do cliente, por qual chave resolver, e quando NÃO fazer nada.
 */
import { describe, expect, it } from "vitest";

import { reacoesDoEvento } from "../../supabase/functions/_shared/notificame-reacoes.ts";

describe("canal oficial", () => {
  it("resposta do cliente resolve a espera PELO TELEFONE", () => {
    // Medido: 14 de 14 mensagens de entrada do canal oficial têm telefone, e a
    // RPC que destrava recorta `leads` por telefone. É a chave que existe.
    const r = reacoesDoEvento({
      direcao: "incoming",
      canal: "whatsapp",
      telefone: "554884334050",
      leadId: null,
    });

    expect(r.resolverEsperaPorTelefone).toBe("554884334050");
    expect(r.resolverEsperaPorLead).toBeNull();
  });

  it("dispara o gatilho de lead respondeu", () => {
    const r = reacoesDoEvento({
      direcao: "incoming",
      canal: "whatsapp",
      telefone: "554884334050",
      leadId: null,
    });

    expect(r.dispararLeadRespondeu).toBe(true);
  });
});

describe("o que NÃO aciona nada", () => {
  it("mensagem de SAÍDA não é resposta do cliente", () => {
    // As respostas que o vendedor dá pelo aplicativo entram como `outgoing`.
    // Tratá-las como resposta do lead destravaria o workflow com a nossa própria
    // mensagem — e o contador de espera se renovaria sozinho, sempre otimista.
    const r = reacoesDoEvento({
      direcao: "outgoing",
      canal: "whatsapp",
      telefone: "554884334050",
      leadId: null,
    });

    expect(r.resolverEsperaPorTelefone).toBeNull();
    expect(r.dispararLeadRespondeu).toBe(false);
  });

  it("entrada sem telefone e sem lead não tem por onde resolver", () => {
    // É o estado das 562 mensagens de Instagram hoje: sem telefone (o
    // identificador não é um) e sem lead vinculado. Não é erro — é uma conversa
    // que ainda não tem dono.
    const r = reacoesDoEvento({
      direcao: "incoming",
      canal: "instagram",
      telefone: null,
      leadId: null,
    });

    expect(r.resolverEsperaPorTelefone).toBeNull();
    expect(r.resolverEsperaPorLead).toBeNull();
    expect(r.dispararLeadRespondeu).toBe(false);
  });
});

describe("Instagram", () => {
  it("conversa vinculada resolve a espera PELO LEAD", () => {
    // Lá não há telefone: o interlocutor é um identificador da plataforma. A
    // variante da RPC que recebe o lead direto já existe, e é ela que serve.
    const r = reacoesDoEvento({
      direcao: "incoming",
      canal: "instagram",
      telefone: null,
      leadId: "11111111-2222-3333-4444-555555555555",
    });

    expect(r.resolverEsperaPorLead).toBe("11111111-2222-3333-4444-555555555555");
    expect(r.resolverEsperaPorTelefone).toBeNull();
    expect(r.dispararLeadRespondeu).toBe(true);
  });

  it("o identificador do Instagram NUNCA vira telefone", () => {
    // ⚠️ Medido: `normalize_brazilian_phone` devolve um identificador de 16
    // dígitos INTACTO — ele entraria na base como se fosse celular, e a partir
    // daí seria alvo de disparo e de busca por número. Se um dia o campo de
    // telefone vier preenchido com o identificador, a resolução por telefone
    // não pode aceitá-lo.
    const r = reacoesDoEvento({
      direcao: "incoming",
      canal: "instagram",
      telefone: "2197382667721276",
      leadId: "11111111-2222-3333-4444-555555555555",
    });

    expect(r.resolverEsperaPorTelefone).toBeNull();
    expect(r.resolverEsperaPorLead).toBe("11111111-2222-3333-4444-555555555555");
  });
});
