import { describe, it, expect } from "vitest";
import { isForwardableMessage } from "./forwardable";

const PUBLIC = "https://x.supabase.co/storage/v1/object/public/media/a.jpg";
const CDN = "https://mmg.whatsapp.net/v/t62.7118-24/1_n.enc?ccb=11-4";

describe("isForwardableMessage (espelha planForward do servidor)", () => {
  it("texto com conteúdo", () => {
    expect(isForwardableMessage({ message_type: "text", content: "oi" })).toBe(true);
    expect(isForwardableMessage({ message_type: "conversation", content: "oi" })).toBe(true);
    expect(isForwardableMessage({ message_type: "text", content: "  " })).toBe(false);
  });

  it("mídia só com arquivo nosso: link da CDN, expirada e sem url não vão", () => {
    for (const t of ["image", "video", "document", "audio", "ptt", "sticker"]) {
      expect(isForwardableMessage({ message_type: t, media_url: PUBLIC }), t).toBe(true);
    }
    expect(isForwardableMessage({ message_type: "image", media_url: CDN })).toBe(false);
    expect(isForwardableMessage({ message_type: "image", media_url: null })).toBe(false);
    expect(isForwardableMessage({ message_type: "image", media_url: PUBLIC, media_expired: true })).toBe(false);
  });

  it("apagada e tipos fora da v1 não vão", () => {
    expect(isForwardableMessage({ message_type: "text", content: "oi", deleted_at: "2026-10-08T10:00:00Z" })).toBe(false);
    for (const t of ["contact", "location", "interactive", "button", "buttons_response", "list_response", "reaction", "poll"]) {
      expect(isForwardableMessage({ message_type: t, content: "x" }), t).toBe(false);
    }
  });
});
