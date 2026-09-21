import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDenoEnv, setDenoEnv } from "../helpers/deno-mock";
import { createMockSupabase } from "../helpers/supabase-mock";
import { executeWorkflow } from "../../supabase/functions/_shared/workflow-executor";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const image = { bucket: "workflow-question-images", path: `${org}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png`, mimeType: "image/png", sizeBytes: 512 };
function fixture(asset = image) {
  const db = createMockSupabase();
  const definition = {
    nodes: [{ id: "start", type: "trigger", data: {} },
      { id: "ask", type: "question_buttons", data: { text: "Escolha", image: asset, instanceId: "instance", buttons: [{ id: "a", label: "A" }], timeoutHours: 24 } },
      { id: "end", type: "end", data: {} }],
    edges: [{ id: "start-edge", source: "start", target: "ask" },
      ...["button:a", "other_response", "timeout", "send_failure"].map(sourceHandle => ({ id: sourceHandle, source: "ask", target: "end", sourceHandle }))],
  };
  db.mockTable("organizations", [{ id: org, feature_flags: { workflow_question_buttons: true } }]);
  db.mockTable("whatsapp_instances", [{ id: "instance", organization_id: org, provider: "uazapi", status: "connected" }]);
  db.mockTable("leads", [{ id: "lead", organization_id: org, phone: "5511999999999" }]);
  db.mockRpc("freeze_workflow_button_definition", definition);
  db.mockRpc("prepare_workflow_button_question", { id: "11111111-1111-4111-8111-111111111111", send: true });
  db.mockRpc("get_uazapi_credentials", [{ uazapi_token: "test-instance" }]);
  db.mockRpc("accept_workflow_button_question", true);
  return { ...db, params: { supabase: db.sb, executionId: "execution", workflowId: "workflow", organizationId: org, leadId: "lead", context: {}, loopLimit: 10, definition } };
}

describe("Pergunta com imagem via executor", () => {
  afterEach(() => { vi.unstubAllGlobals(); clearDenoEnv(); });
  it("assina a imagem privada do snapshot no envio e preserva a identidade da escolha", async () => {
    setDenoEnv("UAZAPI_BASE_URL", "https://uazapi.test");
    setDenoEnv("UAZAPI_ADMIN_TOKEN", "test-admin");
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "internal", messageid: "wa-image", status: "Pending", messageTimestamp: 1700000000 }), { status: 200 }));
    vi.stubGlobal("fetch", request);
    const { params } = fixture();
    expect(await executeWorkflow(params)).toMatchObject({ success: true, status: "paused" });
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ imageButton: "https://storage.test/signed-url", choices: ["A|11111111-1111-4111-8111-111111111111:a"] });
  });
  it("não envia imagem cujo caminho pertence a outra organização", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const { params } = fixture({ ...image, path: "cccccccc-cccc-4ccc-8ccc-cccccccccccc/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png" });
    await executeWorkflow(params);
    expect(request).not.toHaveBeenCalled();
  });
  it("não assina nem envia novamente imagem de reserva já consumida", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const { params, mockRpc } = fixture();
    const storage = vi.spyOn(params.supabase.storage, "from");
    mockRpc("prepare_workflow_button_question", { id: "11111111-1111-4111-8111-111111111111", send: false });
    await executeWorkflow(params);
    expect(storage).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

});
