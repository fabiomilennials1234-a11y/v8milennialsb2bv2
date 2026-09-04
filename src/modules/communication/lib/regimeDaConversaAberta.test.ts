/**
 * De qual caixa sai a resposta (D6).
 *
 * A promessa da onda, na frase do CTO: "responder na linha do canal oficial sai
 * pelo canal oficial, e na linha do Chip sai pelo Chip, SEM TOCAR NO SELETOR".
 * É isso que este arquivo prende.
 */
import { describe, expect, it } from "vitest";

import { regimeDaConversaAberta } from "./regimeDaConversaAberta";
import { buildWhatsAppConversationKey } from "@/modules/communication/hooks/chat/types";
import type { InboxBox } from "@/modules/communication/hooks/chat/types";

const chip: InboxBox = {
  kind: "whatsapp",
  id: "cx-carol",
  name: "Carol",
  status: "connected",
  provider: "uazapi",
};
const oficial: InboxBox = {
  kind: "whatsapp",
  id: "cx-chique",
  name: "Chiquê",
  status: "connected",
  provider: "notificame",
};
const insta: InboxBox = {
  kind: "instagram",
  id: "cx-insta",
  name: "@chiquestore",
  status: "connected",
  handle: "chiquestore",
};

const TODAS = [chip, oficial, insta];

describe("regimeDaConversaAberta — a linha manda", () => {
  it("linha do Chip com as duas marcadas: sai pelo Chip", () => {
    const r = regimeDaConversaAberta({
      chave: buildWhatsAppConversationKey(chip.id, "5548988334050"),
      caixas: TODAS,
      marcadas: [chip, oficial],
    });

    expect(r.caixa?.id).toBe("cx-carol");
    expect(r.ehSocial).toBe(false);
    expect(r.instanciaDeChip).toBe("cx-carol");
    expect(r.instanciaOficial).toBeNull();
    expect(r.canalDeInstagram).toBeNull();
  });

  it("linha do canal OFICIAL com as duas marcadas: sai pelo oficial", () => {
    // O MESMO conjunto marcado do teste acima. Só a linha aberta mudou — e é
    // por isso que o vendedor não precisa tocar no seletor para responder.
    const r = regimeDaConversaAberta({
      chave: `whatsapp_oficial:${oficial.id}:5548988334050`,
      caixas: TODAS,
      marcadas: [chip, oficial],
    });

    expect(r.caixa?.id).toBe("cx-chique");
    expect(r.ehSocial).toBe(true);
    expect(r.ehOficial).toBe(true);
    expect(r.instanciaOficial).toBe("cx-chique");
    expect(r.instanciaDeChip).toBeNull();
  });

  it("o MESMO telefone nas duas caixas dá regimes diferentes conforme a linha", () => {
    // O caso da Chique: 10 contatos falam pelos dois números. As duas linhas
    // existem ao mesmo tempo na tela, e cada uma responde pela sua caixa.
    const telefone = "5548988334050";
    const pelaCarol = regimeDaConversaAberta({
      chave: buildWhatsAppConversationKey(chip.id, telefone),
      caixas: TODAS,
      marcadas: [chip, oficial],
    });
    const peloOficial = regimeDaConversaAberta({
      chave: `whatsapp_oficial:${oficial.id}:${telefone}`,
      caixas: TODAS,
      marcadas: [chip, oficial],
    });

    expect(pelaCarol.instanciaDeChip).toBe("cx-carol");
    expect(pelaCarol.instanciaOficial).toBeNull();
    expect(peloOficial.instanciaOficial).toBe("cx-chique");
    expect(peloOficial.instanciaDeChip).toBeNull();
  });

  it("a caixa da CHAVE ganha da seleção, mesmo não estando marcada", () => {
    // Acontece por um instante quando o deep-link abre a conversa antes de o
    // conjunto assentar. Responder pela caixa marcada seria mandar a mensagem
    // pelo número errado — silenciosamente.
    const r = regimeDaConversaAberta({
      chave: buildWhatsAppConversationKey(oficial.id, "5548988334050"),
      caixas: TODAS,
      marcadas: [chip],
    });

    expect(r.caixa?.id).toBe("cx-chique");
    expect(r.ehOficial).toBe(true);
  });
});

describe("regimeDaConversaAberta — sem conversa aberta", () => {
  it("uma caixa marcada é a caixa de referência", () => {
    const r = regimeDaConversaAberta({ chave: null, caixas: TODAS, marcadas: [chip] });

    expect(r.caixa?.id).toBe("cx-carol");
    expect(r.instanciaDeChip).toBe("cx-carol");
  });

  it("VÁRIAS marcadas e nada aberto: não existe caixa atual", () => {
    // Inventar uma faria o composer nascer apontando para um número arbitrário.
    const r = regimeDaConversaAberta({
      chave: null,
      caixas: TODAS,
      marcadas: [chip, oficial],
    });

    expect(r.caixa).toBeNull();
    expect(r.instanciaDeChip).toBeNull();
    expect(r.instanciaOficial).toBeNull();
  });

  it("org sem caixa nenhuma não estoura", () => {
    const r = regimeDaConversaAberta({ chave: null, caixas: [], marcadas: [] });

    expect(r.caixa).toBeNull();
    expect(r.modoInstagram).toBe(false);
  });
});

describe("regimeDaConversaAberta — Instagram", () => {
  it("Instagram marcado sozinho liga o regime dele", () => {
    const r = regimeDaConversaAberta({ chave: null, caixas: TODAS, marcadas: [insta] });

    expect(r.modoInstagram).toBe(true);
    expect(r.canalDeInstagram).toBe("cx-insta");
  });

  it("Instagram NÃO liga o regime quando não está sozinho", () => {
    // Não deveria acontecer — o hook de seleção o torna exclusivo —, mas se
    // acontecer, a lista unificada é o caminho seguro: a RPC social é a que
    // ainda não aplica o recorte por responsável.
    const r = regimeDaConversaAberta({
      chave: null,
      caixas: TODAS,
      marcadas: [chip, insta],
    });

    expect(r.modoInstagram).toBe(false);
    expect(r.canalDeInstagram).toBeNull();
  });

  it("chave malformada não escolhe caixa nenhuma pela chave", () => {
    const r = regimeDaConversaAberta({
      chave: "5548988334050",
      caixas: TODAS,
      marcadas: [chip, oficial],
    });

    expect(r.caixa).toBeNull();
  });
});
