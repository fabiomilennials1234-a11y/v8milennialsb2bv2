import { afterEach, expect, it, vi } from "vitest";
import { clearDenoEnv, setDenoEnv } from "../helpers/deno-mock";

afterEach(() => { vi.unstubAllGlobals(); clearDenoEnv(); });

it("webhook não confirma recebimento quando ingresso durável da pergunta falha", async () => {
  setDenoEnv("SUPABASE_URL", "https://db.test");
  setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service");
  setDenoEnv("UAZAPI_WEBHOOK_SECRET", "test-secret");
  let handler: (request: Request) => Promise<Response>;
  vi.stubGlobal("Deno", { ...globalThis.Deno, serve: (callback: typeof handler) => { handler = callback; } });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (url.includes("register_workflow_button_ingress")) return json({ message: "inbox unavailable", code: "XX000" }, 503);
    if (url.includes("check_rate_limit")) return json({ allowed: true, remaining: 100 });
    if (url.includes("whatsapp_instance_secrets")) return json({ instance_id: "instance", organization_id: "org" });
    if (url.includes("whatsapp_instances")) return json({ id: "instance", organization_id: "org", instance_name: "Test", provider: "uazapi" });
    if (url.includes("whatsapp_messages") && (!init?.method || init.method === "GET")) return json({ id: "stored" });
    return json(null);
  }));
  await import("../../supabase/functions/whatsapp-webhook/index.ts");
  const response = await handler!(new Request("https://edge.test/whatsapp-webhook/test-secret/instance/messages", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      event: "messages", message: { messageid: "message", chatid: "5511999999999@s.whatsapp.net", fromMe: false,
        messageType: "conversation", text: "Quero conversar" },
    }),
  }));
  expect(response.status).toBe(503);
});

it("worker não interpreta erro da reconciliação como ausência de resposta", async () => {
  setDenoEnv("SUPABASE_URL", "https://db.test"); setDenoEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service");
  setDenoEnv("CRON_SECRET", "test-cron");
  let handler: (request: Request) => Promise<Response>;
  let legacyClaims = 0;
  vi.stubGlobal("Deno", { ...globalThis.Deno, serve: (callback: typeof handler) => { handler = callback; } });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("claim_workflow_executions")) legacyClaims++;
    const failed = String(input).includes("reconcile_workflow_button_questions");
    return new Response(JSON.stringify(failed ? { message: "database unavailable", code: "XX000" } : []), {
      status: failed ? 503 : 200, headers: { "Content-Type": "application/json" },
    });
  }));
  await import("../../supabase/functions/process-workflow-executions/index.ts");
  const response = await handler!(new Request("https://edge.test/process-workflow-executions", {
    method: "POST", headers: { "Content-Type": "application/json", "x-cron-secret": "test-cron" }, body: "{}",
  }));
  expect(response.status).toBe(503);
  expect(legacyClaims).toBe(1);
});
