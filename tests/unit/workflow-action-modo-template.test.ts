// @vitest-environment node
/**
 * O NÓ DE MENSAGEM EM MODO TEMPLATE META.
 *
 * ─── O DEFEITO QUE ESTE ARQUIVO FIXA ────────────────────────────────────────
 *
 * O painel oferece "Template Meta" desde sempre e, ao escolhê-lo, ESCONDE o
 * campo de mensagem. O executor não lia o modo: caía na guarda de texto vazio e
 * devolvia `Empty message template`, não-retentável, antes de tentar enviar
 * coisa alguma. Medido em produção: 1 nó ativo, 1 org, 7 execuções mortas — a
 * automação de confirmação de responsável da Chique Distribuidora, num canal
 * oficial, com o template já escolhido e aprovado.
 *
 * O caso 2 aqui é exatamente essa execução. Ele falhava por "texto vazio"; a
 * partir de agora ou o template sai, ou o motivo diz o que configurar.
 *
 * ─── O SEAM ─────────────────────────────────────────────────────────────────
 *
 * `executeWorkflowAction`, como em `workflow-action-escape-janela.test.ts`: o
 * buraco estava ENTRE o painel, que declara o modo, e o handler, que o ignorava.
 * Testar `modoDoNo` sozinho não pegaria — a função nem existia, e a decisão
 * estava ausente, não errada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../tests/helpers/deno-mock";
import { clearDenoEnv } from "../../tests/helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";

const sendTextMock = vi.fn();
const sendTemplateMock = vi.fn();

vi.mock("../../supabase/functions/_shared/whatsapp-dispatch.ts", async (original) => {
  const real = await original<Record<string, unknown>>();
  return {
    ...real,
    sendTextViaInstance: (...args: unknown[]) => sendTextMock(...args),
    sendTemplateViaInstance: (...args: unknown[]) => sendTemplateMock(...args),
  };
});

vi.mock("../../supabase/functions/_shared/whatsapp-client.ts", () => ({
  getWhatsAppProvider: vi.fn(async () => ({ provider: "notificame" })),
}));

import { executeWorkflowAction } from "../../supabase/functions/_shared/workflow-action-handler";
import { MOTIVO_LEGIVEL_SEM_TEMPLATE } from "../../supabase/functions/_shared/decisao-de-envio.ts";

const ORG = "org-1";
const LEAD = "lead-1";

const LEAD_ROW = {
  id: LEAD,
  name: "Maria",
  phone: "11999999999",
  company: "Acme",
  organization_id: ORG,
  pipe_whatsapp: "novo",
  rating: 5,
};

const CANAL_OFICIAL = {
  id: "inst-oficial",
  organization_id: ORG,
  provider: "notificame",
  instance_name: "Chiquê",
  status: "connected",
  session_dead_since: null,
};

/** O template escolhido no painel — nome, idioma, forma aprovada e o mapa. */
const TEMPLATE = {
  templateName: "confirmacao_responsavel_utilidade_v2",
  templateLanguage: "pt_BR",
  templateComponents: [
    { type: "BODY", text: "Olá. Este número consta como contato da empresa {{1}}." },
  ],
  templateVariables: { "1": "{{nome}}" },
};

function cenario() {
  const { sb, mockTable } = createMockSupabase();
  mockTable("leads", [LEAD_ROW]);
  mockTable("whatsapp_instances", [CANAL_OFICIAL]);
  mockTable("whatsapp_messages", []);
  mockTable("lead_history", []);
  return sb;
}

/**
 * ⚠️ SEM `messageTemplate` NO PADRÃO, e isto é o ponto.
 *
 * No modo template o painel esconde o campo de texto, então o nó real chega ao
 * executor sem ele. Um padrão que o preenchesse "para o teste rodar" tornaria
 * verde exatamente o caminho que estava quebrado.
 */
