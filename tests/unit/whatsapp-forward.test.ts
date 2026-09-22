import { describe, expect, it, vi } from "vitest";
import {
  forwardContent,
  type ForwardSource,
  resolveForward,
  sendForward,
} from "../../supabase/functions/_shared/whatsapp-forward";
import type { WhatsAppProvider } from "../../supabase/functions/_shared/whatsapp-client";
import { extractChatTarget } from "../../supabase/functions/_shared/chat-owner-guard";

const id = "12345678-1234-1234-1234-123456789012";
const source: ForwardSource = {
  id,
  message_type: "text",
  content: "oi",
  condition_text: "oi",
  status: "received",
  deleted_at: null,
  media_url: null,
  media_expired: false,
};
function fixture(
  sourceData: unknown = source,
  targetData: unknown = { lead_id: "lead", remote_jid: "12000000000@g.us" },
) {
  const chain = (data: unknown) => {
    const b = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
    };
    for (const key of ["select", "eq", "is", "order", "limit"] as const) b[key].mockReturnValue(b);
    return b;
  };
  const read = chain(sourceData), target = chain(targetData);
  const user = { from: vi.fn().mockReturnValueOnce(read).mockReturnValueOnce(target) };
  const provider = {
    provider: "uazapi",
    sendText: vi.fn().mockResolvedValue({ message_id: "out", status: "queued" }),
    sendMedia: vi.fn().mockResolvedValue({ message_id: "out", status: "sent" }),
  };
  const run = async () =>
    sendForward(
      provider as unknown as WhatsAppProvider,
      await resolveForward(user as never, "org", "instance", id, "12000000000"),
    );
  return { run, provider, read, target, user };
}
describe("forwarding with caller-scoped reads", () => {
  it("resolves the real group JID and preserves queued status without marking delivered", async () => {
    const f = fixture();
    expect(await f.run()).toMatchObject({ status: "queued" });
    for (const query of [f.read, f.target]) {
      expect(query.eq).toHaveBeenCalledWith("organization_id", "org");
      expect(query.eq).toHaveBeenCalledWith("instance_id", "instance");
    }
    expect(f.provider.sendText).toHaveBeenCalledExactlyOnceWith({
      number: "12000000000@g.us",
      text: "oi",
      forward: true,
      trackSource: "torque_forward",
    });
  });
  it.each([[null, { lead_id: null }], [source, null]])(
    "denies inaccessible source or destination before any send",
    async (s, t) => {
      const f = fixture(s, t);
      await expect(f.run()).rejects.toMatchObject({ status: 403 });
      expect(f.provider.sendText).not.toHaveBeenCalled();
      expect(f.provider.sendMedia).not.toHaveBeenCalled();
    },
  );
  it("uses the common chat ownership gate", () => {
    expect(extractChatTarget("forwardMessage", { number: "12000000000@g.us", lead_id: "lead" }))
      .toMatchObject({ rawPhone: "12000000000@g.us", leadId: "lead" });
  });
  it.each([{ deleted_at: "today" }, { status: "failed" }, { status: "pending" }, {
    message_type: "location",
  }, { message_type: "image", media_expired: true }])(
    "rejects unavailable originals: %o",
    (patch) => {
      expect(() => forwardContent({ ...source, ...patch })).toThrow();
    },
  );
  it("forwards only the reply body, never the quoted original", () => {
    expect(
      forwardContent({
        ...source,
        content: "private quote + reply",
        condition_text: "reply",
        reply_context: { body: "private" },
      }),
    ).toEqual({ kind: "text", text: "reply" });
    expect(() =>
      forwardContent({ ...source, condition_text: null, reply_context: { body: "private" } })
    ).toThrow();
  });
  it.each(["image", "video", "audio", "ptt", "document", "sticker"])(
    "forwards %s media with caption",
    async (message_type) => {
      const f = fixture({ ...source, message_type, media_url: "https://media.test/file" });
      await f.run();
      expect(f.provider.sendMedia).toHaveBeenCalledExactlyOnceWith({
        number: "12000000000@g.us",
        type: message_type,
        file: "https://media.test/file",
        caption: "oi",
        forward: true,
        trackSource: "torque_forward",
      });
    },
  );
  it("does not retry ambiguous sends or present a rejection as success", async () => {
    const f = fixture();
    f.provider.sendText.mockRejectedValue(new Error("timeout"));
    await expect(f.run()).rejects.toThrow("timeout");
    expect(f.provider.sendText).toHaveBeenCalledTimes(1);
    const rejected = fixture();
    rejected.provider.sendText.mockResolvedValue({ message_id: "out", status: "failed" });
    await expect(rejected.run()).rejects.toMatchObject({ status: 422 });
  });
});
