import { describe, it, expect } from "vitest";
import { isWhatsAppCdnUrl } from "./whatsappMediaUrl";

describe("isWhatsAppCdnUrl", () => {
  it.each([
    "https://mmg.whatsapp.net/v/t62.7118-24/123_n.enc?ccb=11-4&oh=abc",
    "https://media.whatsapp.com/x",
    "HTTPS://MMG.WHATSAPP.NET/x",
  ])("aceita CDN real: %s", (u) => expect(isWhatsAppCdnUrl(u)).toBe(true));

  it.each([
    "https://evil.com/?x=.whatsapp.net/",
    "https://whatsapp.net.evil.com/x",
    "https://evilwhatsapp.net/x",
    "https://x.supabase.co/storage/v1/object/public/media/a.jpg",
    "blob:https://app/abc",
    "javascript://x.whatsapp.net/%0Aalert(1)",
    "not a url",
    "",
    null,
    undefined,
  ])("rejeita: %s", (u) => expect(isWhatsAppCdnUrl(u as string | null | undefined)).toBe(false));
});