const rodar = (sb: unknown, nodeData: Record<string, unknown>) =>
  executeWorkflowAction({
    supabase: sb as never,
    organizationId: ORG,
    leadId: LEAD,
    nodeData: {
      actionType: "send_whatsapp",
      whatsappInstanceId: "inst-oficial",
      ...nodeData,
    },
    executionContext: {},
  });

beforeEach(() => {
  clearDenoEnv();
  vi.clearAllMocks();
  sendTextMock.mockResolvedValue({ success: true, messageId: "msg-1" });
  sendTemplateMock.mockResolvedValue({ success: true, messageId: "hsm-1" });
});

describe("modo Template Meta", () => {
  it("manda o template, sem tocar no caminho de texto", async () => {
    const r = await rodar(cenario(), { templateMode: "meta_template", ...TEMPLATE });

    expect(r.success).toBe(true);
    expect(sendTemplateMock).toHaveBeenCalledTimes(1);
    expect(sendTextMock).not.toHaveBeenCalled();

    const [, , telefone, enviado] = sendTemplateMock.mock.calls[0];
    expect(telefone).toBe("5511999999999");
    expect(enviado.name).toBe("confirmacao_responsavel_utilidade_v2");
    expect(enviado.language).toBe("pt_BR");
  });

  it("resolve as variáveis do template contra o lead", async () => {
    await rodar(cenario(), { templateMode: "meta_template", ...TEMPLATE });

    const [, , , enviado] = sendTemplateMock.mock.calls[0];
    // O mapa diz `{"1": "{{nome}}"}` — o valor que sai é o nome do lead, não o
    // literal. Trocar os dois namespaces é o erro caro deste desenho.
    expect(JSON.stringify(enviado.components)).toContain("Maria");
    expect(JSON.stringify(enviado.components)).not.toContain("{{nome}}");
  });

  it("sem template escolhido: falha com o motivo que diz o que fazer", async () => {
    // A EXECUÇÃO DA CHIQUE, byte a byte: modo template, nenhum template, campo
    // de texto ausente porque o painel o esconde.
    const r = await rodar(cenario(), { templateMode: "meta_template" });

    expect(r.success).toBe(false);
    expect(r.error).toBe(MOTIVO_LEGIVEL_SEM_TEMPLATE);
    expect(r.retryable).toBe(false);
    // O que NÃO pode voltar a acontecer.
    expect(r.error).not.toContain("Empty message template");
    expect(sendTextMock).not.toHaveBeenCalled();
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  it("nó legado com `useTemplate` e sem `templateMode` é modo template", async () => {
    // O painel sempre derivou o modo assim. Se o executor não espelhasse, o nó
    // apareceria como template na tela e sairia como texto no envio.
    const r = await rodar(cenario(), { useTemplate: true, ...TEMPLATE });

    expect(r.success).toBe(true);
    expect(sendTemplateMock).toHaveBeenCalledTimes(1);
  });

  it("ignora o escape de janela — no modo template ele não tem hora de agir", async () => {
    await rodar(cenario(), {
      templateMode: "meta_template",
      ...TEMPLATE,
      escapeTemplateName: "outro_template_qualquer",
    });

    const [, , , enviado] = sendTemplateMock.mock.calls[0];
    expect(enviado.name).toBe("confirmacao_responsavel_utilidade_v2");
  });
});

describe("os outros modos seguem idênticos", () => {
  it("sem modo declarado: texto, e o template nem é tocado", async () => {
    const r = await rodar(cenario(), { messageTemplate: "Olá {{nome}}" });

    expect(r.success).toBe(true);
    expect(sendTextMock).toHaveBeenCalledTimes(1);
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  it("modo `free` com template gravado por engano: manda o texto", async () => {
    // Trocar o modo no painel não apaga o que o outro modo gravou. Quem manda é
    // o modo — configuração órfã não pode virar envio.
    const r = await rodar(cenario(), {
      templateMode: "free",
      messageTemplate: "Olá {{nome}}",
      ...TEMPLATE,
    });

    expect(r.success).toBe(true);
    expect(sendTextMock).toHaveBeenCalledTimes(1);
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });
});
