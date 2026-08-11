// @vitest-environment node
/**
 * Os CHAMADORES de `persistOutboundMessage` — RC-2.
 *
 * O helper já tem teste próprio (`persist-outbound-message.test.ts`, que cobre
 * também a imagem). O que falta é o outro lado: quatro blocos quase idênticos em
 * `send-whatsapp-media.ts` (imagem/vídeo/figurinha/documento) mais o template de
 * `send-whatsapp-rich.ts`. Bloco quase idêntico é onde mora o erro de
 * copiar-e-colar, e ele é silencioso: a mídia sai no WhatsApp do cliente do
 * mesmo jeito, e só o histórico do chat fica errado — tipo trocado, URL do
 * vizinho, legenda crua com `{{nome}}` na cara do vendedor.
 *
 * Por isso todo cenário aqui manda o saco de parâmetros COMPLETO (as quatro URLs
 * e as três legendas ao mesmo tempo): pegar o campo errado do `params` deixa de
 * ser `undefined` — que qualquer asserção fraca perdoaria — e passa a gravar o
 * valor do handler vizinho, que a asserção pega.
 *
 * Os três invariantes que estes testes seguram:
 *   1. cada handler grava o SEU tipo, a SUA mídia e a SUA legenda já resolvida;
 *   2. o `message_id` é o id REAL do provider — é ele que faz o eco `fromMe`
 *      colidir na UNIQUE (message_id, instance_id) e não pausar o Copilot;
 *   3. envio que FALHOU não vira linha, e envio que o gateway assumiu não vira
 *      linha DUAS vezes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../helpers/deno-mock";
import { createMockSupabase } from "../../helpers/supabase-mock";

// Spread do módulo real: `persistOutboundMessage` usa o `normalizeBrazilianPhone`
// daqui, e só os dois envios abaixo são dublês.
vi.mock("../../../supabase/functions/_shared/whatsapp-dispatch.ts", async (orig) => ({
  ...(await (orig as () => Promise<Record<string, unknown>>)()),
  sendMediaViaInstance: vi.fn(),
  sendTextViaInstance: vi.fn(),
}));

vi.mock("../../../supabase/functions/_shared/whatsapp-client.ts", () => ({
  getWhatsAppProvider: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../../supabase/functions/_shared/message-gateway.ts", () => ({
  sendMessage: vi.fn(),
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
  sendWhatsAppImage,
  sendWhatsAppVideo,
  sendWhatsAppSticker,
  sendWhatsAppDocument,
} from "../../../supabase/functions/_shared/action-handlers/send-whatsapp-media";
import { sendWhatsAppTemplate } from "../../../supabase/functions/_shared/action-handlers/send-whatsapp-rich";
import {
  sendMediaViaInstance,
  sendTextViaInstance,
} from "../../../supabase/functions/_shared/whatsapp-dispatch";
import { sendMessage } from "../../../supabase/functions/_shared/message-gateway";

type Mock = import("vitest").Mock;
const mediaMock = sendMediaViaInstance as unknown as Mock;
const textMock = sendTextViaInstance as unknown as Mock;
const gatewayMock = sendMessage as unknown as Mock;

/** Ids no formato que o Uazapi devolve — o teste morre se virarem sintéticos. */
const ID_PROVIDER_MIDIA = "BAE5A1B2C3D4E5F6";
const ID_PROVIDER_TEXTO = "3EB0F1A2B3C4D5E6";

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
  pipe_whatsapp: "novo",
};

const TEMPLATE = {
  id: "tpl-1",
  name: "Proposta",
  content: "Oi {{nome}}, sua proposta da {{empresa}} saiu!",
};

/**
 * Saco COMPLETO: todas as URLs e todas as legendas de uma vez. Handler que pegar
 * o campo do vizinho grava um valor real e errado — não um `undefined` benigno.
 */
