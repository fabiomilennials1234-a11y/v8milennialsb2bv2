// @vitest-environment node
/**
 * OS BOTÕES DO TEMPLATE ENVIADO PRECISAM APARECER NA CONVERSA.
 *
 * A Meta monta o corpo final a partir do nome e dos parâmetros — deste lado não
 * há como saber o que ela renderizou. Foi por isso que a linha nascia sem texto
 * e a conversa dizia "Mensagem interativa": a saída foi o CLIENTE mandar o texto
 * já montado, porque só ele tem o corpo aprovado e os parâmetros juntos.
 *
 * Com botão o problema se repete uma camada acima: o vendedor manda um template
 * com "Sim" e "Não", e a conversa mostra só o texto. Ele não tem como saber o
 * que o cliente está vendo, nem por que a resposta chegou como um toque.
 *
 * Mesma solução, mesmo motivo: os rótulos viajam de quem envia.
 */
import { describe, expect, it } from "vitest";

import { buildOutboundChannelMessageRow } from "../../supabase/functions/_shared/whatsapp-providers/notificame-provider.ts";

const base = {
  organizationId: "org-1",
  channelKind: "whatsapp" as const,
  instanceId: "inst-1",
  messagingChannelId: null,
  contactExternalId: "554884334050",
  externalId: "ext-1",
  messageType: "template",
  content: "Olá Maria, seu pedido saiu.",
  mediaUrl: null,
  timestampIso: "2026-08-19T22:00:00.000Z",
  rawPayload: {},
};

describe("linha de saída de template", () => {
  it("guarda os rótulos dos botões", () => {
    const row = buildOutboundChannelMessageRow({ ...base, botoes: ["Recebi", "Ver pedido"] });

    expect(row.metadata).toEqual({ tipo: "template", botoes: ["Recebi", "Ver pedido"] });
  });

  it("template sem botão não inventa metadata", () => {
    // `{tipo:"template", botoes:[]}` faria a bolha desenhar uma faixa vazia
    // debaixo da mensagem — uma borda solta que não existe no WhatsApp.
    expect(buildOutboundChannelMessageRow({ ...base, botoes: [] }).metadata).toBeNull();
    expect(buildOutboundChannelMessageRow(base).metadata).toBeNull();
  });
});
