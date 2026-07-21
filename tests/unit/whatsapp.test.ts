import { describe, it, expect } from "vitest";
import { formatPhoneForWhatsApp } from "../../src/modules/communication/lib/whatsapp";

describe("formatPhoneForWhatsApp", () => {
  it("returns null for undefined", () => {
    expect(formatPhoneForWhatsApp(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(formatPhoneForWhatsApp("")).toBeNull();
  });

  // Regression: a whitespace-only or non-numeric phone must NOT collapse to a
  // bare "55". Before the fix this produced "55", which Uazapi rejected with a
  // 500 that surfaced as "Edge Function returned a non-2xx status code".
  it("returns null for whitespace-only phone (bug: was emitting '55')", () => {
    expect(formatPhoneForWhatsApp("                 ")).toBeNull();
  });

  it("returns null for non-numeric garbage", () => {
    expect(formatPhoneForWhatsApp("no phone")).toBeNull();
  });

  it("returns null for a lone country code", () => {
    expect(formatPhoneForWhatsApp("55")).toBeNull();
  });

  it("returns null for a too-short number (missing DDD)", () => {
    expect(formatPhoneForWhatsApp("98765432")).toBeNull();
  });

  it("formats 11-digit BR phone with country code", () => {
    expect(formatPhoneForWhatsApp("11987654321")).toBe("5511987654321");
  });

  it("handles phone already with 55 prefix", () => {
    expect(formatPhoneForWhatsApp("5511987654321")).toBe("5511987654321");
  });

  it("removes non-numeric characters", () => {
    expect(formatPhoneForWhatsApp("+55 (11) 98765-4321")).toBe("5511987654321");
  });

  it("removes leading 0 from DDD", () => {
    expect(formatPhoneForWhatsApp("01198765432")).toBe("5511998765432");
  });

  it("adds 9 to 10-digit numbers (DDD + 8 digits)", () => {
    expect(formatPhoneForWhatsApp("1198765432")).toBe("5511998765432");
  });

  it("handles different DDDs", () => {
    expect(formatPhoneForWhatsApp("21987654321")).toBe("5521987654321");
  });

  it("handles short phone with 55 prefix", () => {
    expect(formatPhoneForWhatsApp("551198765432")).toBe("5511998765432");
  });
});
