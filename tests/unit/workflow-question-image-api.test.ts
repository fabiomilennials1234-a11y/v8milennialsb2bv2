// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleWorkflowQuestionImage } from "../../supabase/functions/_shared/workflow-question-image";

const org = "11111111-1111-4111-8111-111111111111";
const workflowId = "22222222-2222-4222-8222-222222222222";
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZmcAAAAASUVORK5CYII=", "base64"));
afterEach(() => vi.unstubAllGlobals());

function storageApi(options: { allowed?: boolean; enabled?: boolean; visible?: boolean; incoming?: boolean } = {}) {
  const requests: Array<{ path: string; method: string; headers: Headers }> = [];
  const env: Record<string, string> = { SUPABASE_URL: "https://db.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };
  vi.stubGlobal("Deno", { env: { get: (key: string) => env[key] } });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    requests.push({ path, method: init?.method ?? "GET", headers: new Headers(init?.headers) });
    if (path.startsWith("/storage/v1/object/sign/")) return Response.json({ signedURL: "/object/sign/preview?token=short" });
    if (path.startsWith("/storage/v1/object/")) return Response.json({ Key: path.replace("/storage/v1/object/", "") });
    const data: Record<string, unknown> = {
      "/auth/v1/user": { id: "user", aud: "authenticated", app_metadata: {}, user_metadata: {} },
      "/rest/v1/whatsapp_messages": options.visible === false ? null : { id: workflowId, organization_id: org, instance_id: "instance", lead_id: "lead", direction: options.incoming ? "incoming" : "outgoing", raw_payload: { workflowQuestionId: workflowId } },
      "/rest/v1/workflow_button_questions": { content: { image: { bucket: "workflow-question-images", path: `${org}/33333333-3333-4333-8333-333333333333.png`, mimeType: "image/png", sizeBytes: 68 } } },
      "/rest/v1/workflows": options.visible === false ? null : { id: workflowId, organization_id: org },
      "/rest/v1/master_users": null,
      "/rest/v1/team_members": { id: "member", organization_id: org, role: "admin" },
      "/rest/v1/rpc/can_administer_guided_workflow": options.allowed ?? true,
      "/rest/v1/organizations": { feature_flags: { workflow_question_buttons: options.enabled ?? true } },
    };
    if (!(path in data)) throw new Error(`Unexpected HTTP ${path}`);
    return Response.json(data[path]);
  });
  return requests;
}

function upload(body: Uint8Array = png, type = "image/png") {
  const form = new FormData();
  form.set("workflowId", workflowId);
  form.set("file", new Blob([body.slice().buffer], { type }), "image.png");
  return new Request("https://edge.test/workflow-question-image", { method: "POST", headers: { Authorization: "Bearer caller" }, body: form });
}

describe("Upload privado de imagem da pergunta", () => {
  it("nega upload sem JWT sem acessar banco nem storage", async () => {
    const requests = storageApi();
    const request = upload(); request.headers.delete("authorization");
    expect((await handleWorkflowQuestionImage(request)).status).toBe(401);
    expect(requests).toHaveLength(0);
  });
  it("aplica teto ao arquivo e rejeita MIME que contradiz conteúdo", async () => {
    const requests = storageApi();
    expect((await handleWorkflowQuestionImage(upload(new Uint8Array(5 * 1024 * 1024 + 1)))).status).toBe(413);
    expect((await handleWorkflowQuestionImage(upload(png, "image/jpeg"))).status).toBe(400);
    expect(requests.some(item => item.path.startsWith("/storage/"))).toBe(false);
  });
  it("renova prévia apenas de arquivo da organização do workflow", async () => {
    const requests = storageApi();
    const request = (path: string) => new Request("https://edge.test/workflow-question-image", { method: "POST", headers: { Authorization: "Bearer caller", "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", workflowId, path }) });
    const own = `${org}/33333333-3333-4333-8333-333333333333.png`;
    expect((await handleWorkflowQuestionImage(request(own))).status).toBe(200);
    const count = requests.filter(item => item.path.startsWith("/storage/")).length;
    expect((await handleWorkflowQuestionImage(request(`44444444-4444-4444-8444-444444444444/${own.split("/")[1]}`))).status).toBe(403);
    expect(requests.filter(item => item.path.startsWith("/storage/"))).toHaveLength(count);
  });
  it.each([{ visible: false }, { allowed: false }, { enabled: false }])("nega acesso sem workflow, permissão ou gate: %j", async options => {
    const requests = storageApi(options);
    expect((await handleWorkflowQuestionImage(upload())).status).toBe(403);
    expect(requests.some(item => item.path.startsWith("/storage/"))).toBe(false);
  });
  it("limita payload multipart mesmo sem Content-Length antes de interpretar arquivo", async () => {
    const requests = storageApi();
    const options = { method: "POST", headers: { Authorization: "Bearer caller", "Content-Type": "multipart/form-data; boundary=limit" }, duplex: "half",
      body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 70_000)); controller.close(); } }) };
    const response = await handleWorkflowQuestionImage(new Request("https://edge.test/workflow-question-image", options));
    expect(response.status).toBe(413);
    expect(requests).toHaveLength(0);
  });
  it("rejeita conteúdo disfarçado de imagem antes de escrever no storage", async () => {
    const requests = storageApi();
    const response = await handleWorkflowQuestionImage(upload(new TextEncoder().encode("<svg onload=alert(1)>")));
    expect(response.status).toBe(400);
    expect(requests.some(item => item.path.startsWith("/storage/"))).toBe(false);
  });
  it("autoriza workflow do caller e devolve referência imutável com preview temporária", async () => {
    const requests = storageApi();
    const response = await handleWorkflowQuestionImage(upload());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.image).toEqual({ bucket: "workflow-question-images", path: expect.stringMatching(new RegExp(`^${org}/[a-f0-9-]+\\.png$`)), mimeType: "image/png", sizeBytes: png.length });
    expect(result.previewUrl).toContain("token=short");
    const write = requests.find(item => item.path.startsWith("/storage/v1/object/workflow-question-images/"));
    expect(write?.headers.get("x-upsert")).toBe("false");
    expect(requests.find(item => item.path === "/rest/v1/workflows")?.headers.get("authorization")).toBe("Bearer caller");
  });
});


it("prévia do chat autoriza pela mensagem visível mesmo com gate desligado", async () => {
  storageApi({ enabled: false, allowed: false });
  const response = await handleWorkflowQuestionImage(new Request("https://edge.test/workflow-question-image", {
    method: "POST", headers: { Authorization: "Bearer caller", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "chat_preview", messageId: workflowId }),
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toHaveProperty("previewUrl");
});
it("prévia do chat nega mensagem fora do acesso sem assinar imagem", async () => {
  const calls = storageApi({ visible: false });
  const response = await handleWorkflowQuestionImage(new Request("https://edge.test/workflow-question-image", {
    method: "POST", headers: { Authorization: "Bearer caller", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "chat_preview", messageId: workflowId }),
  }));
  expect(response.status).toBe(403);
  expect(calls.some(c => c.path.startsWith("/storage/"))).toBe(false);
});

it("prévia não aceita referência de pergunta em mensagem recebida", async () => {
  const calls = storageApi({ incoming: true });
  const response = await handleWorkflowQuestionImage(new Request("https://edge.test/workflow-question-image", {
    method: "POST", headers: { Authorization: "Bearer caller", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "chat_preview", messageId: workflowId }),
  }));
  expect(response.status).toBe(403);
  expect(calls.some(c => c.path.startsWith("/storage/"))).toBe(false);
});
