// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";

const { providerPassthroughStatus } = await import(
  "../../supabase/functions/_shared/provider-error-status.ts"
);
const { UazapiClient } = await import("../../supabase/functions/_shared/uazapi-client.ts");

afterEach(() => {
  vi.unstubAllGlobals();
  UazapiClient._resetCircuitState();
});

async function clientErrorFor(status: number, body: unknown): Promise<unknown> {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
    ),
  );
  const client = new UazapiClient({ baseUrl: "https://uazapi.example.com", token: "tok", timeoutMs: 200 });
  return client.sendText({ number: "5500000000000", text: "Oi" }).then(
    () => { throw new Error("expected sendText to reject"); },
    (e: unknown) => e,
  );
}

// Proxy contract for the manual chat send (whatsapp-api-proxy catch block):
// a passthrough status answers `{ error, code }` with that status and logs
// runtime_logs status=skipped; anything else answers 500 and logs status=error.
describe("proxy passthrough — recipient not on WhatsApp (Uazapi 500)", () => {
  it("o erro do client vira 422 com code recipient_not_on_whatsapp e a mensagem do provedor", async () => {
    const e = await clientErrorFor(500, { error: "the number 5500000000000@s.whatsapp.net is not on WhatsApp" });

    expect(providerPassthroughStatus(e)).toBe(422);
    expect(e).toMatchObject({ provider_code: "recipient_not_on_whatsapp" });
    expect((e as Error).message).toContain("is not on WhatsApp");
  });

  it("5xx genérico continua fora da lista (proxy segue respondendo 500)", async () => {
    const e = await clientErrorFor(500, { error: "internal server error" });

    expect(providerPassthroughStatus(e)).toBeNull();
    expect(e).toMatchObject({ status: 500 });
  });
});

describe("providerPassthroughStatus", () => {
  it("propaga 404 do provedor (downloadMedia: Message not found)", () => {
    expect(providerPassthroughStatus({ status: 404, message: "Message not found" })).toBe(404);
  });

  it("propaga 422 markread_all_failed", () => {
    expect(providerPassthroughStatus({ status: 422, provider_code: "markread_all_failed", message: "x" })).toBe(422);
  });

  it.each([429, 500, 502, 503, 401, 403, 400])("mantém %i fora da lista (continua 500)", (status) => {
    expect(providerPassthroughStatus({ status, message: "x" })).toBeNull();
  });

  it("exceção desconhecida / sem status numérico -> null", () => {
    expect(providerPassthroughStatus(new Error("boom"))).toBeNull();
    expect(providerPassthroughStatus({ status: "404" })).toBeNull();
    expect(providerPassthroughStatus(null)).toBeNull();
    expect(providerPassthroughStatus(undefined)).toBeNull();
    expect(providerPassthroughStatus("404")).toBeNull();
  });
});
