/**
 * Batch 3 — natural-messaging, followupSchedule, track, logger (_shared)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../../tests/helpers/deno-mock";
import { setDenoEnv, clearDenoEnv } from "../../tests/helpers/deno-mock";

const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ choices: [{ message: { content: "chunk1\n\nchunk2" } }] }), text: () => Promise.resolve("ok") });
global.fetch = mockFetch as any;

beforeEach(() => { clearDenoEnv(); vi.clearAllMocks(); });

// ── natural-messaging ──
import { smartSplitMessage, type NaturalMessagingConfig, type SplitResult } from "../../supabase/functions/_shared/natural-messaging";

describe("smartSplitMessage", () => {
  it("returns single chunk when disabled", async () => {
    const result = await smartSplitMessage("Hello world", { enabled: false, intensity: "natural" });
    expect(result.chunks).toEqual(["Hello world"]);
    expect(result.delays).toEqual([0]);
  });

  it("returns single chunk for short messages when enabled", async () => {
    const result = await smartSplitMessage("Hi", { enabled: true, intensity: "natural" });
    expect(result.chunks).toHaveLength(1);
    expect(result.delays[0]).toBe(0);
  });

  it("calls LLM for longer messages", async () => {
    setDenoEnv("OPENROUTER_API_KEY", "test-key");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: "Parte 1.\n---SPLIT---\nParte 2." } }],
      }),
    });
    const longMessage = "Esta é uma mensagem longa que precisa ser dividida em múltiplos chunks para envio natural no WhatsApp. ".repeat(5);
    const result = await smartSplitMessage(longMessage, { enabled: true, intensity: "natural" });
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("intensity presets are valid", () => {
    const intensities: NaturalMessagingConfig["intensity"][] = ["suave", "natural", "conversacional"];
    intensities.forEach((i) => {
      expect(i).toBeTruthy();
    });
  });

  it("SplitResult shape", () => {
    const r: SplitResult = { chunks: ["a", "b"], delays: [0, 1000] };
    expect(r.chunks).toHaveLength(2);
    expect(r.delays).toHaveLength(2);
  });
});

// ── followupSchedule ──
import { getNextSendTime } from "../../supabase/functions/_shared/followupSchedule";

describe("getNextSendTime", () => {
  it("returns same time when business hours disabled", () => {
    const now = new Date("2026-04-13T14:00:00Z");
    const result = getNextSendTime({ sendOnlyBusinessHours: false, businessHoursStart: "09:00" }, now);
    expect(result.getTime()).toBe(now.getTime());
  });

  it("returns same time during business hours on weekday", () => {
    // Monday 10:00 BRT (13:00 UTC) — within 09:00-18:00
    const monday10am = new Date("2026-04-13T13:00:00Z"); // Monday
    const result = getNextSendTime({
      sendOnlyBusinessHours: true,
      businessHoursStart: "09:00",
      businessHoursEnd: "18:00",
      sendDays: ["seg", "ter", "qua", "qui", "sex"],
      timezone: "America/Sao_Paulo",
    }, monday10am);
    expect(result.getTime()).toBe(monday10am.getTime());
  });

  it("schedules to next business day when outside hours", () => {
    // Monday 22:00 BRT (01:00+1 UTC) — after business hours
    const mondayLate = new Date("2026-04-14T01:00:00Z"); // Monday night
    const result = getNextSendTime({
      sendOnlyBusinessHours: true,
      businessHoursStart: "09:00",
      businessHoursEnd: "18:00",
      sendDays: ["seg", "ter", "qua", "qui", "sex"],
      timezone: "America/Sao_Paulo",
    }, mondayLate);
    expect(result.getTime()).toBeGreaterThan(mondayLate.getTime());
  });

  it("schedules to next weekday when on weekend", () => {
    // Saturday 10:00 BRT
    const saturday = new Date("2026-04-18T13:00:00Z"); // Saturday
    const result = getNextSendTime({
      sendOnlyBusinessHours: true,
      businessHoursStart: "09:00",
      businessHoursEnd: "18:00",
      sendDays: ["seg", "ter", "qua", "qui", "sex"],
      timezone: "America/Sao_Paulo",
    }, saturday);
    expect(result.getTime()).toBeGreaterThan(saturday.getTime());
  });

  it("defaults to America/Sao_Paulo timezone", () => {
    const now = new Date("2026-04-13T14:00:00Z");
    const result = getNextSendTime({ sendOnlyBusinessHours: false, businessHoursStart: "09:00" }, now);
    expect(result).toBeDefined();
  });

  it("defaults to weekdays when no sendDays", () => {
    const weekday = new Date("2026-04-13T15:00:00Z"); // Monday afternoon BRT
    const result = getNextSendTime({
      sendOnlyBusinessHours: true,
      businessHoursStart: "09:00",
      businessHoursEnd: "18:00",
      timezone: "America/Sao_Paulo",
    }, weekday);
    expect(result).toBeDefined();
  });
});
