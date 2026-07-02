// @vitest-environment node
/**
 * UazapiProvider sender delegation (#702 / Disparo F0).
 *
 * The provider must expose the Uazapi /sender/* methods and forward each to the
 * underlying UazapiClient — the missing shim that makes runUazapiSenderJob (and
 * therefore Quick Blast + CSV Mass Send) dispatch instead of throwing
 * "provider does not support senderAdvanced".
 *
 * Behavior through the public interface: spy on UazapiClient.prototype, call the
 * provider method, assert the forward + returned value. No network.
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

const SENDER_RESPONSE = {
  sender_id: "snd-123",
  status: "queued" as const,
  total: 42,
  sent: 0,
  failed: 0,
};

afterEach(() => vi.restoreAllMocks());

describe("UazapiProvider sender delegation", () => {
  it("senderAdvanced forwards the input to the client and returns its response", async () => {
    const spy = vi
      .spyOn(UazapiClient.prototype, "senderAdvanced")
      .mockResolvedValue(SENDER_RESPONSE);
    const provider = makeProvider();
    const input = {
      messages: [{ number: "5511999999999", text: "oi {nome}" }],
      delayMin: 5000,
      delayMax: 30000,
      track_source: "quick-blast",
    };

    const res = await provider.senderAdvanced(input);

    expect(spy).toHaveBeenCalledWith(input);
    expect(res).toEqual(SENDER_RESPONSE);
  });

  it("senderGet forwards the senderId to the client and returns its response", async () => {
    const spy = vi
      .spyOn(UazapiClient.prototype, "senderGet")
      .mockResolvedValue({ ...SENDER_RESPONSE, status: "running", sent: 10 });
    const provider = makeProvider();

    const res = await provider.senderGet("snd-123");

    expect(spy).toHaveBeenCalledWith("snd-123");
    expect(res.sent).toBe(10);
  });

  it.each(["senderPause", "senderResume", "senderStop"] as const)(
    "%s forwards the senderId to the client's matching method",
    async (method) => {
      const spy = vi
        .spyOn(UazapiClient.prototype, method)
        .mockResolvedValue(undefined);
      const provider = makeProvider();

      await provider[method]("snd-123");

      expect(spy).toHaveBeenCalledWith("snd-123");
    },
  );

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

  it("senderListMessages forwards folder id + status filter and returns the raw rows (#948)", async () => {
    const rows = [
      { chatid: "5511987654321@s.whatsapp.net", status: "Failed", error: "invalid jid" },
    ];
    const spy = vi
      .spyOn(UazapiClient.prototype, "senderListMessages")
      .mockResolvedValue(rows as any);
    const provider = makeProvider();

    const res = await provider.senderListMessages("fld-abc-123", { messageStatus: "Failed" });

    expect(spy).toHaveBeenCalledWith("fld-abc-123", { messageStatus: "Failed" });
    expect(res).toEqual(rows);
  });
});
