/**
 * O par que impede `X.map is not a function` de voltar à raiz `whatsapp_contacts`.
 *
 * O que estes testes prendem não é "a função funciona", e sim as duas decisões
 * que custaram a tela em 04/09:
 *
 *  1. LER sem presumir a forma — a raiz guarda array E envelope.
 *  2. DEVOLVER preservando o envelope — um patch de não-lida não pode apagar o
 *     `cheia`, que é o que diz ao motor da lista que a página cortou conversa.
 */
import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { comContatos, contatosDoCache, zerarNaoLidas } from "./cacheDeContatos";
import { chatQueryKeys } from "./queryKeys";
import type { ChatContact } from "../types";

function contato(phone: string, unread = 0): ChatContact {
  return {
    channel: "whatsapp",
    instance_id: "inst-1",
    phone_number: phone,
    push_name: null,
    last_message: "oi",
    last_message_time: "2026-09-04T10:00:00Z",
    last_message_direction: "incoming",
    last_message_sent_source: null,
    unread_count: unread,
    lead_id: null,
    lead_name: null,
    conversation_id: null,
    archived_at: null,
    tags: [],
    is_group: false,
    funnels: [],
    qualification_tier: null,
  };
}

describe("contatosDoCache — lê as duas formas da raiz", () => {
  it("o array da lista de UMA caixa sai como está", () => {
    const lista = [contato("5548999990001")];
    expect(contatosDoCache(lista)).toBe(lista);
  });

  it("o envelope da lista por CONJUNTO devolve o array de dentro", () => {
    const contatos = [contato("5548999990001")];
    expect(contatosDoCache({ contatos, cheia: true })).toBe(contatos);
  });

  it("valor não reconhecido devolve null, e NUNCA lista vazia", () => {
    // A diferença é a tela: `[]` faria o chamador gravar lista em branco por
    // cima de uma entrada que ele não entendeu.
    expect(contatosDoCache(undefined)).toBeNull();
    expect(contatosDoCache(null)).toBeNull();
    expect(contatosDoCache({ cheia: false })).toBeNull();
    expect(contatosDoCache("qualquer coisa")).toBeNull();
  });
});

describe("comContatos — devolve na MESMA forma de onde saiu", () => {
  it("array continua array", () => {
    const novos = [contato("5548999990002")];
    expect(comContatos([contato("5548999990001")], novos)).toEqual(novos);
  });

  it("o envelope sobrevive ao patch — `cheia` não é perdido", () => {
    const anterior = { contatos: [contato("5548999990001", 3)], cheia: true };
    const patched = comContatos(anterior, [contato("5548999990001", 0)]);

    expect(patched.cheia).toBe(true);
    expect(patched.contatos[0].unread_count).toBe(0);
    // Sem mutar o valor anterior: o TanStack compara referência para decidir
    // re-render, e mutar em cima congelaria a tela.
    expect(anterior.contatos[0].unread_count).toBe(3);
  });

  it("campo novo do envelope sobrevive sem ninguém vir aqui atualizar", () => {
    const anterior = { contatos: [contato("5548999990001")], cheia: false, extra: 42 };
    expect(comContatos(anterior, []).extra).toBe(42);
  });
});

// ─── O crash de 04/09, medido contra um cache de verdade ────────────────────

describe("zerarNaoLidas — a raiz com as DUAS formas ao mesmo tempo", () => {
  const ORG = "org-1";
  const INST = "inst-1";
  const OUTRA = "inst-2";
  const TELEFONE = "5548999990001";

  /**
   * O cache exatamente como o `/chat` o deixa: a lista por CONJUNTO (que é a
   * que a tela renderiza desde a W2) convivendo com a lista de UMA caixa que a
   * Conversa do Lead e a busca ainda povoam.
   */
  function cacheDoChat() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(chatQueryKeys.contactsMulti(ORG, [INST, OUTRA], ""), {
      contatos: [contato(TELEFONE, 4), contato("5548999990002", 1)],
      cheia: true,
    });
    qc.setQueryData(chatQueryKeys.contacts(ORG, INST, ""), [contato(TELEFONE, 4)]);
    return qc;
  }

  const multi = (qc: QueryClient) =>
    qc.getQueryData(chatQueryKeys.contactsMulti(ORG, [INST, OUTRA], "")) as {
      contatos: ChatContact[];
      cheia: boolean;
    };

  it("NÃO estoura ao encontrar o envelope — era `.map is not a function` no ErrorBoundary", () => {
    const qc = cacheDoChat();
    expect(() =>
      zerarNaoLidas(qc, ["whatsapp_contacts", ORG], (c) => c.phone_number === TELEFONE),
    ).not.toThrow();
  });

  it("zera de fato dentro do envelope, e preserva o `cheia` que o motor mediu", () => {
    const qc = cacheDoChat();

    zerarNaoLidas(qc, ["whatsapp_contacts", ORG], (c) => c.phone_number === TELEFONE);

    const depois = multi(qc);
    expect(depois.contatos[0].unread_count).toBe(0);
    // A outra conversa não foi tocada.
    expect(depois.contatos[1].unread_count).toBe(1);
    // E o sinal de página truncada continua de pé.
    expect(depois.cheia).toBe(true);
  });

  it("alcança as duas famílias sob a raiz na mesma chamada", () => {
    const qc = cacheDoChat();

    zerarNaoLidas(qc, ["whatsapp_contacts", ORG], (c) => c.phone_number === TELEFONE);

    const umaCaixa = qc.getQueryData(chatQueryKeys.contacts(ORG, INST, "")) as ChatContact[];
    expect(umaCaixa[0].unread_count).toBe(0);
  });

  it("sem linha para zerar, a referência do cache não muda — nada re-renderiza à toa", () => {
    const qc = cacheDoChat();
    const antes = multi(qc);

    zerarNaoLidas(qc, ["whatsapp_contacts", ORG], (c) => c.phone_number === "5548000000000");

    expect(multi(qc)).toBe(antes);
  });
});
