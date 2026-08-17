/**
 * Cantini Alimentos — bloco 03, a mudança PROPOSTA (ainda NÃO aplicada no PROD).
 *
 * Hoje o ramo "não" da condição `condition-2` ("Cidade é atendida?") vai direto
 * para um `end`. Isso torna a falha invisível: tanto a cidade fora da área
 * quanto o campo esquecido pelo vendedor caem nesse mesmo fim silencioso.
 *
 * A proposta é trocar esse `end` por um `send_to_number` que avisa o Bruno.
 * Estes testes existem para responder UMA pergunta: o motor aceita isso?
 * Nada aqui toca o PROD — o handler de ação é mockado.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";

const mockEvaluate = vi.hoisted(() => vi.fn());
vi.mock("../../supabase/functions/_shared/workflow-condition-evaluator.ts", () => ({
  evaluateCondition: mockEvaluate,
  getLeadTags: vi.fn().mockResolvedValue(""),
}));

const mockAction = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ success: true, data: {} }),
);
vi.mock("../../supabase/functions/_shared/workflow-action-handler.ts", () => ({
  executeWorkflowAction: mockAction,
}));

import { executeWorkflow } from "../../supabase/functions/_shared/workflow-executor";
import { createMockSupabase } from "../helpers/supabase-mock";

const baseMock = () => {
  const { sb, mockTable } = createMockSupabase();
  mockTable("workflow_execution_steps", []);
  mockTable("workflow_executions", []);
  return { sb };
};

/** O trecho do bloco 03 a partir da condição, já com a mudança proposta. */
const definicaoProposta = {
  nodes: [
    { id: "trigger-1", type: "trigger", data: {} },
    {
      id: "condition-2",
      type: "condition",
      data: {
        type: "condition",
        conditionMode: "field",
        field: "custom.Cidade que está localizado o estabelecimento:",
        operator: "in_list",
        value: "Porto Alegre, POA, Viamão, Canoas",
      },
    },
    // ramo SIM — inalterado: manda para a etapa que dispara o bloco 05
    {
      id: "action-2",
      type: "action",
      data: { actionType: "move_stage", pipeType: "whatsapp", targetStage: "coletando_informacoes" },
    },
    // ramo NÃO — a mudança: avisa o Bruno em vez de morrer calado
    {
      id: "action-alerta",
      type: "action",
      data: {
        actionType: "send_to_number",
        notifyPhones: ["555183530551"],
        messageTemplate: "Confere o lead {{nome}}: a cidade não bateu na lista (ou o campo não foi preenchido).",
        whatsappInstanceId: "940ab7fa-c5d5-4222-b632-8b9686e5dbdd",
      },
    },
    { id: "end-1", type: "end", data: {} },
    { id: "end-2", type: "end", data: {} },
  ],
  edges: [
    { id: "e0", source: "trigger-1", target: "condition-2" },
    { id: "e1", source: "condition-2", target: "action-2", sourceHandle: "yes" },
    { id: "e2", source: "condition-2", target: "action-alerta", sourceHandle: "no" },
    { id: "e3", source: "action-2", target: "end-1" },
    { id: "e4", source: "action-alerta", target: "end-2" },
  ],
};

const rodar = (sb: unknown) =>
  executeWorkflow({
    supabase: sb,
    executionId: "exec-1",
    workflowId: "wf-03",
    organizationId: "3fc45147-206f-4d9b-9eaa-9f05807267a2",
    leadId: "lead-1",
    definition: definicaoProposta,
    loopLimit: 10,
    context: {},
  });

const acoesExecutadas = () =>
  mockAction.mock.calls.map((c) => (c[0] as { nodeData?: { actionType?: string } })?.nodeData?.actionType);

beforeEach(() => {
  vi.clearAllMocks();
  mockAction.mockResolvedValue({ success: true, data: {} });
});

describe("Cantini bloco 03 — o ramo 'não' pode cair num send_to_number?", () => {
  it("cidade NÃO atendida → executa o aviso, e NÃO move de etapa", async () => {
    mockEvaluate.mockResolvedValue(false);
    const { sb } = baseMock();

    const result = await rodar(sb);

    expect(result.success).toBe(true);
    expect(acoesExecutadas()).toContain("send_to_number");
    // o lead não pode ser promovido quando a cidade não bate
    expect(acoesExecutadas()).not.toContain("move_stage");
  });

  it("cidade atendida → move de etapa, e NÃO dispara o aviso", async () => {
    mockEvaluate.mockResolvedValue(true);
    const { sb } = baseMock();

    const result = await rodar(sb);

    expect(result.success).toBe(true);
    expect(acoesExecutadas()).toContain("move_stage");
    expect(acoesExecutadas()).not.toContain("send_to_number");
  });

  it("o aviso recebe o telefone e o template que o schema exige", async () => {
    mockEvaluate.mockResolvedValue(false);
    const { sb } = baseMock();

    await rodar(sb);

    const chamada = mockAction.mock.calls.find(
      (c) => (c[0] as { nodeData?: { actionType?: string } })?.nodeData?.actionType === "send_to_number",
    );
    expect(chamada).toBeDefined();
    const dados = (chamada![0] as { nodeData: Record<string, unknown> }).nodeData;
    // dsl-schema: send_to_number exige >= 1 notifyPhones E messageTemplate
    expect(dados.notifyPhones).toEqual(["555183530551"]);
    expect(dados.messageTemplate).toBeTruthy();
  });

  it("o fluxo termina em 'completed' pelos dois ramos (nenhum beco sem saída)", async () => {
    for (const resultado of [true, false]) {
      vi.clearAllMocks();
      mockAction.mockResolvedValue({ success: true, data: {} });
      mockEvaluate.mockResolvedValue(resultado);
      const { sb } = baseMock();

      const result = await rodar(sb);
      expect(result.status).toBe("completed");
    }
  });
});
