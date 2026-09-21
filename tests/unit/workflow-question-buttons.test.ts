import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDenoEnv, setDenoEnv } from "../helpers/deno-mock";
import { executeWorkflow } from "../../supabase/functions/_shared/workflow-executor";
import { createMockSupabase } from "../helpers/supabase-mock";

const questionDefinition = {
  nodes: [
    { id: "start", type: "trigger", data: {} },
    { id: "question", type: "question_buttons", data: { text: "Escolha", instanceId: "instance", buttons: [{ id: "a", label: "A" }] } },
    { id: "finish", type: "end", data: {} },
  ],
  edges: [{ id: "edge", source: "start", target: "question" },
    ...["button:a", "other_response", "timeout", "send_failure"].map(sourceHandle => ({ id: sourceHandle, source: "question", target: "finish", sourceHandle }))],
};

function questionFixture(org: string) {
  const database = createMockSupabase();
  database.mockTable("organizations", [{ id: org, feature_flags: { workflow_question_buttons: true } }]);
  database.mockTable("whatsapp_instances", [{ id: "instance", organization_id: org, provider: "uazapi", status: "connected" }]);
  database.mockTable("leads", [{ id: "lead", organization_id: org, phone: "5511999999999" }]);
  database.mockRpc("freeze_workflow_button_definition", questionDefinition);
  database.mockRpc("prepare_workflow_button_question", { id: "11111111-1111-4111-8111-111111111111", send: true });
  database.mockRpc("get_uazapi_credentials", [{ uazapi_token: "test-instance" }]);
  database.mockRpc("accept_workflow_button_question", true);
  return { ...database, params: { supabase: database.sb, executionId: "execution", workflowId: "workflow", organizationId: org, leadId: "lead", context: {}, loopLimit: 10, definition: questionDefinition } };
}

