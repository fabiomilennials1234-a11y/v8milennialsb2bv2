// @vitest-environment node
/**
 * O NÓ DE TEXTO FORA DA JANELA DE 24 HORAS — issue #1689.
 *
 * ─── O SEAM ─────────────────────────────────────────────────────────────────
 *
 * `executeWorkflowAction`, a interface do módulo — e não as funções por dentro
 * dele. É assim que `workflow-action-audio.test.ts` fixou a regressão do áudio
 * e `workflow-action-instagram.test.ts` a do Direct, pelo mesmo motivo: os
 * buracos ficam ENTRE as peças. Aqui o buraco é entre o transporte, que sabe
 * que a Meta recusou, e o nó, que sabe qual template usar.
 *
 * ─── POR QUE O TRANSPORTE É O DUBLÊ ─────────────────────────────────────────
 *
 * O que este arquivo mede é o que o NÓ faz com o veredito, não como o veredito
 * é produzido — isso é do governor, tem teste próprio, e o gêmeo
 * (`decisao-de-envio-twin`) prende as duas pontas contra a string real que ele
 * emite. Dublar o transporte deixa cada caso caber em três linhas em vez de
 * exigir uma organização inteira em modo de bloqueio.
 *
 * ─── O CASO QUE JUSTIFICA A ISSUE ───────────────────────────────────────────
 *
 * Das 1.749 ligações entre nós dos workflows ativos, ZERO são de saída de erro.
 * Um nó que falha derruba a execução inteira — por isso "falha com motivo
 * legível" é resultado projetado, e o teste exige a FRASE, não um código.
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

// Sem `checkNumbers`, o pré-voo de destinatário deixa passar — não é o assunto.
vi.mock("../../supabase/functions/_shared/whatsapp-client.ts", () => ({
  getWhatsAppProvider: vi.fn(async () => ({ provider: "notificame" })),
}));

import { executeWorkflowAction } from "../../supabase/functions/_shared/workflow-action-handler";

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

const CHIP = {
  id: "inst-chip",
  organization_id: ORG,
  provider: "uazapi",
  instance_name: "Carol",
  status: "connected",
  session_dead_since: null,
};

/** A recusa por janela, exatamente como o transporte a devolve. */
const BLOQUEIO_DE_JANELA = "governor_block:outside_24h_window";

/** O template que o nó declara para a hora em que a janela estiver fechada. */
const ESCAPE = {
  escapeTemplateName: "retomada_agosto",
  escapeTemplateLanguage: "pt_BR",
  escapeTemplateComponents: [{ type: "BODY", text: "Oi {{1}}, podemos retomar?" }],
  escapeTemplateVariables: { "1": "{{nome}}" },
};

function cenario(instancias: Record<string, unknown>[] = [CANAL_OFICIAL]) {
  const { sb, mockTable } = createMockSupabase();
  mockTable("leads", [LEAD_ROW]);
  mockTable("whatsapp_instances", instancias);
  mockTable("whatsapp_messages", []);
  mockTable("lead_history", []);
  return sb;
}

