// @vitest-environment node
/**
 * persistOutboundMessage — a linha que a automação escreve depois de entregar.
 *
 * O que estes testes protegem é UMA propriedade: o `message_id` gravado é o id
 * REAL do provider. É ele que faz o eco `fromMe` do webhook colidir na UNIQUE
 * (message_id, instance_id) e virar DO NOTHING — preservando `sent_source =
 * 'workflow'` e, com isso, impedindo que o `trg_human_pause_on_manual_send`
 * pause o Copilot do lead a cada mídia enviada por automação.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../helpers/deno-mock";
import { createMockSupabase } from "../../helpers/supabase-mock";

// Spread do módulo real: `persistOutboundMessage` usa o `normalizeBrazilianPhone`
// daqui, e queremos exercitar a normalização de verdade.
vi.mock("../../../supabase/functions/_shared/whatsapp-dispatch.ts", async (orig) => ({
  ...(await (orig as () => Promise<Record<string, unknown>>)()),
  sendMediaViaInstance: vi.fn().mockResolvedValue({ success: true, messageId: "BATATA:3EB0C1" }),
  sendTextViaInstance: vi.fn().mockResolvedValue({ success: true, messageId: "BATATA:3EB0C2" }),
}));

vi.mock("../../../supabase/functions/_shared/whatsapp-client.ts", () => ({
  getWhatsAppProvider: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../supabase/functions/_shared/message-gateway.ts", () => ({
  sendMessage: vi.fn().mockResolvedValue({ delegated: false, success: true }),
}));

vi.mock("../../../supabase/functions/_shared/send-dedup.ts", () => ({
  reserveSendOrSkip: vi.fn().mockResolvedValue({ duplicate: false }),
}));

vi.mock("../../../supabase/functions/_shared/time-variables.ts", () => ({
  getTimeBasedVariables: vi.fn().mockReturnValue({ saudacao: "Bom dia", data: "18/05/2026", hora: "10:00" }),
}));

vi.mock("../../../supabase/functions/_shared/pipeline-adapter.ts", () => ({
  getPipeEntry: vi.fn().mockResolvedValue(null),
}));

import {
  persistOutboundMessage,
  providerPersistsOwnMessages,
} from "../../../supabase/functions/_shared/action-handlers/whatsapp-helpers";
import { sendWhatsAppImage } from "../../../supabase/functions/_shared/action-handlers/send-whatsapp-media";
import { sendMediaViaInstance } from "../../../supabase/functions/_shared/whatsapp-dispatch";

const WA_INSTANCE = {
  id: "inst-1",
  instance_name: "main",
  organization_id: "org-1",
  status: "connected",
  provider: "uazapi",
};

const LEAD = {
  id: "lead-1",
  name: "Test Lead",
  phone: "11999887766",
  company: "Acme",
  organization_id: "org-1",
};

type MockClient = ReturnType<typeof createMockSupabase>["sb"];

const BASE = {
  organizationId: "org-1",
  instanceId: "inst-1",
  phone: "5511999887766",
  messageType: "image",
  content: "Olha só",
  mediaUrl: "https://cdn.test/img.png",
  leadId: "lead-1",
};

/**
 * Decora o cliente já existente em vez de fabricar uma cadeia falsa: só troca o
 * `upsert` da tabela alvo, e todo o resto (o SELECT do rate limit, o do gate de
 * alcançabilidade) continua sendo o mock de verdade.
 */
function breakUpsert(sb: MockClient, table: string, behaviour: () => Promise<unknown>) {
  const realFrom = sb.from.bind(sb);
  sb.from = (t: string) => {
    const chain = realFrom(t);
    if (t === table) chain.upsert = () => behaviour();
    return chain;
  };
  return sb;
}

