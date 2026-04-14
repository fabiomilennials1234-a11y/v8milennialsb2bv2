import { describe, it, expect } from "vitest";
import { formatPhoneForWhatsApp } from "../../src/lib/whatsapp";

describe("formatPhoneForWhatsApp", () => {
  it("returns null for undefined", () => {
    expect(formatPhoneForWhatsApp(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(formatPhoneForWhatsApp("")).toBeNull();
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
