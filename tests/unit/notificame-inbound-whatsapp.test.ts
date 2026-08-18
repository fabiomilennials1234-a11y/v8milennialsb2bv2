// @vitest-environment node
/**
 * RECEBIMENTO DE WHATSAPP OFICIAL — o canal deixa de ser chumbado.
 *
 * `buildInboundChannelMessageRow` nasceu na fatia do Instagram e gravava
 * `channel: "instagram"` literal, com o alvo sempre em `messaging_channel_id`.
 * Isso não é um descuido: o `channel-finish` declarava, em comentário, que só
 * registrava subscription para Instagram JUSTAMENTE porque o endpoint de entrada
 * só sabia gravar Instagram — mandar WhatsApp para lá parkaria tudo.
 *
 * Consequência medida (Chique Distribuidora, 18/08/2026): canal oficial vinculado
 * e funcionando para ENVIAR, e a resposta do cliente não entrando no Torque.
 * Para o vendedor isso é indistinguível de "o cliente não respondeu" — pior que
 * não ter a integração.
 *
 * As duas diferenças entre os canais são de ENDEREÇAMENTO, e é só isso:
 *
 *   • o canal de Instagram é uma linha de `messaging_channels` → `messaging_channel_id`
 *   • o de WhatsApp é uma linha de `whatsapp_instances`        → `instance_id`
 *
 * Ambas as colunas já são nullable em `channel_messages`, e o enum `channel_type`
 * já tem `whatsapp` — medido em produção. Nenhuma migration para isto.
 *
 * E o `phone_number`: no WhatsApp o `contact_external_id` É o telefone, e a coluna
 * existe para as telas que só sabem falar de número. No Instagram ela fica nula —
 * o IGSID não é telefone e preenchê-la faria 13 superfícies mentirem.
 */
import { describe, it, expect } from "vitest";

import { buildInboundChannelMessageRow } from "../../supabase/functions/_shared/notificame-inbound.ts";

const base = {
  organizationId: "org-1",
  externalId: "msg-1",
  contact: {
    externalId: "5511999999999",
    name: "Fulano",
    handle: null,
    avatarUrl: null,
  },
  contactExternalId: "5511999999999",
  content: { messageType: "text", content: "oi", mediaUrl: null },
  timestampIso: "2026-08-18T14:00:00.000Z",
  rawPayload: { cru: true },
};

describe("inbound — Instagram (comportamento que NÃO pode mudar)", () => {
  it("grava channel=instagram e endereça por messaging_channel_id", () => {
    const row = buildInboundChannelMessageRow({
      ...base,
      target: { kind: "instagram", messagingChannelId: "mc-1" },
      contact: { ...base.contact, externalId: "17841400000000000", handle: "@fulano" },
      contactExternalId: "17841400000000000",
    });
    expect(row.channel).toBe("instagram");
    expect(row.messaging_channel_id).toBe("mc-1");
    expect(row.instance_id).toBeNull();
    expect(row.contact_handle).toBe("@fulano");
    // O IGSID não é telefone: preencher faria as telas de número mentirem.
    expect(row.phone_number).toBeNull();
  });
});

describe("inbound — WhatsApp oficial (o que esta fatia acrescenta)", () => {
  it("grava channel=whatsapp e endereça por instance_id", () => {
    const row = buildInboundChannelMessageRow({
      ...base,
      target: { kind: "whatsapp", instanceId: "wi-1" },
    });
    expect(row.channel).toBe("whatsapp");
    expect(row.instance_id).toBe("wi-1");
    expect(row.messaging_channel_id).toBeNull();
  });

  it("preenche phone_number — no WhatsApp o contato É o telefone", () => {
    const row = buildInboundChannelMessageRow({
      ...base,
      target: { kind: "whatsapp", instanceId: "wi-1" },
    });
    expect(row.phone_number).toBe("5511999999999");
  });

  it("o resto da linha é idêntico nos dois canais", () => {
    const ig = buildInboundChannelMessageRow({
      ...base,
      target: { kind: "instagram", messagingChannelId: "mc-1" },
    });
    const wa = buildInboundChannelMessageRow({
      ...base,
      target: { kind: "whatsapp", instanceId: "wi-1" },
    });
    for (const campo of ["direction", "status", "external_id", "content", "message_type"] as const) {
      expect(wa[campo]).toEqual(ig[campo]);
    }
    expect(wa.direction).toBe("incoming");
    expect(wa.status).toBe("received");
  });

  it("raw_payload segue integral — é o que ensina o formato quando a doc erra", () => {
    const row = buildInboundChannelMessageRow({
      ...base,
      target: { kind: "whatsapp", instanceId: "wi-1" },
    });
    expect(row.raw_payload).toEqual({ cru: true });
  });

  it("lead_id continua opcional e nulo por padrão — este caminho nunca cria lead", () => {
    const row = buildInboundChannelMessageRow({
      ...base,
      target: { kind: "whatsapp", instanceId: "wi-1" },
    });
    expect(row.lead_id).toBeNull();
  });
});
