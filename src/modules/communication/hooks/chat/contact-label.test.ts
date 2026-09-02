/**
 * O RÓTULO da conversa na lista e no cabeçalho.
 *
 * Medido em produção (19/08): a primeira conversa aberta pelo funil na caixa de
 * WhatsApp oficial apareceu como **"Instagram 176628"** — o fallback do canal
 * social aplicado a um canal que é WhatsApp, e a um interlocutor que é telefone.
 * O lead existia, com nome, vinculado pelo próprio número.
 */
import { describe, expect, it } from "vitest";

import { contactLabel, type ChatContact, type SocialContact } from "./types";

const whatsapp = (over: Partial<ChatContact>): ChatContact => ({
  channel: "whatsapp",
  phone_number: "553499254544",
  push_name: null,
  last_message: null,
  last_message_time: "2026-09-02T11:54:00Z",
  last_message_direction: null,
  last_message_sent_source: null,
  unread_count: 0,
  lead_id: null,
  lead_name: null,
  conversation_id: null,
  archived_at: null,
  tags: [],
  is_group: false,
  ...over,
});

const social = (over: Partial<SocialContact>): SocialContact => ({
  channel: "whatsapp_oficial",
  conversation_key: "k",
  messaging_channel_id: "7312692e-b9b4-4f90-aba3-09cff992bbfc",
  external_user_id: "5547992176628",
  handle: null,
  display_name: null,
  avatar_url: null,
  last_message: null,
  last_message_time: "2026-08-19T14:36:00Z",
  last_message_direction: null,
  unread_count: 0,
  lead_id: null,
  lead_name: null,
  tags: [],
  ...over,
});

describe("contactLabel — WhatsApp: o nome do CRM manda", () => {
  it("o nome do lead ganha do push_name", () => {
    // Medido em 02/09 (Envase Carolini): o lead foi renomeado no CRM para
    // "6627 - Fernando Porto" e a LISTA continuou "Fernando Porto" — o
    // `push_name`, que é o perfil do interlocutor e nenhum vendedor consegue
    // editar. O cabeçalho da thread já mostrava o nome novo, e a lista, não.
    expect(
      contactLabel(
        whatsapp({ push_name: "Fernando Porto", lead_name: "6627 - Fernando Porto" }),
      ),
    ).toBe("6627 - Fernando Porto");
  });

  it("mesma ordem do cabeçalho da thread", () => {
    // `ChatShellWithContext` monta `effectiveLeadName ?? push_name ?? phone`.
    // Duas ordens diferentes para a MESMA conversa foi o defeito.
    const c = whatsapp({ push_name: "Zap", lead_name: "Cliente do CRM" });
    expect(contactLabel(c)).toBe(c.lead_name);
  });

  it("sem lead, o push_name segue valendo", () => {
    expect(contactLabel(whatsapp({ push_name: "Fernando Porto" }))).toBe("Fernando Porto");
  });

  it("sem nome nenhum, cai no telefone", () => {
    expect(contactLabel(whatsapp({}))).toBe("553499254544");
  });

  it("nome do lead em branco não vence o push_name", () => {
    // `""` e `"   "` chegam de import e de edição pela UI; ambos precisam cair
    // para o próximo, não virar linha sem rótulo.
    expect(contactLabel(whatsapp({ lead_name: "   ", push_name: "Fernando" }))).toBe("Fernando");
  });
});

describe("contactLabel — canal oficial", () => {
  it("usa o nome de quem mandou, quando ele veio", () => {
    expect(contactLabel(social({ display_name: "Gabriel Gipp" }))).toBe("Gabriel Gipp");
  });

  it("cai no NOME DO LEAD antes de qualquer identificador", () => {
    // O caso do funil: o lead é conhecido do CRM e nunca mandou mensagem.
    expect(contactLabel(social({ lead_name: "Flavionei Silva" }))).toBe("Flavionei Silva");
  });

  it("sem nome nenhum, mostra o TELEFONE — nunca 'Instagram'", () => {
    expect(contactLabel(social({}))).toBe("5547992176628");
    expect(contactLabel(social({}))).not.toContain("Instagram");
  });

  it("o nome de quem mandou ganha do nome do lead", () => {
    // São a mesma pessoa; o que o interlocutor escreveu no perfil é mais fresco.
    expect(
      contactLabel(social({ display_name: "Gabriel", lead_name: "Gabriel Aurelio Gipp" })),
    ).toBe("Gabriel");
  });
});

describe("contactLabel — Instagram segue como estava", () => {
  const ig = (over: Partial<SocialContact>) =>
    social({ channel: "instagram", external_user_id: "17841400000176628", ...over });

  it("nome primeiro, @ depois", () => {
    expect(contactLabel(ig({ display_name: "Marcelo" }))).toBe("Marcelo");
    expect(contactLabel(ig({ handle: "m.montemezzo" }))).toBe("@m.montemezzo");
  });

  it("sem nada, mantém o rótulo com os últimos 6 do id", () => {
    expect(contactLabel(ig({}))).toBe("Instagram 176628");
  });

  it("mas o nome do lead ainda ganha do id — vale para os dois canais", () => {
    expect(contactLabel(ig({ lead_name: "Marcelo Montemezzo" }))).toBe("Marcelo Montemezzo");
  });
});
