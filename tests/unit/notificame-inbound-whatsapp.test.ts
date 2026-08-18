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

/**
 * O ID DO CANAL MUDA DE CAMPO CONFORME A DIREÇÃO.
 *
 * Medido em produção (2026-08-18), com eventos reais das duas famílias:
 *
 *   WhatsApp, direction IN:   message.to = "d1205fbe-…" (canal)
 *                             message.from = "554884334050" (telefone)
 *   Instagram, direction OUT: message.from = "ff596caa-…" (canal)
 *                             message.to = "1585322436455913" (IGSID)
 *
 * A regra do fornecedor é coerente — o canal é sempre O NOSSO LADO — e
 * `CHANNEL_ID_PATHS` não cobria nenhum dos dois: procurava `channelId`,
 * `channel.id` e afins, que não existem no corpo real.
 *
 * Resultado: a primeira mensagem de WhatsApp que chegou de verdade foi PARKADA
 * como `unresolved_channel`, com o id do canal visível em `message.to`.
 *
 * O DISCRIMINADOR É O FORMATO, não a direção declarada. O canal do NotificaMe é
 * UUID; telefone e IGSID são numéricos puros. Ler o campo pela direção exigiria
 * confiar num `direction` que o remetente declara — e o UUID resolve sem essa
 * confiança: se casar com UUID, é canal; se não, é interlocutor.
 */
describe("pickChannelId — o canal é o UUID, venha de onde vier", () => {
  it("acha o canal em message.to (WhatsApp entrando)", async () => {
    const { pickChannelId } = await import(
      "../../supabase/functions/_shared/notificame-inbound.ts"
    );
    expect(pickChannelId({
      direction: "IN",
      message: { to: "d1205fbe-99c7-4744-ac6b-899cfbf03179", from: "554884334050" },
    })).toBe("d1205fbe-99c7-4744-ac6b-899cfbf03179");
  });

  it("acha o canal em message.from (Instagram saindo)", async () => {
    const { pickChannelId } = await import(
      "../../supabase/functions/_shared/notificame-inbound.ts"
    );
    expect(pickChannelId({
      direction: "OUT",
      message: { from: "ff596caa-2374-4591-8a51-3e8f27417c87", to: "1585322436455913" },
    })).toBe("ff596caa-2374-4591-8a51-3e8f27417c87");
  });

  it("NÃO confunde telefone nem IGSID com canal", async () => {
    const { pickChannelId } = await import(
      "../../supabase/functions/_shared/notificame-inbound.ts"
    );
    expect(pickChannelId({ message: { to: "554884334050", from: "5551999999999" } })).toBeNull();
    expect(pickChannelId({ message: { to: "1585322436455913", from: "17841400000" } })).toBeNull();
  });

  it("o caminho explícito continua ganhando — contrato antigo intocado", async () => {
    const { pickChannelId } = await import(
      "../../supabase/functions/_shared/notificame-inbound.ts"
    );
    expect(pickChannelId({
      channelId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      message: { to: "d1205fbe-99c7-4744-ac6b-899cfbf03179" },
    })).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("a palavra do canal não vira id", async () => {
    const { pickChannelId } = await import(
      "../../supabase/functions/_shared/notificame-inbound.ts"
    );
    expect(pickChannelId({ channel: "whatsapp_business_account" })).toBeNull();
  });
});
