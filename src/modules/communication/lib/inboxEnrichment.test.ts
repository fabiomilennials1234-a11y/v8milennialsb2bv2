/**
 * Testes do gate de enriquecimento do inbox.
 *
 * O que estes testes existem para travar NÃO é a implementação de
 * `inboxFilterGate` — é a **correspondência** entre as dimensões que
 * `applyInboxFilters` avalia a partir de dado enriquecido e as dimensões que o
 * gate cobre. A primeira versão do gate cobria 2 de 4, e as 2 que faltavam
 * (etiqueta e "pediu atendente") reencenavam o incidente da Goletric Pinheiros
 * inteiro por outra porta: enriquecimento vazio → predicado reprova a página →
 * gate diz "ok" → "Total: 0" apresentado como resposta, sem faixa de erro.
 *
 * Quem acrescentar uma dimensão enriquecida ao filtro e esquecer do gate vê
 * `ENRICHED_DIMENSIONS` vermelho aqui, antes do cliente ver a lista vazia.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_INBOX_FILTER, type InboxFilterState } from "./inboxFilter";
import {
  inboxFilterGate,
  READY_ENRICHMENT,
  type EnrichmentStatus,
  type InboxEnrichmentStatus,
} from "./inboxEnrichment";

const DESKTOP = { isMobile: false };
const MOBILE = { isMobile: true };

const state = (over: Partial<InboxFilterState> = {}): InboxFilterState => ({
  ...DEFAULT_INBOX_FILTER,
  ...over,
});

const status = (over: Partial<InboxEnrichmentStatus> = {}): InboxEnrichmentStatus => ({
  ...READY_ENRICHMENT,
  ...over,
});

/**
 * Toda dimensão do filtro cujo dado NÃO vem na linha da conversa: precisa de um
 * fetch que pode falhar, logo precisa pesar no gate.
 *
 * `source`, `unread`, `waiting` e `lead` ficam de fora de propósito — saem
 * direto de `ChatContact` (`last_message_sent_source`, `unread_count`,
 * `last_message_direction`, `lead_id`), não de enriquecimento nenhum.
 */
const ENRICHED_DIMENSIONS: {
  nome: string;
  filtro: Partial<InboxFilterState>;
  fonte: keyof InboxEnrichmentStatus;
  /** Mobile só avalia vendedor — ver `ConversationList.filteredContacts`. */
  avaliadoNoMobile: boolean;
}[] = [
  { nome: "funil", filtro: { funnels: ["pipe-1"] }, fonte: "meta", avaliadoNoMobile: false },
  { nome: "etapa", filtro: { stages: ["novo_lead"] }, fonte: "meta", avaliadoNoMobile: false },
  { nome: "qualificação", filtro: { tiers: ["ouro"] }, fonte: "meta", avaliadoNoMobile: false },
  { nome: "vendedor", filtro: { vendor: "tm-7" }, fonte: "vendor", avaliadoNoMobile: true },
  { nome: "etiqueta", filtro: { tags: ["tag-1"] }, fonte: "tags", avaliadoNoMobile: false },
  { nome: "pediu atendente", filtro: { needsHuman: true }, fonte: "waitingHuman", avaliadoNoMobile: false },
];

describe("inboxFilterGate — filtro inativo não segura a lista", () => {
  it("sem dimensão ativa, o gate é ok mesmo com TODAS as fontes em erro", () => {
    const tudoQuebrado = status({
      meta: "error",
      vendor: "error",
      tags: "error",
      waitingHuman: "error",
    });
    expect(inboxFilterGate(state(), tudoQuebrado, DESKTOP)).toBe("ok");
    expect(inboxFilterGate(state(), tudoQuebrado, MOBILE)).toBe("ok");
  });

  it("dimensão que não depende de enriquecimento não é segurada por fonte quebrada", () => {
    // Não-lidas, aguardando, fonte e presença de lead saem da própria linha da
    // conversa. Quebrar o enriquecimento não pode esconder essas listas.
    const s = state({ unread: true, waiting: true, source: "ia", lead: "com" });
    const tudoQuebrado = status({ meta: "error", vendor: "error", tags: "error", waitingHuman: "error" });
    expect(inboxFilterGate(s, tudoQuebrado, DESKTOP)).toBe("ok");
  });
});

