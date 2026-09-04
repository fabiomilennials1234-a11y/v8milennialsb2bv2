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
  // Obrigatório desde que a chave da conversa virou `(instance_id,
  // phone_number)`. Não participa do rótulo, mas o dublê tem de continuar
  // sendo um contato válido.
  instance_id: "11111111-1111-1111-1111-111111111111",
  phone_number: "5548999998888",
  push_name: null,
  last_message: null,
  last_message_time: "2026-09-03T14:36:00Z",
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

describe("contactLabel — WhatsApp sem número de verdade", () => {
  // Medido em 03/09 na Café Jurerê: 514 das 988 linhas do inbox eram LID,
  // exibidas como `210028246085780`.
  it("LID vira rótulo com discriminador, não código", () => {
    expect(contactLabel(whatsapp({ phone_number: "210028246085780" })))
      .toBe("Contato sem número · 085780");
  });

  it("canal do WhatsApp tem nome próprio", () => {
    expect(contactLabel(whatsapp({ phone_number: "120363404701403742" })))
      .toBe("Canal do WhatsApp");
  });

  it("nome conhecido continua ganhando do identificador", () => {
    expect(contactLabel(whatsapp({ phone_number: "210028246085780", push_name: "Ana" })))
      .toBe("Ana");
    expect(contactLabel(whatsapp({ phone_number: "210028246085780", lead_name: "Ana Lima" })))
      .toBe("Ana Lima");
  });

  it("telefone de verdade segue exibido igual", () => {
    expect(contactLabel(whatsapp({ phone_number: "5548999998888" })))
      .toBe("5548999998888");
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