describe("persistOutboundMessage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("grava o id REAL do provider (é o que faz o eco fromMe colidir)", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("whatsapp_messages", []);

    await persistOutboundMessage(sb, { ...BASE, providerMessageId: "BATATA:3EB0C1D2E3" });

    const rows = getInserted("whatsapp_messages");
    expect(rows).toHaveLength(1);
    expect(rows[0].message_id).toBe("BATATA:3EB0C1D2E3");
  });

  it("cai para id sintético quando o provider não devolve id — invisível é pior que duplicado", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("whatsapp_messages", []);

    await persistOutboundMessage(sb, { ...BASE, providerMessageId: null });

    const rows = getInserted("whatsapp_messages");
    expect(rows).toHaveLength(1);
    expect(String(rows[0].message_id)).toMatch(/^wf_[0-9a-f-]{36}$/);
  });

  it("respeita o prefixo do id sintético de cada tipo de mensagem", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("whatsapp_messages", []);

    await persistOutboundMessage(sb, {
      ...BASE,
      providerMessageId: undefined,
      messageType: "pix_button",
      fallbackIdPrefix: "wf_pix",
    });

    expect(String(getInserted("whatsapp_messages")[0].message_id)).toMatch(/^wf_pix_[0-9a-f-]{36}$/);
  });

  it("marca a linha como automação: sent_source='workflow' e sent_by_ai=true", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("whatsapp_messages", []);

    await persistOutboundMessage(sb, { ...BASE, providerMessageId: "BATATA:AAA" });

    expect(getInserted("whatsapp_messages")[0]).toMatchObject({
      organization_id: "org-1",
      instance_id: "inst-1",
      lead_id: "lead-1",
      direction: "outgoing",
      status: "sent",
      message_type: "image",
      content: "Olha só",
      media_url: "https://cdn.test/img.png",
      sent_by_ai: true,
      sent_source: "workflow",
    });
  });

  it("aceita sent_source='copilot' — o Copilot não pode pausar a si mesmo", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("whatsapp_messages", []);

    await persistOutboundMessage(sb, {
      ...BASE,
      providerMessageId: "BATATA:CP2",
      sentSource: "copilot",
    });

    expect(getInserted("whatsapp_messages")[0]).toMatchObject({
      sent_by_ai: true,
      sent_source: "copilot",
    });
  });

  it("omitir sentSource mantém 'workflow' — quem chamava antes não muda de comportamento", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("whatsapp_messages", []);

    await persistOutboundMessage(sb, { ...BASE, providerMessageId: "BATATA:DEF" });

    expect(getInserted("whatsapp_messages")[0].sent_source).toBe("workflow");
  });

  it("nunca grava 'manual' — é o único valor que faria o gatilho pausar o Copilot", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("whatsapp_messages", []);

    for (const sentSource of ["workflow", "copilot"] as const) {
      await persistOutboundMessage(sb, { ...BASE, providerMessageId: `BATATA:${sentSource}`, sentSource });
    }

    // O CHECK do banco aceita `manual | copilot | workflow`; o tipo do parâmetro
    // exclui `manual` de propósito. Este teste é a trava em runtime do que o
    // tipo já garante em compilação — e o que o gatilho lê.
    for (const row of getInserted("whatsapp_messages")) {
      expect(row.sent_source).not.toBe("manual");
      expect(row.sent_by_ai).toBe(true);
    }
  });

  it("faz merge no conflito, para o eco que chegar primeiro não congelar o rótulo 'manual'", async () => {
    const { sb, mockTable, getUpsertOpts } = createMockSupabase();
    mockTable("whatsapp_messages", []);

    await persistOutboundMessage(sb, { ...BASE, providerMessageId: "BATATA:BBB" });

    expect(getUpsertOpts("whatsapp_messages")[0]).toEqual({
      onConflict: "message_id,instance_id",
      ignoreDuplicates: false,
    });
  });

  it("normaliza o telefone antes de montar o remote_jid (a UI reage/edita por ele)", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("whatsapp_messages", []);

    await persistOutboundMessage(sb, { ...BASE, phone: "(11) 99988-7766", providerMessageId: "BATATA:CCC" });

    expect(getInserted("whatsapp_messages")[0]).toMatchObject({
      phone_number: "5511999887766",
      remote_jid: "5511999887766@s.whatsapp.net",
    });
  });

  it("omite media_url e lead_id ausentes, em vez de sobrescrever o eco com null", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("whatsapp_messages", []);

    await persistOutboundMessage(sb, {
      organizationId: "org-1",
      instanceId: "inst-1",
      providerMessageId: "BATATA:DDD",
      phone: "5511999887766",
      messageType: "conversation",
      content: "Oi",
    });

    const row = getInserted("whatsapp_messages")[0];
    expect(row).not.toHaveProperty("media_url");
    expect(row).not.toHaveProperty("lead_id");
  });

  it("não propaga erro devolvido pelo upsert", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_messages", []);
    breakUpsert(sb, "whatsapp_messages", () =>
      Promise.resolve({ data: null, error: { code: "42501", message: "permission denied" } }),
    );

    await expect(
      persistOutboundMessage(sb, { ...BASE, providerMessageId: "BATATA:EEE" }),
    ).resolves.toBeUndefined();
  });

  it("não propaga exceção lançada pelo upsert", async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("whatsapp_messages", []);
    breakUpsert(sb, "whatsapp_messages", () => Promise.reject(new Error("connection reset")));

    await expect(
      persistOutboundMessage(sb, { ...BASE, providerMessageId: "BATATA:FFF" }),
    ).resolves.toBeUndefined();
  });
});

