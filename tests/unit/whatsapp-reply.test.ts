// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { replySnapshot } from "../../supabase/functions/_shared/whatsapp-reply";
import { UazapiProvider } from "../../supabase/functions/_shared/whatsapp-providers/uazapi-provider";
import { UazapiClient } from "../../supabase/functions/_shared/uazapi-client";
afterEach(() => vi.restoreAllMocks());
describe("reply contract", () => {
  const message = { message_id: "original", normalized_phone: "51999999999", content: "Original", message_type: "text", direction: "incoming" };
  it("rejects an original from a different conversation", () => {
    expect(replySnapshot(message, "5551888888888")).toBeNull();
    expect(replySnapshot(message, "5551999999999")?.text).toBe("Original");
  });
  it("labels media with no caption", () => expect(replySnapshot({ ...message, content: null, message_type: "audio" }, "5551999999999")?.text).toBe("Áudio"));
  it("forwards the reply id to provider media API", async () => {
    const send = vi.spyOn(UazapiClient.prototype, "sendMedia").mockResolvedValue({ id: "sent" } as never);
    const provider = new UazapiProvider({ baseUrl: "https://test.invalid", token: "test", adminToken: "test", instanceId: "instance", organizationId: "org", supabaseAdmin: {} as never });
    await provider.sendMedia({ number: "5551999999999", type: "image", file: "https://test.invalid/img", replyid: "original" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ replyid: "original" }));
  });
});
