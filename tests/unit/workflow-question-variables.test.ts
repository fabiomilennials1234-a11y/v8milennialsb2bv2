import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDenoEnv, setDenoEnv } from "../helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";
import { executeWorkflow } from "../../supabase/functions/_shared/workflow-executor";
import { sendQueuedWorkflowQuestions } from "../../supabase/functions/_shared/workflow-buttons/runtime";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const occurrence = "11111111-1111-4111-8111-111111111111";

function fixture(text: string, leadName: string | null = "MARIA SOUZA") {
  const db = createMockSupabase();
  const definition = {
    nodes: [{ id: "start", type: "trigger", data: {} },
      { id: "ask", type: "question_buttons", data: { text, instanceId: "instance", buttons: [{ id: "a", label: "Sim" }], timeoutHours: 24 } },
      { id: "end", type: "end", data: {} }],
    edges: [{ id: "start-edge", source: "start", target: "ask" },
      ...["button:a", "other_response", "timeout", "send_failure"].map(sourceHandle => ({ id: sourceHandle, source: "ask", target: "end", sourceHandle }))],
  };
  db.mockTable("organizations", [{ id: org, feature_flags: { workflow_question_buttons: true } }]);
  db.mockTable("whatsapp_instances", [{ id: "instance", organization_id: org, provider: "uazapi", status: "connected" }]);
  db.mockTable("leads", [{ id: "lead", organization_id: org, name: leadName, phone: "5511999999999" }]);
  db.mockRpc("freeze_workflow_button_definition", definition);
  db.mockRpc("prepare_workflow_button_question", { id: occurrence, send: true });
  db.mockRpc("get_uazapi_credentials", [{ uazapi_token: "test-instance" }]);
  db.mockRpc("accept_workflow_button_question", true);
  db.mockRpc("fail_workflow_button_question", true);
  db.mockTable("workflow_button_questions", [{ id: occurrence, organization_id: org, state: "sending", content: definition.nodes[1].data }]);
  return { ...db, params: { supabase: db.sb, executionId: "execution", workflowId: "workflow", organizationId: org, leadId: "lead", context: {}, loopLimit: 10, definition } };
}

function stubUazapi() {
  setDenoEnv("UAZAPI_BASE_URL", "https://uazapi.test");
  setDenoEnv("UAZAPI_ADMIN_TOKEN", "test-admin");
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "internal", messageid: "wa-1", status: "Pending", messageTimestamp: 1700000000 }), { status: 200 }));
  vi.stubGlobal("fetch", request);
  return request;
}

const sentBody = (request: ReturnType<typeof vi.fn>) => JSON.parse(request.mock.calls[0][1].body);

describe("Pergunta com botões: variáveis no texto", () => {
  afterEach(() => { vi.unstubAllGlobals(); clearDenoEnv(); });

  it("resolve {{primeiro_nome}} com o lead da execução", async () => {
    const request = stubUazapi();
    const { params } = fixture("Oi {{primeiro_nome}}, podemos falar?");
    expect(await executeWorkflow(params)).toMatchObject({ success: true, status: "paused" });
    expect(sentBody(request).text).toBe("Oi Maria, podemos falar?");
  });

  it("chave simples {primeiro_nome} segue o nó legado: o resolvedor só lê {{x}} (sai literal)", async () => {
    const request = stubUazapi();
    const raw = "Oi {primeiro_nome}, podemos falar?";
    const { params } = fixture(raw);
    await executeWorkflow(params);
    expect(sentBody(request).text).toBe(raw);
  });

  it("grava o texto resolvido na ocorrência antes do envio: o espelho do chat mostra o que o lead recebe", async () => {
    const request = stubUazapi();
    const { params, getUpdated } = fixture("Oi {{primeiro_nome}}");
    request.mockImplementationOnce(async () => {
      expect(getUpdated("workflow_button_questions").at(-1)?.content).toMatchObject({ text: "Oi Maria" });
      return new Response(JSON.stringify({ id: "internal", messageid: "wa-1", status: "Pending", messageTimestamp: 1700000000 }), { status: 200 });
    });
    await executeWorkflow(params);
    expect(request).toHaveBeenCalledTimes(1);
    expect(getUpdated("workflow_button_questions").at(-1)?.content).toMatchObject({ text: "Oi Maria", buttons: [{ id: "a", label: "Sim" }] });
  });

  it("texto sem variável não reescreve a ocorrência", async () => {
    stubUazapi();
    const { params, getUpdated } = fixture("Escolha");
    await executeWorkflow(params);
    expect(getUpdated("workflow_button_questions")).toEqual([]);
  });

  it("texto sem variável sai byte-idêntico, inclusive chave desconhecida", async () => {
    const request = stubUazapi();
    const raw = "Escolha  uma opção {cupom} 100% {{ — até amanhã!\n";
    const { params } = fixture(raw);
    await executeWorkflow(params);
    expect(sentBody(request).text).toBe(raw);
  });

  it("botões continuam casando pelo id da ocorrência, sem resolução no rótulo", async () => {
    const request = stubUazapi();
    const { params } = fixture("Oi {{primeiro_nome}}");
    await executeWorkflow(params);
    expect(sentBody(request).choices).toEqual([`Sim|${occurrence}:a`]);
  });

  it("texto que resolve vazio não é enviado e segue Falha no envio", async () => {
    const request = stubUazapi();
    const { params, getRpcCalls } = fixture("{{primeiro_nome}}", "WhatsApp 2952");
    await executeWorkflow(params);
    expect(request).not.toHaveBeenCalled();
    expect(getRpcCalls().find(call => call.name === "fail_workflow_button_question")?.params)
      .toMatchObject({ p_id: occurrence, p_organization_id: org, p_reason: "send_preflight_failed" });
    expect(getRpcCalls().some(call => call.name === "accept_workflow_button_question")).toBe(false);
  });

  it("pergunta da fila resolve variáveis com o lead da ocorrência", async () => {
    const request = stubUazapi();
    const { sb, mockRpc, mockTable } = fixture("ignorado");
    mockTable("workflow_executions", [{ id: "execution", organization_id: org, context: {} }]);
    mockRpc("claim_workflow_button_queue", [{
      id: occurrence, organization_id: org, instance_id: "instance", phone: "5511999999999",
      lead_id: "lead", execution_id: "execution",
      content: { text: "Oi {{primeiro_nome}}", buttons: [{ id: "a", label: "Sim" }] },
    }]);
    expect(await sendQueuedWorkflowQuestions(sb)).toEqual({ errors: 0 });
    expect(sentBody(request)).toMatchObject({ text: "Oi Maria", choices: [`Sim|${occurrence}:a`] });
  });
});
