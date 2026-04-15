/**
 * Tests for _shared/audio-sender.ts — WhatsApp voice note sender.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as any;

import { sendWhatsAppAudio } from "../../supabase/functions/_shared/audio-sender";

beforeEach(() => {
  clearDenoEnv();
  vi.clearAllMocks();
  mockFetch.mockReset();
});

describe("sendWhatsAppAudio", () => {
  it("returns error when env not configured", async () => {
    const result = await sendWhatsAppAudio("inst", "11999", "https://cdn/a.ogg");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Evolution API");
  });

  it("returns error when only URL set", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo");
    const result = await sendWhatsAppAudio("inst", "11999", "https://cdn/a.ogg");
    expect(result.success).toBe(false);
  });

  it("sends audio and returns messageId on success", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo");
    setDenoEnv("EVOLUTION_API_KEY", "k");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ key: { id: "msg-123" } }),
      text: () => Promise.resolve(""),
    });
    const result = await sendWhatsAppAudio("Main", "11999999999", "https://cdn/a.ogg");
    expect(result.success).toBe(true);
    expect(result.messageId).toBe("msg-123");

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://evo/message/sendWhatsAppAudio/Main");
    const body = JSON.parse(init.body as string);
    expect(body.number).toBe("5511999999999");
    expect(body.audio).toBe("https://cdn/a.ogg");
  });

  it("keeps already-prefixed 55 numbers unchanged", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo");
    setDenoEnv("EVOLUTION_API_KEY", "k");
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ key: { id: "m" } }),
    });
    await sendWhatsAppAudio("Main", "+55 (11) 99999-9999", "https://x");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.number).toBe("5511999999999");
  });

  it("returns error with errorText when non-ok response", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo");
    setDenoEnv("EVOLUTION_API_KEY", "k");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("invalid api key"),
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await sendWhatsAppAudio("Main", "11999", "https://x");
    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid api key");
    spy.mockRestore();
  });

  it("returns undefined messageId when key.id missing", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo");
    setDenoEnv("EVOLUTION_API_KEY", "k");
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    const result = await sendWhatsAppAudio("Main", "11999", "https://x");
    expect(result.success).toBe(true);
    expect(result.messageId).toBeUndefined();
  });

  it("catches thrown Error and returns .message", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo");
    setDenoEnv("EVOLUTION_API_KEY", "k");
    mockFetch.mockRejectedValue(new Error("network"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await sendWhatsAppAudio("Main", "11999", "https://x");
    expect(result.success).toBe(false);
    expect(result.error).toBe("network");
    spy.mockRestore();
  });

  it("converts non-Error thrown values via String()", async () => {
    setDenoEnv("EVOLUTION_API_URL", "https://evo");
    setDenoEnv("EVOLUTION_API_KEY", "k");
    mockFetch.mockImplementation(() => {
      throw "string exception";
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await sendWhatsAppAudio("Main", "11999", "https://x");
    expect(result.success).toBe(false);
    expect(result.error).toBe("string exception");
    spy.mockRestore();
  });
});