const PARAMS_COMPLETOS = {
  whatsappInstanceId: "inst-1",
  imageUrl: "https://cdn.test/foto.png",
  videoUrl: "https://cdn.test/demo.mp4",
  stickerUrl: "https://cdn.test/figura.webp",
  documentUrl: "https://cdn.test/proposta.pdf",
  documentName: "Proposta Comercial 2026.pdf",
  imageCaption: "Legenda da IMAGEM para {{nome}}",
  videoCaption: "Legenda do VIDEO para {{nome}}",
  documentCaption: "Legenda do DOCUMENTO para {{nome}}",
  templateId: "tpl-1",
};

function cenario(params: Record<string, unknown> = {}) {
  const mock = createMockSupabase();
  mock.mockTable("whatsapp_instances", [WA_INSTANCE]);
  mock.mockTable("whatsapp_messages", []);
  mock.mockTable("leads", [LEAD]);
  mock.mockTable("whatsapp_templates", [TEMPLATE]);

  return {
    ...mock,
    input: {
      supabase: mock.sb,
      organizationId: "org-1",
      leadId: "lead-1",
      conversationId: null,
      params: { ...PARAMS_COMPLETOS, ...params },
      executionContext: {},
    },
  };
}

type Envio = (input: ReturnType<typeof cenario>["input"]) => Promise<{ success: boolean; error?: string }>;

const MIDIAS: Array<{
  nome: string;
  enviar: Envio;
  tipo: string;
  url: string;
  legenda: string | null;
}> = [
  {
    nome: "imagem",
    enviar: sendWhatsAppImage as Envio,
    tipo: "image",
    url: PARAMS_COMPLETOS.imageUrl,
    legenda: "Legenda da IMAGEM para Test Lead",
  },
  {
    nome: "vídeo",
    enviar: sendWhatsAppVideo as Envio,
    tipo: "video",
    url: PARAMS_COMPLETOS.videoUrl,
    legenda: "Legenda do VIDEO para Test Lead",
  },
  {
    // Figurinha não tem legenda no WhatsApp: gravar uma é inventar conteúdo.
    nome: "figurinha",
    enviar: sendWhatsAppSticker as Envio,
    tipo: "sticker",
    url: PARAMS_COMPLETOS.stickerUrl,
    legenda: null,
  },
  {
    nome: "documento",
    enviar: sendWhatsAppDocument as Envio,
    tipo: "document",
    url: PARAMS_COMPLETOS.documentUrl,
    legenda: "Legenda do DOCUMENTO para Test Lead",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mediaMock.mockResolvedValue({ success: true, messageId: ID_PROVIDER_MIDIA });
  textMock.mockResolvedValue({ success: true, messageId: ID_PROVIDER_TEXTO });
  gatewayMock.mockResolvedValue({ delegated: false, success: true });
});