describe("sendWhatsAppImage (ramo legado) — RC-2", () => {
  beforeEach(() => vi.clearAllMocks());

  function makeInput(sb: MockClient) {
    return {
      supabase: sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: {
        whatsappInstanceId: "inst-1",
        imageUrl: "https://cdn.test/img.png",
        imageCaption: "Oi {{nome}}!",
      },
      executionContext: {},
    };
  }

  function seed() {
    const mock = createMockSupabase();
    mock.mockTable("whatsapp_instances", [WA_INSTANCE]);
    mock.mockTable("whatsapp_messages", []);
    mock.mockTable("leads", [LEAD]);
    return mock;
  }

  it("grava a imagem enviada com o id do provider e legenda resolvida", async () => {
    const { sb, getInserted } = seed();

    const result = await sendWhatsAppImage(makeInput(sb));

    expect(result.success).toBe(true);
    expect(sendMediaViaInstance).toHaveBeenCalledTimes(1);
    const rows = getInserted("whatsapp_messages");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      message_id: "BATATA:3EB0C1",
      message_type: "image",
      media_url: "https://cdn.test/img.png",
      content: "Oi Test Lead!",
      lead_id: "lead-1",
      sent_source: "workflow",
      sent_by_ai: true,
    });
  });

  it("segue com sucesso quando a gravação falha — a mensagem já saiu do WhatsApp", async () => {
    const { sb } = seed();
    breakUpsert(sb, "whatsapp_messages", () => Promise.reject(new Error("statement timeout")));

    const result = await sendWhatsAppImage(makeInput(sb));

    expect(result.success).toBe(true);
    expect(result.message).toContain("image sent");
  });
});

// ─── Canal oficial: quem já gravou não grava de novo (#1690) ───────────────

/**
 * A partir do #1690 um nó pode NOMEAR o canal oficial, e o caminho de envio
 * passa a receber uma Instance `notificame`. O provider dela grava a linha em
 * `channel_messages` no mesmo instante do envio — e uma segunda linha aqui não
 * seria só ruído: nasceria com `remote_jid` no formato da Uazapi, à espera de
 * um eco `fromMe` que nunca vem, e nunca receberia o `status_event` do
 * callback. A conversa mostraria a mensagem duas vezes e a cópia órfã mentiria
 * sobre o status para sempre.
 */
describe("providerPersistsOwnMessages", () => {
  it("o canal oficial grava sozinho; os legados não", () => {
    expect(providerPersistsOwnMessages("notificame")).toBe(true);
    expect(providerPersistsOwnMessages("uazapi")).toBe(false);
    expect(providerPersistsOwnMessages("evolution")).toBe(false);
    expect(providerPersistsOwnMessages(null)).toBe(false);
    expect(providerPersistsOwnMessages(undefined)).toBe(false);
  });

  it("não grava linha quando a Instance é do canal oficial", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("whatsapp_messages", []);

    await persistOutboundMessage(sb, {
      ...BASE,
      provider: "notificame",
      providerMessageId: "wamid.HBg",
    });

    expect(getInserted("whatsapp_messages")).toHaveLength(0);
  });

  // Controle positivo: sem ele, "zero linhas" não distingue a guarda de um
  // dublê que simplesmente não grava nada.
  it("continua gravando quando a Instance é legada", async () => {
    const { sb, mockTable, getInserted } = createMockSupabase();
    mockTable("whatsapp_messages", []);

    await persistOutboundMessage(sb, {
      ...BASE,
      provider: "uazapi",
      providerMessageId: "BATATA:3EB0",
    });

    expect(getInserted("whatsapp_messages")).toHaveLength(1);
  });
});
