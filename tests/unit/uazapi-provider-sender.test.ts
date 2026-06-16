// @vitest-environment node
/**
 * UazapiProvider sender delegation — REAL CONTRACT (#702 / Disparo F0; B5).
 *
 * The provider exposes the Uazapi /sender/* methods and forwards each to the
 * underlying UazapiClient. This file used to mock the legacy
 * {sender_id,status,total,sent,failed} shape — false confidence, since the live
 * API (probe 2026-06-15) returns:
 *
 *   CREATE  POST /sender/advanced  → { count, folder_id, status }
 *   LIST    GET  /sender/listfolders → Array<{ id, status, log_total,
 *             log_sucess (sic), log_failed, ... }>
 *
 * These tests spy on UazapiClient.prototype, call through the provider, and
 * assert the forward + the REAL response shapes. No network.
 *
 * RED phase: provider/client still type+return the legacy sender_id shape, so the
 * folder_id/count assertions fail until B1/B2/B3 land.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { UazapiProvider } from "../../supabase/functions/_shared/whatsapp-providers/uazapi-provider.ts";
import { UazapiClient } from "../../supabase/functions/_shared/uazapi-client.ts";

function makeProvider() {
  return new UazapiProvider({
    baseUrl: "https://uaz.test",
    token: "tok",
    adminToken: "admin",
    instanceId: "inst-1",
    organizationId: "org-1",
    supabaseAdmin: {} as any,
  });
}

// Real CREATE response (POST /sender/advanced): count = messages accepted.
const CREATE_RESPONSE = {
  count: 42,
  folder_id: "fld-abc-123",
  status: "scheduled" as const,
};

afterEach(() => vi.restoreAllMocks());

describe("UazapiProvider sender delegation — real contract", () => {
  it("senderAdvanced forwards the input and returns the CREATE shape { folder_id, count, status }", async () => {
    const spy = vi
      .spyOn(UazapiClient.prototype, "senderAdvanced")
      .mockResolvedValue(CREATE_RESPONSE as any);
    const provider = makeProvider();

    // Every message item MUST carry a `type` (Uazapi accepts 0 without it).
    const input = {
      messages: [{ number: "5511999999999", type: "text" as const, text: "oi {nome}" }],
      delayMin: 5000,
      delayMax: 30000,
      track_source: "quick-blast",
    };

    const res = await provider.senderAdvanced(input);

    expect(spy).toHaveBeenCalledWith(input);
    expect((res as any).folder_id).toBe("fld-abc-123");
    expect((res as any).count).toBe(42);
    expect((res as any).sender_id).toBeUndefined();
  });

  it("senderGet forwards the id and returns mapped metrics (sent/failed/total) + canonical status", async () => {
    const spy = vi
      .spyOn(UazapiClient.prototype, "senderGet")
      .mockResolvedValue({ status: "running", sent: 30, failed: 2, total: 42 } as any);
    const provider = makeProvider();

    const res = await provider.senderGet("fld-abc-123");

    expect(spy).toHaveBeenCalledWith("fld-abc-123");
    expect(res.sent).toBe(30);
    expect(res.failed).toBe(2);
    expect(res.total).toBe(42);
    expect(res.status).toBe("running");
  });

  it("implements all five Uazapi sender methods (the missing shim from #702)", () => {
    const provider = makeProvider();
    for (const m of [
      "senderAdvanced",
      "senderGet",
      "senderPause",
      "senderResume",
      "senderStop",
    ] as const) {
      expect(typeof provider[m]).toBe("function");
    }
  });

  it.each(["senderPause", "senderResume", "senderStop"] as const)(
    "%s forwards the folder id to the client's matching method",
    async (method) => {
      const spy = vi
        .spyOn(UazapiClient.prototype, method)
        .mockResolvedValue(undefined);
      const provider = makeProvider();

      await provider[method]("fld-abc-123");

      expect(spy).toHaveBeenCalledWith("fld-abc-123");
    },
  );
});
