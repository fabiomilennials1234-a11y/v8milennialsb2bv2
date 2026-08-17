// @vitest-environment node
/**
 * Como um contato de rede social é NOMEADO na tela.
 *
 * A regra mudou em 2026-08-17, quando o @ do interlocutor passou a chegar de
 * verdade: até então `contactLabel` priorizava o @ porque o nome quase nunca
 * vinha. Com os dois disponíveis, quem vai no título é o NOME — é ele que o
 * vendedor reconhece ao bater o olho na lista — e o @ desce para subtítulo,
 * onde continua servindo de evidência citável ("o @ dela é m.montemezzo").
 *
 * Os dois campos vêm do mesmo payload e são fáceis de inverter: no corpo do
 * fornecedor, `visitor.name` é o @ e `visitor.firstName` é o nome humano.
 */
import { describe, it, expect } from "vitest";

import {
  contactLabel,
  contactHandleLabel,
  type SocialContact,
} from "../../src/modules/communication/hooks/chat/types";

function contato(over: Partial<SocialContact> = {}): SocialContact {
  return {
    channel: "instagram",
    conversation_key: "instagram:canal-1:1527557648673564",
    messaging_channel_id: "canal-1",
    external_user_id: "1527557648673564",
    handle: "m.montemezzo",
    display_name: "Marcelo Montemezzo",
    avatar_url: null,
    last_message: "Fala Gipp",
    last_message_time: "2026-08-17T17:25:02.000Z",
    last_message_direction: "incoming",
    unread_count: 0,
    lead_id: null,
    lead_name: null,
    tags: [],
    ...over,
  } as SocialContact;
}

describe("contactLabel — o título é o NOME", () => {
  it("com nome e @, mostra o nome", () => {
    expect(contactLabel(contato())).toBe("Marcelo Montemezzo");
  });

  it("sem nome, cai para o @ — melhor que um número opaco", () => {
    expect(contactLabel(contato({ display_name: null }))).toBe("@m.montemezzo");
  });

  it("sem nome e sem @, o último recurso é o id encurtado", () => {
    expect(contactLabel(contato({ display_name: null, handle: null })))
      .toBe("Instagram 673564");
  });

  it("nome só com espaços conta como ausência", () => {
    expect(contactLabel(contato({ display_name: "   " }))).toBe("@m.montemezzo");
  });
});

describe("contactHandleLabel — o subtítulo", () => {
  it("devolve o @ com arroba na frente", () => {
    expect(contactHandleLabel(contato())).toBe("@m.montemezzo");
  });

  it("devolve null quando não há @ — quem chama não renderiza a linha", () => {
    // `null` e não string vazia: uma string vazia renderizaria um subtítulo em
    // branco ocupando altura na lista.
    expect(contactHandleLabel(contato({ handle: null }))).toBeNull();
    expect(contactHandleLabel(contato({ handle: "  " }))).toBeNull();
  });

  it("não duplica a arroba quando o payload já a traz", () => {
    expect(contactHandleLabel(contato({ handle: "@m.montemezzo" }))).toBe("@m.montemezzo");
  });

  it("contato de WhatsApp não tem @", () => {
    const whats = {
      channel: "whatsapp",
      phone_number: "5511987654321",
      push_name: "Ana",
    } as unknown as Parameters<typeof contactHandleLabel>[0];

    expect(contactHandleLabel(whats)).toBeNull();
  });
});