describe("Pergunta com botões via executor", () => {
  afterEach(() => { vi.unstubAllGlobals(); clearDenoEnv(); });
  it("recusa executar pergunta quando organização não habilitou a feature", async () => {
    const { sb } = createMockSupabase();
    const result = await executeWorkflow({
      supabase: sb, executionId: "execution", workflowId: "workflow",
      organizationId: "org", leadId: "lead", context: {}, loopLimit: 10,
      definition: {
        nodes: [
          { id: "start", type: "trigger", data: {} },
          { id: "question", type: "question_buttons", data: { text: "Escolha", buttons: [{ id: "a", label: "A" }] } },
        ],
        edges: [{ id: "edge", source: "start", target: "question" }],
      },
    });
    expect(result).toMatchObject({ success: false, status: "failed", error: "Pergunta com botões não habilitada para organização" });
  });
  it("envia opção com identidade da ocorrência e aguarda antes de seguir qualquer saída", async () => {
    setDenoEnv("UAZAPI_BASE_URL", "https://uazapi.test");
    setDenoEnv("UAZAPI_ADMIN_TOKEN", "test-admin");
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "internal", messageid: "wa-original", status: "Pending", messageTimestamp: 1700000000 }), { status: 200 }));
    vi.stubGlobal("fetch", request);
    const { params, getRpcCalls } = questionFixture("enabled-org");
    const result = await executeWorkflow(params);
    expect(result).toMatchObject({ success: true, status: "paused" });
    expect(getRpcCalls().find(call=>call.name==="accept_workflow_button_question")?.params).toMatchObject({p_accepted_at:"2023-11-14T22:13:20.000Z"});
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ number: "5511999999999", type: "button", text: "Escolha", choices: ["A|11111111-1111-4111-8111-111111111111:a"] });
  });
  it("reserva recuperada aguarda sem repetir envio HTTP", async () => {
    const request = vi.fn(); vi.stubGlobal("fetch", request);
    const { params, mockRpc } = questionFixture("resumed-org");
    mockRpc("prepare_workflow_button_question", { id: "11111111-1111-4111-8111-111111111111", send: false });
    expect(await executeWorkflow(params)).toMatchObject({ success: true, status: "paused" });
    expect(request).not.toHaveBeenCalled();
  });
  it("assinatura bloqueada impede envio mesmo com a feature habilitada", async () => {
    setDenoEnv("UAZAPI_BASE_URL", "https://uazapi.test"); setDenoEnv("UAZAPI_ADMIN_TOKEN", "test-admin");
    const request = vi.fn(); vi.stubGlobal("fetch", request);
    const { params, mockRpc } = questionFixture("blocked-org");
    mockRpc("org_access_blocked", true);
    expect(await executeWorkflow(params)).toMatchObject({ success: true, status: "paused" });
    expect(request).not.toHaveBeenCalled();
  });
  it("falha explícita encaminha Falha no envio sem retry", async () => {
    setDenoEnv("UAZAPI_BASE_URL", "https://uazapi.test");
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "internal", messageid: "wa-failed", status: "Failed", messageTimestamp: 1700000000 }), { status: 200 }));
    vi.stubGlobal("fetch", request);
    const { params, mockRpc } = questionFixture("failed-org");
    mockRpc("fail_workflow_button_question", true);
    const calls = vi.spyOn(params.supabase, "rpc");
    await executeWorkflow(params);
    expect(request).toHaveBeenCalledTimes(1);
    expect(calls).toHaveBeenCalledWith("fail_workflow_button_question", expect.objectContaining({ p_organization_id: "failed-org", p_reason: "provider_rejected" }));
    expect(calls).not.toHaveBeenCalledWith("accept_workflow_button_question", expect.anything());
  });
  it("override para provider incompatível não envia nem aceita pergunta", async () => {
    const request = vi.fn(); vi.stubGlobal("fetch", request);
    const { params, mockTable, mockRpc } = questionFixture("override-org");
    mockTable("organizations", [{id:"override-org",feature_flags:{workflow_question_buttons:true},whatsapp_provider_override:"evolution"}]);
    mockRpc("fail_workflow_button_question", true);
    const calls = vi.spyOn(params.supabase, "rpc");
    await executeWorkflow(params);
    expect(request).not.toHaveBeenCalled();
    expect(calls).toHaveBeenCalledWith("fail_workflow_button_question", expect.objectContaining({p_reason:"send_preflight_failed"}));
  });
  it("resposta HTTP perdida mantém ocorrência incerta sem retry ou falha comprovada", async () => {
    setDenoEnv("UAZAPI_BASE_URL", "https://uazapi.test");
    const request = vi.fn().mockRejectedValue(new TypeError("network response lost")); vi.stubGlobal("fetch", request);
    const {params,getUpdated,getRpcCalls,mockTable} = questionFixture("uncertain-org");
    mockTable("workflow_button_questions", [{id:"11111111-1111-4111-8111-111111111111",organization_id:"uncertain-org",state:"sending"}]);
    await executeWorkflow(params);
    expect(request).toHaveBeenCalledTimes(1);
    expect(getUpdated("workflow_button_questions")).toEqual(expect.arrayContaining([expect.objectContaining({state:"uncertain"})]));
    expect(getRpcCalls().some(call=>call.name==="fail_workflow_button_question")).toBe(false);
  });
  it("instância removida antes da reserva segue Falha no envio sem transporte", async () => {
    const request=vi.fn(); vi.stubGlobal("fetch",request);
    const {params,mockTable,mockRpc,getRpcCalls}=questionFixture("missing-instance-org");
    mockTable("whatsapp_instances", []);
    mockRpc("fail_workflow_button_admission", true);
    expect(await executeWorkflow(params)).toMatchObject({success:true,status:"paused"});
    expect(getRpcCalls()).toEqual(expect.arrayContaining([expect.objectContaining({name:"fail_workflow_button_admission",params:expect.objectContaining({p_reason:"instance_unavailable"})})]));
    expect(request).not.toHaveBeenCalled();
  });
  it("retomada usa definição congelada mesmo após edição e desativação da admissão", async () => {
    const { params, mockTable } = questionFixture("old-org");
    mockTable("organizations", [{ id: "old-org", feature_flags: { workflow_question_buttons: false } }]);
    const result = await executeWorkflow({ ...params, currentNodeId: "finish", questionButtonsDefinition: questionDefinition,
      definition: { nodes: [{ id: "draft", type: "condition", data: { guidedCondition: {} } }], edges: [] } });
    expect(result).toMatchObject({ success: true, status: "completed" });
  });
  it("ingresso reconhece resposta estruturada de botão mesmo quando normalizada como texto", async () => {
    vi.stubGlobal("Deno", { ...globalThis.Deno, serve: vi.fn() });
    const { normalizeMessage, persistMessage } = await import("../../supabase/functions/whatsapp-webhook/index.ts");
    const { sb, mockTable, mockRpc } = createMockSupabase();
    const instance = { id: "instance", organization_id: "reply-org", provider: "uazapi", instance_name: "Test" };
    const normalized = normalizeMessage({ messageid: "incoming", chatid: "5511999999999@s.whatsapp.net", sender: "5511999999999@s.whatsapp.net",
      fromMe: false, text: "A", messageType: "TemplateButtonReplyMessage", messageTimestamp: 1700000000,
      buttonOrListid: "11111111-1111-4111-8111-111111111111:a", quoted: "wa-original" }, instance);
    mockTable("whatsapp_messages", [{ ...normalized, id: "stored-row" }]);
    mockRpc("receive_workflow_button_reply", { recognized: true, resolved: true });
    const result = await persistMessage(sb, instance, normalized, null);
    expect(result).toMatchObject({ message_id: "incoming", button_reply_recognized: true });
  });
});
