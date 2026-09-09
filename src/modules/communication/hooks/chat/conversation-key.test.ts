/**
 * A chave de conversa das caixas que leem `channel_messages`.
 *
 * O que este arquivo guarda é uma COLISÃO, não uma formatação. A chave vai para
 * `conversation_read_state.conversation_key`, e `get_whatsapp_conversation_list`
 * lê aquela tabela com `split_part(conversation_key, ':', 3)` sob o recorte
 * `conversation_key LIKE 'whatsapp:%'`. Uma chave da caixa oficial gravada no
 * namespace `whatsapp:` seria lida por aquela função como se o
 * `contact_external_id` fosse um telefone — e o contador de não lidas do inbox
 * de ~30 organizações passaria a somar conversa que não é dele.
 */
import { describe, expect, it } from "vitest";

import {
  buildSocialConversationKey,
  buildWhatsAppConversationKey,
  caixaDaChave,
  contactKey,
  interlocutorDaChave,
} from "./types";
import type { ChatContact } from "./types";

function doChip(over: Partial<ChatContact> = {}): ChatContact {
  return {
    channel: "whatsapp",
    instance_id: "cx-comercial",
    phone_number: "5548988334050",
    push_name: null,
    last_message: null,
    last_message_time: "2026-09-03T12:00:00Z",
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
  };
}

describe("buildSocialConversationKey", () => {
  it("mantém o namespace `instagram:` do dia zero", () => {
    expect(
      buildSocialConversationKey(
        "instagram",
        "11111111-1111-1111-1111-111111111111",
        "17841400000000000",
      ),
    ).toBe("instagram:11111111-1111-1111-1111-111111111111:17841400000000000");
  });

  it("usa `whatsapp_oficial:` para a caixa do canal oficial", () => {
    expect(
      buildSocialConversationKey(
        "whatsapp_oficial",
        "7312692e-b9b4-4f90-aba3-09cff992bbfc",
        "554884334050",
      ),
    ).toBe("whatsapp_oficial:7312692e-b9b4-4f90-aba3-09cff992bbfc:554884334050");
  });

  it("NUNCA emite uma chave no namespace `whatsapp:` — é o recorte da RPC do QR", () => {
    const chave = buildSocialConversationKey(
      "whatsapp_oficial",
      "7312692e-b9b4-4f90-aba3-09cff992bbfc",
      "554884334050",
    );

    // `LIKE 'whatsapp:%'` em SQL é exatamente este startsWith.
    expect(chave.startsWith("whatsapp:")).toBe(false);
  });

  it("o terceiro segmento continua sendo o interlocutor, mesmo com ':' no id", () => {
    // Id de rede social é opaco. A RPC social monta a chave inteira e compara
    // por igualdade justamente por isso; este teste registra que o produtor não
    // escapa nem corta nada — quem consome não pode fatiar.
    const chave = buildSocialConversationKey(
      "instagram",
      "11111111-1111-1111-1111-111111111111",
      "abc:def",
    );

    expect(chave).toBe("instagram:11111111-1111-1111-1111-111111111111:abc:def");
  });
});

describe("a chave da caixa de WhatsApp por QR", () => {
  it("é `(caixa, telefone)`, e não mais o telefone sozinho", () => {
    expect(contactKey(doChip())).toBe("whatsapp:cx-comercial:5548988334050");
  });

  it("O MESMO telefone em duas caixas dá chaves DIFERENTES", () => {
    // É a colisão que a caixa unificada existe para matar: com as duas linhas na
    // tela, uma chave só significaria mesma `key` de React, mesma seleção, e a
    // thread de uma abrindo no lugar da outra.
    const comercial = contactKey(doChip({ instance_id: "cx-comercial" }));
    const tecnica = contactKey(doChip({ instance_id: "cx-tecnica" }));

    expect(comercial).not.toBe(tecnica);
  });

  it("caixa ausente vira `sem-caixa`, e a chave continua com três segmentos", () => {
    // String vazia daria `whatsapp::5548…`, que é uma chave de dois segmentos
    // disfarçada — o parser devolveria o interlocutor errado.
    const chave = contactKey(doChip({ instance_id: null }));

    expect(chave).toBe("whatsapp:sem-caixa:5548988334050");
    expect(interlocutorDaChave(chave)).toBe("5548988334050");
  });

  it("o telefone volta CRU da chave — é ele que o composer usa", () => {
    // A chave do BANCO (`conversation_read_state`) guarda o telefone
    // normalizado; a de tela guarda o telefone como a lista o recebeu. Trocar um
    // pelo outro mudaria o número para o qual a mensagem sai.
    const chave = buildWhatsAppConversationKey("cx-1", "+55 48 98833-4050");

    expect(interlocutorDaChave(chave)).toBe("+55 48 98833-4050");
  });

  it("a caixa sai do segundo segmento, nos dois canais", () => {
    expect(caixaDaChave(buildWhatsAppConversationKey("cx-1", "5548988334050"))).toBe("cx-1");
    expect(
      caixaDaChave(buildSocialConversationKey("instagram", "canal-1", "17841400000000000")),
    ).toBe("canal-1");
  });

  it("o interlocutor social volta INTEIRO, mesmo contendo ':'", () => {
    // O produtor social não escapa nem corta nada (teste acima). Quem consome
    // precisa do par: fatiar por índice, e não `split(':')[2]`.
    const chave = buildSocialConversationKey("instagram", "canal-1", "abc:def");

    expect(interlocutorDaChave(chave)).toBe("abc:def");
  });

  it("chave malformada devolve null em vez de estourar", () => {
    expect(caixaDaChave("5548988334050")).toBeNull();
    expect(interlocutorDaChave("5548988334050")).toBeNull();
    expect(caixaDaChave(null)).toBeNull();
    expect(interlocutorDaChave(undefined)).toBeNull();
  });
});
