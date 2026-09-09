/**
 * Unit tests for `resolvePendingDeepLink` — decide o que fazer com o telefone
 * pendente de um deep-link (`/chat?phone=…`) depois que a lista de contatos da
 * caixa carrega.
 *
 * O inbox é derivado das 8000 mensagens mais recentes da instância
 * (`useWhatsAppContacts.ts:251`), então uma conversa antiga existe no banco e
 * não aparece na lista. Antes desta função, esse caso não abria nada: a tela
 * mostrava "Selecione uma conversa" com a conversa viva no banco.
 */

import { describe, it, expect } from "vitest";
import { resolvePendingDeepLink } from "@/modules/communication/lib/resolvePendingDeepLink";

describe("resolvePendingDeepLink", () => {
  it("contato fora da janela de contatos → abre a conversa pelo telefone mesmo assim", () => {
    // Sem contato na lista não há `instance_id` para compor a chave: a caixa
    // aberta é a única resposta possível para "por qual número isto abre?".
    const result = resolvePendingDeepLink({
      pendingPhone: "+55 48 99988-7766",
      contacts: [
        { phone_number: "5511987654321", instance_id: "cx-1" },
        { phone_number: "5521912345678", instance_id: "cx-1" },
      ],
      contactsLoading: false,
      caixaSelecionada: "cx-1",
    });

    expect(result).toEqual({
      action: "select",
      contactKey: "whatsapp:cx-1:48999887766",
    });
  });

  it("sem contato E sem caixa aberta → a chave nasce sem caixa, e continua parseável", () => {
    // Acontece no primeiro render de um `?phone=` que chega antes das caixas.
    // `whatsapp::5511…` seria uma chave de dois segmentos disfarçada, e o parser
    // devolveria o interlocutor errado — daí o `sem-caixa` explícito.
    const result = resolvePendingDeepLink({
      pendingPhone: "48999887766",
      contacts: [],
      contactsLoading: false,
    });

    expect(result).toEqual({
      action: "select",
      contactKey: "whatsapp:sem-caixa:48999887766",
    });
  });

  it("contato na lista → usa o phone_number canônico do contato, não o normalizado", () => {
    // A thread consulta `whatsapp_messages` pelo phone_number como está gravado
    // (com o 55 na frente). `normalizePhone` tira o 55 — devolver a forma
    // normalizada aqui quebraria o caminho que hoje funciona.
    const result = resolvePendingDeepLink({
      pendingPhone: "48999887766",
      contacts: [
        { phone_number: "5511987654321", instance_id: "cx-1" },
        { phone_number: "5548999887766", instance_id: "cx-2" },
      ],
      contactsLoading: false,
      caixaSelecionada: "cx-1",
    });

    // A caixa sai do CONTATO (`cx-2`), não da caixa aberta: com duas caixas
    // marcadas, a conversa daquele telefone pode estar na outra — e a chave
    // precisa apontar para a linha que existe na lista.
    expect(result).toEqual({
      action: "select",
      contactKey: "whatsapp:cx-2:5548999887766",
    });
  });

  it("contatos ainda carregando → espera, não cai no fallback", () => {
    // Durante o load a lista está vazia. Cair no fallback aqui abriria pelo
    // telefone normalizado mesmo quando o contato vai chegar um instante
    // depois — e o phone_number canônico seria perdido.
    const result = resolvePendingDeepLink({
      pendingPhone: "48999887766",
      contacts: [],
      contactsLoading: true,
    });

    expect(result).toEqual({ action: "wait" });
  });

  it("telefone que não normaliza → desiste, sem selecionar nada", () => {
    const result = resolvePendingDeepLink({
      pendingPhone: "sem dígito nenhum",
      contacts: [{ phone_number: "5511987654321" }],
      contactsLoading: false,
    });

    expect(result).toEqual({ action: "abort" });
  });

  it("deep-link sem telefone → desiste", () => {
    const result = resolvePendingDeepLink({
      pendingPhone: null,
      contacts: [{ phone_number: "5511987654321" }],
      contactsLoading: false,
    });

    expect(result).toEqual({ action: "abort" });
  });
});
