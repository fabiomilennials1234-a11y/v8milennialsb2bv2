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

import { buildSocialConversationKey } from "./types";

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