describe("inboxFilterGate — cada dimensão enriquecida pesa na sua fonte", () => {
  it.each(ENRICHED_DIMENSIONS)(
    "$nome fecha o gate quando $fonte falha",
    ({ filtro, fonte }) => {
      const s = state(filtro);
      expect(inboxFilterGate(s, status({ [fonte]: "error" }), DESKTOP)).toBe("error");
      expect(inboxFilterGate(s, status({ [fonte]: "pending" }), DESKTOP)).toBe("pending");
      expect(inboxFilterGate(s, READY_ENRICHMENT, DESKTOP)).toBe("ok");
    },
  );

  it.each(ENRICHED_DIMENSIONS)(
    "$nome NÃO é afetada por falha nas outras fontes",
    ({ filtro, fonte }) => {
      const outras = (Object.keys(READY_ENRICHMENT) as (keyof InboxEnrichmentStatus)[]).filter(
        (k) => k !== fonte,
      );
      const soAsOutrasQuebradas = status(
        Object.fromEntries(outras.map((k) => [k, "error" as EnrichmentStatus])),
      );
      expect(inboxFilterGate(state(filtro), soAsOutrasQuebradas, DESKTOP)).toBe("ok");
    },
  );
});

describe("inboxFilterGate — mobile só avalia vendedor", () => {
  it.each(ENRICHED_DIMENSIONS)(
    "$nome no mobile: gate reage = $avaliadoNoMobile",
    ({ filtro, fonte, avaliadoNoMobile }) => {
      // Mobile tem header próprio e `ConversationList` filtra à mão, avaliando
      // só o vendedor. Segurar a lista por funil/etiqueta lá seria spinner por
      // um predicado que nem roda.
      const gate = inboxFilterGate(state(filtro), status({ [fonte]: "error" }), MOBILE);
      expect(gate).toBe(avaliadoNoMobile ? "error" : "ok");
    },
  );
});

describe("inboxFilterGate — precedência", () => {
  it("erro vence pending: a lista não fica em spinner escondendo uma falha", () => {
    const s = state({ funnels: ["pipe-1"], vendor: "tm-7" });
    expect(inboxFilterGate(s, status({ meta: "pending", vendor: "error" }), DESKTOP)).toBe("error");
    expect(inboxFilterGate(s, status({ meta: "error", vendor: "pending" }), DESKTOP)).toBe("error");
  });

  it("com várias dimensões ativas, basta UMA fonte quebrada", () => {
    const s = state({ funnels: ["pipe-1"], tags: ["tag-1"], needsHuman: true, vendor: "tm-7" });
    expect(inboxFilterGate(s, READY_ENRICHMENT, DESKTOP)).toBe("ok");
    expect(inboxFilterGate(s, status({ tags: "error" }), DESKTOP)).toBe("error");
    expect(inboxFilterGate(s, status({ waitingHuman: "error" }), DESKTOP)).toBe("error");
  });
});

describe("inboxFilterGate — vendedor", () => {
  it('"all" não é dimensão ativa; "mine" e "unassigned" são', () => {
    const quebrado = status({ vendor: "error" });
    expect(inboxFilterGate(state({ vendor: "all" }), quebrado, DESKTOP)).toBe("ok");
    // "unassigned" é o caso perigoso: com o mapa vazio por FALHA, o predicado
    // `vendorId == null` casaria TODO mundo em vez de ninguém — o filtro
    // inverte de sentido em vez de zerar. Precisa fechar o gate.
    expect(inboxFilterGate(state({ vendor: "unassigned" }), quebrado, DESKTOP)).toBe("error");
    expect(inboxFilterGate(state({ vendor: "mine" }), quebrado, DESKTOP)).toBe("error");
  });
});

describe("cobertura do gate", () => {
  it("toda fonte declarada em InboxEnrichmentStatus é alcançável por alguma dimensão", () => {
    // Fonte que nenhuma dimensão aciona é fonte morta: ou sobra no tipo, ou o
    // gate esqueceu de ligá-la.
    const alcancadas = new Set(ENRICHED_DIMENSIONS.map((d) => d.fonte));
    expect([...alcancadas].sort()).toEqual(Object.keys(READY_ENRICHMENT).sort());
  });

  it.each(ENRICHED_DIMENSIONS)(
    "$nome está de fato ligada ao gate (não é entrada decorativa da tabela)",
    ({ filtro, fonte }) => {
      // Guarda contra o próprio teste apodrecer: se alguém remover a dimensão do
      // gate, este caso quebra junto com os de cima em vez de passar vazio.
      expect(inboxFilterGate(state(filtro), status({ [fonte]: "error" }), DESKTOP)).not.toBe("ok");
    },
  );
});