const rodar = (sb: unknown, nodeData: Record<string, unknown>) =>
  executeWorkflowAction({
    supabase: sb as never,
    organizationId: ORG,
    leadId: LEAD,
    nodeData: {
      actionType: "send_whatsapp",
      whatsappInstanceId: "inst-oficial",
      messageTemplate: "Olá {{nome}}, tudo bem?",
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

describe("janela aberta", () => {
  it("manda o texto, como hoje — o template nem é tocado", async () => {
    const r = await rodar(cenario(), ESCAPE);

    expect(r.success).toBe(true);
    expect(sendTextMock).toHaveBeenCalledTimes(1);
    expect(sendTemplateMock).not.toHaveBeenCalled();
    // O texto sai com a variável do lead já resolvida.
    expect(sendTextMock.mock.calls[0][3]).toBe("Olá Maria, tudo bem?");
  });
});

describe("janela fechada com template configurado", () => {
  beforeEach(() => {
    sendTextMock.mockResolvedValue({ success: false, error: BLOQUEIO_DE_JANELA });
  });

  it("manda o template, pelo MESMO número, com as variáveis preenchidas", async () => {
    const r = await rodar(cenario(), ESCAPE);

    expect(r.error).toBeUndefined();
    expect(r.success).toBe(true);
    expect(sendTemplateMock).toHaveBeenCalledTimes(1);

    const [, instancia, telefone, template, opts] = sendTemplateMock.mock.calls[0] as [
      unknown,
      { id: string },
      string,
      { name: string; language: string; components: unknown[]; previewText: string },
      { trackSource: string },
    ];
    // Mesmo número que o texto teria usado: escape não é troca de canal.
    expect(instancia.id).toBe("inst-oficial");
    expect(telefone).toBe("5511999999999");
    expect(template.name).toBe("retomada_agosto");
    expect(template.language).toBe("pt_BR");
    // ⚠️ A variável do LEAD é resolvida no envio, não guardada resolvida no nó.
    expect(JSON.stringify(template.components)).toContain("Maria");
    expect(template.previewText).toContain("Maria");
    // Rastro próprio: um escape não se confunde com o nó de template no log.
    expect(opts.trackSource).toBe("workflow-action-escape-janela");
  });

  it("o passo diz que foi escape de janela, e não um envio comum", async () => {
    const r = await rodar(cenario(), ESCAPE);
    expect(r.message).toMatch(/janela de 24h fechada/i);
    expect(r.data?.motivo).toBe("janela_fechada_escape_enviado");
  });

  it("template recusado pela Meta falha SEM retentar — HSM não se manda duas vezes", async () => {
    sendTemplateMock.mockResolvedValue({ success: false, error: "template not found" });

    const r = await rodar(cenario(), ESCAPE);

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/janela de 24h fechada/i);
    expect(r.error).toContain("template not found");
    expect(r.retryable).toBe(false);
    expect(r.data?.motivo).toBe("janela_fechada_escape_falhou");
  });
});

describe("janela fechada SEM template configurado", () => {
  beforeEach(() => {
    sendTextMock.mockResolvedValue({ success: false, error: BLOQUEIO_DE_JANELA });
  });

  it("falha com motivo legível, e não com o código cru do governor", async () => {
    const r = await rodar(cenario(), {});

    expect(r.success).toBe(false);
    expect(sendTemplateMock).not.toHaveBeenCalled();
    expect(r.error).toMatch(/janela de 24h fechada/i);
    expect(r.error).toMatch(/template de escape/i);
    // Quem opera não deve precisar traduzir `governor_block:` para saber o que houve.
    expect(r.error).not.toContain("governor_block");
    // Não-retentável: a janela não reabre com o tempo, reabre com uma resposta.
    expect(r.retryable).toBe(false);
    expect(r.data?.motivo).toBe("janela_fechada_sem_escape");
  });

  it("nome em branco não vale como template configurado", async () => {
    const r = await rodar(cenario(), { escapeTemplateName: "   " });

    expect(r.success).toBe(false);
    expect(sendTemplateMock).not.toHaveBeenCalled();
    expect(r.data?.motivo).toBe("janela_fechada_sem_escape");
  });
});

describe("o motivo distingue janela fechada de outras falhas", () => {
  it("falha comum do envio segue com o erro do transporte, sem escapar", async () => {
    sendTextMock.mockResolvedValue({ success: false, error: "instance not available" });

    const r = await rodar(cenario(), ESCAPE);

    expect(r.success).toBe(false);
    expect(r.error).toContain("instance not available");
    expect(r.error).not.toMatch(/janela de 24h/i);
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  it("outro bloqueio do governor não gasta o template do escape", async () => {
    sendTextMock.mockResolvedValue({ success: false, error: "governor_block:quarantined" });

    const r = await rodar(cenario(), ESCAPE);

    expect(r.success).toBe(false);
    expect(r.error).toContain("quarantined");
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });
});

describe("chip Uazapi — idêntico ao de hoje", () => {
  const noDoChip = { whatsappInstanceId: "inst-chip", ...ESCAPE };

  it("envio bem-sucedido segue igual", async () => {
    const r = await rodar(cenario([CHIP]), noDoChip);

    expect(r.success).toBe(true);
    expect(r.message).toBe("WhatsApp text sent");
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  it("falha segue devolvendo o erro do transporte, não o motivo de janela", async () => {
    // No chip o governor NUNCA emite motivo de janela — a P5 é allowlist do
    // canal oficial. Mesmo com escape declarado no nó, ele não é alcançável.
    sendTextMock.mockResolvedValue({ success: false, error: "Invalid phone" });

    const r = await rodar(cenario([CHIP]), noDoChip);

    expect(r.success).toBe(false);
    expect(r.error).toBe("WhatsApp send failed: Invalid phone");
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });
});