describe("call sites de mídia (ramo legado) — cada bloco grava o que é dele", () => {
  it.each(MIDIAS)(
    "$nome: grava o tipo, a mídia e a legenda DELA — não as do handler vizinho",
    async ({ enviar, tipo, url, legenda }) => {
      const { input, getInserted } = cenario();

      const result = await enviar(input);

      expect(result.success).toBe(true);
      const rows = getInserted("whatsapp_messages");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        organization_id: "org-1",
        instance_id: "inst-1",
        lead_id: "lead-1",
        direction: "outgoing",
        message_type: tipo,
        media_url: url,
        content: legenda,
        sent_source: "workflow",
        sent_by_ai: true,
      });
    },
  );

  it.each(MIDIAS)(
    "$nome: grava o id REAL do provider — id sintético não colide com o eco e o Copilot é pausado",
    async ({ enviar }) => {
      const { input, getInserted } = cenario();

      await enviar(input);

      const row = getInserted("whatsapp_messages")[0];
      expect(row.message_id).toBe(ID_PROVIDER_MIDIA);
      expect(String(row.message_id)).not.toMatch(/^wf/);
    },
  );

  it.each(MIDIAS.filter((m) => m.legenda !== null))(
    "$nome: grava a legenda já SUBSTITUÍDA, não o template cru com {{nome}}",
    async ({ enviar }) => {
      const { input, getInserted } = cenario();

      await enviar(input);

      const content = String(getInserted("whatsapp_messages")[0].content);
      expect(content).toContain("Test Lead");
      expect(content).not.toContain("{{");
    },
  );

  it.each(MIDIAS)(
    "$nome: envio que FALHOU não vira linha — mensagem que não saiu no histórico é pior que nenhuma",
    async ({ enviar }) => {
      const { input, getInserted } = cenario();
      mediaMock.mockResolvedValueOnce({ success: false, error: "instance disconnected" });

      const result = await enviar(input);

      expect(result.success).toBe(false);
      expect(getInserted("whatsapp_messages")).toHaveLength(0);
    },
  );

  it.each(MIDIAS)(
    "$nome: quando o gateway assume o envio, quem grava é ele — o handler não duplica a linha",
    async ({ enviar }) => {
      const { input, getInserted } = cenario();
      gatewayMock.mockResolvedValueOnce({ delegated: true, success: true });

      const result = await enviar(input);

      expect(result.success).toBe(true);
      expect(mediaMock).not.toHaveBeenCalled();
      expect(getInserted("whatsapp_messages")).toHaveLength(0);
    },
  );
});

describe("documento — o nome do arquivo é o que o cliente vê no WhatsApp", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leva o filename ao provider mesmo sem legenda, e grava content null (não string vazia)", async () => {
    const { input, getInserted } = cenario({ documentCaption: undefined });
    mediaMock.mockResolvedValue({ success: true, messageId: ID_PROVIDER_MIDIA });
    gatewayMock.mockResolvedValue({ delegated: false, success: true });

    const result = await sendWhatsAppDocument(input);

    expect(result.success).toBe(true);
    expect(mediaMock).toHaveBeenCalledTimes(1);
    expect(mediaMock.mock.calls[0][3]).toMatchObject({
      type: "document",
      file: PARAMS_COMPLETOS.documentUrl,
      filename: "Proposta Comercial 2026.pdf",
    });
    expect(getInserted("whatsapp_messages")[0].content).toBeNull();
  });
});

describe("template (send-whatsapp-rich) — texto de workflow, tipo `conversation`", () => {
  it("grava message_type 'conversation' (o que o chat renderiza), não o 'text' do gateway", async () => {
    const { input, getInserted } = cenario();

    const result = await sendWhatsAppTemplate(input);

    expect(result.success).toBe(true);
    const rows = getInserted("whatsapp_messages");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      message_id: ID_PROVIDER_TEXTO,
      message_type: "conversation",
      content: "Oi Test Lead, sua proposta da Acme saiu!",
      lead_id: "lead-1",
      sent_source: "workflow",
      sent_by_ai: true,
    });
    // Texto não carrega mídia: coluna omitida preserva o que o eco tiver gravado.
    expect(rows[0]).not.toHaveProperty("media_url");
  });

  it("template que falhou no envio não vira linha", async () => {
    const { input, getInserted } = cenario();
    textMock.mockResolvedValueOnce({ success: false, error: "session closed" });

    const result = await sendWhatsAppTemplate(input);

    expect(result.success).toBe(false);
    expect(getInserted("whatsapp_messages")).toHaveLength(0);
  });

  it("template delegado ao gateway não é gravado duas vezes", async () => {
    const { input, getInserted } = cenario();
    gatewayMock.mockResolvedValueOnce({ delegated: true, success: true });

    const result = await sendWhatsAppTemplate(input);

    expect(result.success).toBe(true);
    expect(textMock).not.toHaveBeenCalled();
    expect(getInserted("whatsapp_messages")).toHaveLength(0);
  });
});
