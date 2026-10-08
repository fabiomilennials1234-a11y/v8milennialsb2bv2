/**
 * O RÓTULO da conversa na lista e no cabeçalho.
 *
 * Medido em produção (19/08): a primeira conversa aberta pelo funil na caixa de
 * WhatsApp oficial apareceu como **"Instagram 176628"** — o fallback do canal
 * social aplicado a um canal que é WhatsApp, e a um interlocutor que é telefone.
 * O lead existia, com nome, vinculado pelo próprio número.
 */
import { describe, expect, it } from "vitest";

import { contactLabel, type ChatContact, type SocialContact } from "@/modules/communication/hooks/chat/types";

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

describe("contactLabel — flag chat_nome_do_lead", () => {
  const COM = { nomeDoLeadPrimeiro: true };

  it("o nome do lead ganha do nome salvo e do perfil", () => {
    expect(
      contactLabel(
        whatsapp({ lead_name: "0001-EMPRESA FICTICIA LTDA", push_name: "Ana", saved_contact_name: "Ana Agenda" }),
        COM,
      ),
    ).toBe("0001-EMPRESA FICTICIA LTDA");
  });

  it("sem lead: salvo, perfil, telefone", () => {
    expect(contactLabel(whatsapp({ push_name: "Ana", saved_contact_name: "Ana Agenda" }), COM)).toBe("Ana Agenda");
    expect(contactLabel(whatsapp({ push_name: "Ana" }), COM)).toBe("Ana");
    expect(contactLabel(whatsapp({}), COM)).toBe("5548999998888");
  });

  it("lead só com espaços cai no resto; LID vira rótulo", () => {
    expect(contactLabel(whatsapp({ lead_name: "  ", push_name: "Ana" }), COM)).toBe("Ana");
    expect(contactLabel(whatsapp({ phone_number: "210028246085780" }), COM)).toBe("Contato sem número · 085780");
  });

  it("grupo fica com a regra de sempre", () => {
    expect(
      contactLabel(whatsapp({ is_group: true, lead_name: "Lead", push_name: "Grupo X" }), COM),
    ).toBe("Grupo X");
  });

  it("canal não-WhatsApp fica com a regra de sempre", () => {
    expect(contactLabel(social({ display_name: "Nome IG", lead_name: "Lead" }), COM)).toBe("Nome IG");
  });

  it("sem a opção, a ordem antiga (salvo, perfil, lead)", () => {
    const c = whatsapp({ lead_name: "Lead", push_name: "Ana" });
    expect(contactLabel(c)).toBe("Ana");
    expect(contactLabel(c, { nomeDoLeadPrimeiro: false })).toBe("Ana");
  });
});

describe("contactLabel — flag chat_nome_cod_contato_lead (Chamado 82c50502)", () => {
  const cliente = whatsapp({
    lead_id: "l-1",
    lead_name: "Padaria Um",
    lead_erp_code: "6627",
    lead_contact_label: "José Luiz - Compras",
    push_name: "Zé",
  });

  it("lista mostra Cód - Contato - Lead", () => {
    expect(contactLabel(cliente, { nomeCodContatoLead: true })).toBe("6627 - José Luiz - Compras - Padaria Um");
  });

  it("vence chat_nome_do_lead", () => {
    expect(contactLabel(cliente, { nomeCodContatoLead: true, nomeDoLeadPrimeiro: true })).toBe(
      "6627 - José Luiz - Compras - Padaria Um",
    );
  });

  it("telefone sem nome de contato: Cód - Lead", () => {
    expect(contactLabel({ ...cliente, lead_contact_label: null }, { nomeCodContatoLead: true })).toBe(
      "6627 - Padaria Um",
    );
  });

  it("grupo fica com a regra de sempre", () => {
    expect(contactLabel({ ...cliente, is_group: true }, { nomeCodContatoLead: true })).toBe("Zé");
  });

  it("sem a flag, nada muda", () => {
    expect(contactLabel(cliente)).toBe("Zé");
    expect(contactLabel(cliente, { nomeDoLeadPrimeiro: true })).toBe("Padaria Um");
  });

  it("lista e topo dão o MESMO nome (uma função só)", async () => {
    const { nomeDaConversa } = await import("@/modules/communication/lib/nomeDaConversa");
    const topo = nomeDaConversa(
      {
        pushName: cliente.push_name,
        nomeDoLead: cliente.lead_name,
        telefone: cliente.phone_number,
        erpCode: cliente.lead_erp_code,
        contato: cliente.lead_contact_label,
      },
      { nomeCodContatoLead: true },
    );
    expect(contactLabel(cliente, { nomeCodContatoLead: true })).toBe(topo);
  });
});
