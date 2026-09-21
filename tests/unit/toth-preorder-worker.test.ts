// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCorsHeaders } from "../../supabase/functions/_shared/cors";
import { SECURITY_HEADERS, withSecurityHeaders } from "../../supabase/functions/_shared/security-headers";
import { createTothPreorderWorkerHandler } from "../../supabase/functions/_shared/erp/toth-preorders/worker-handler";
import type { TothPreorderProcessResult } from "../../supabase/functions/_shared/erp/toth-preorders/contracts";

const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const ORIGIN = "https://crm.example.test";
const URL = "https://worker.example.test/toth-process-preorder";
const processOperation = vi.fn(async (_id: string): Promise<TothPreorderProcessResult> => ({ operation_id: OPERATION_ID, disposition: "received" }));
const authorize = vi.fn((request: Request) => request.headers.get("x-cron-secret") === "test-cron-secret");
const responseHeaders = vi.fn((request: Request) => withSecurityHeaders(getCorsHeaders(request.headers.get("origin"))));
const handler = createTothPreorderWorkerHandler({ authorize, headers: responseHeaders, process: processOperation });

function request(body: unknown = { operation_id: OPERATION_ID }, options: { method?: string; authorized?: boolean; contentType?: string | null } = {}) {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (options.authorized !== false) headers["x-cron-secret"] = "test-cron-secret";
  if (options.contentType !== null) headers["content-type"] = options.contentType ?? "application/json";
  const method = options.method ?? "POST";
  const result = new Request(URL, { method, headers, ...(method === "GET" || method === "OPTIONS" ? {} : { body: JSON.stringify(body) }) });
  if (options.contentType === null) result.headers.delete("content-type");
  return result;
}

function expectProtected(response: Response) {
  expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toBe("application/json");
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) expect(response.headers.get(key)).toBe(value);
}

beforeEach(() => {
  vi.stubGlobal("Deno", { env: { get: (name: string) => name === "ALLOWED_ORIGINS" ? ORIGIN : undefined } });
  authorize.mockClear();
  responseHeaders.mockClear();
  processOperation.mockReset().mockResolvedValue({ operation_id: OPERATION_ID, disposition: "received" });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("toth preorder worker — fronteira interna autenticada", () => {
  it("responde preflight com CORS e segurança sem autorizar ou processar", async () => {
    const response = await handler(request(undefined, { method: "OPTIONS", authorized: false }));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expectProtected(response);
    expect(authorize).not.toHaveBeenCalled();
    expect(processOperation).not.toHaveBeenCalled();
  });

  it.each(["GET", "PUT", "DELETE", "PATCH"])("recusa %s antes de processamento", async (method) => {
    const response = await handler(request(undefined, { method }));
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: "method_not_allowed" });
    expectProtected(response);
    expect(processOperation).not.toHaveBeenCalled();
  });

  it("nega acesso antes de ler o corpo ou tocar a operação", async () => {
    const input = request({ operation_id: OPERATION_ID }, { authorized: false });
    const getReader = vi.spyOn(input.body!, "getReader");
    const response = await handler(input);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(input.bodyUsed).toBe(false);
    expect(getReader).not.toHaveBeenCalled();
    expect(processOperation).not.toHaveBeenCalled();
    expectProtected(response);
  });

  it.each([null, "text/plain", "application/x-www-form-urlencoded"])("exige JSON depois da autenticação (%s)", async (contentType) => {
    const response = await handler(request({ operation_id: OPERATION_ID }, { contentType }));
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: "json_required" });
    expect(processOperation).not.toHaveBeenCalled();
    expectProtected(response);
  });

  it("aceita POST JSON com charset e devolve somente metadados permitidos", async () => {
    const extraResult = { operation_id: OPERATION_ID, disposition: "received" as const,
      request_snapshot: { document: "sensitive" }, organization_id: "private", provider_payload: { token: "secret" }, credentials: "secret" };
    processOperation.mockResolvedValue(extraResult);
    const response = await handler(request({ operation_id: OPERATION_ID }, { contentType: "application/json; charset=utf-8" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ operation_id: OPERATION_ID, disposition: "received" });
    expect(authorize).toHaveBeenCalledOnce();
    expect(processOperation).toHaveBeenCalledExactlyOnceWith(OPERATION_ID);
    expectProtected(response);
  });

  it("retorna bloqueio controlado sem sucesso falso", async () => {
    processOperation.mockResolvedValue({ operation_id: OPERATION_ID, disposition: "blocked", reason_code: "supplier_contract_unverified" });
    const response = await handler(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ operation_id: OPERATION_ID, disposition: "blocked", reason_code: "supplier_contract_unverified" });
    expectProtected(response);
  });

  it.each([
    { organization_id: "4922638c-4909-494e-ba10-12282ec0b161" },
    { org_id: "another-tenant" },
    { observation: { status: "approved", approved_total: 200 } },
    { p_observation: { status: "approved" } },
    { request_snapshot: { items: [] } },
    { lease_token: "11111111-1111-4111-8111-111111111112" },
    { approved_total: 200 },
    { extra: true },
  ])("não aceita contexto ou observação injetados no corpo: %j", async (extra) => {
    const response = await handler(request({ operation_id: OPERATION_ID, ...extra }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(processOperation).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, "string", 1, { operation_id: "invalid" }, { operation_id: 123 }])("recusa corpo inválido: %j", async (body) => {
    const response = await handler(request(body));
    expect(response.status).toBe(400);
    expect(processOperation).not.toHaveBeenCalled();
  });

  it("limita corpo em streaming a 1024 bytes mesmo sem Content-Length e cancela leitura", async () => {
    const cancel = vi.fn();
    const chunks = [new Uint8Array(600).fill(32), new Uint8Array(425).fill(32)];
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { const chunk = chunks.shift(); if (chunk) controller.enqueue(chunk); },
      cancel,
    }, { highWaterMark: 0 });
    const input = new Request(URL, { method: "POST", headers: { origin: ORIGIN, "x-cron-secret": "test-cron-secret", "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
    expect(input.headers.get("content-length")).toBeNull();
    const response = await handler(input);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "request_too_large" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(processOperation).not.toHaveBeenCalled();
    expectProtected(response);
  });

  it("não permite Content-Length falso reduzir a medição real do corpo", async () => {
    const input = new Request(URL, { method: "POST", headers: { origin: ORIGIN, "x-cron-secret": "test-cron-secret", "content-type": "application/json", "content-length": "1" }, body: " ".repeat(1025) });
    const response = await handler(input);
    expect(response.status).toBe(413);
    expect(processOperation).not.toHaveBeenCalled();
  });

  it("recusa UTF-8 malformado", async () => {
    const input = new Request(URL, { method: "POST", headers: { origin: ORIGIN, "x-cron-secret": "test-cron-secret", "content-type": "application/json" }, body: new Uint8Array([0xc3, 0x28]) });
    const response = await handler(input);
    expect(response.status).toBe(400);
    expect(processOperation).not.toHaveBeenCalled();
  });

  it("sanitiza exceção de processamento e mantém CORS/segurança", async () => {
    processOperation.mockRejectedValue(new Error("postgres://user:password@host document 123456 secret token"));
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "toth_preorder_processing_failed" });
    expectProtected(response);
  });
});
